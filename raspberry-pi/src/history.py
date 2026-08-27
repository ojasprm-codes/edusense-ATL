"""History, statistics, analytics, events, and export helpers for EDUSENSE AI V7."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Tuple
from zoneinfo import ZoneInfo

from config import GAS_SENSORS, LOCAL_TIMEZONE, MAX_EXPORT_ROWS, MAX_HISTORY_POINTS
from database import DatabaseManager, utc_now
from ppm import mq_to_ppm
LOCAL_TZ = ZoneInfo(LOCAL_TIMEZONE)

RANGES = {
    "live": {"delta": timedelta(minutes=30), "bucket": "raw", "limit": 900},
    "2h": {"delta": timedelta(hours=2), "bucket": "raw", "limit": 7500},
    "5h": {"delta": timedelta(hours=5), "bucket": "minute", "limit": 360},
    "1d": {"delta": timedelta(days=1), "bucket": "5minute", "limit": 320},
    "20d": {"delta": timedelta(days=20), "bucket": "hour", "limit": 520},
    "2m": {"delta": timedelta(days=62), "bucket": "day", "limit": 90},
}

LEGACY_RANGES = {
    "hour": "live",
    "today": "today",
    "yesterday": "yesterday",
    "5d": "20d",
    "10d": "20d",
    "25d": "2m",
}

DAY_WINDOWS = {
    "full": 24,
    "24": 24,
    "24h": 24,
    "2": 2,
    "2h": 2,
    "10": 10,
    "10h": 10,
    "18": 18,
    "18h": 18,
}


def resolve_range(args) -> Tuple[datetime, datetime, str, int, str]:
    start, end, bucket, limit, range_name, _ = resolve_range_with_meta(args)
    return start, end, bucket, limit, range_name


def resolve_range_with_meta(args) -> Tuple[datetime, datetime, str, int, str, Dict[str, Any]]:
    range_name = (args.get("range") or "live").lower()
    range_name = LEGACY_RANGES.get(range_name, range_name)
    now = utc_now()

    if args.get("date") or range_name in {"today", "yesterday", "calendar", "day"}:
        selected = _selected_date(args, now, range_name)
        start_local = datetime.combine(selected, time.min, LOCAL_TZ)
        hours = DAY_WINDOWS.get(str(args.get("hours") or args.get("window") or "24").lower(), 24)
        end_local = start_local + timedelta(hours=hours)
        selected_start = start_local.astimezone(timezone.utc)
        selected_end = end_local.astimezone(timezone.utc)
        query_start, query_end = _apply_context(selected_start, selected_end, args)
        bucket = (args.get("bucket") or ("raw" if hours <= 2 else "5minute")).lower()
        limit = int(args.get("limit") or (900 if bucket == "5minute" else MAX_HISTORY_POINTS))
        return query_start, query_end, bucket, limit, "day", {
            "selected_date": selected.isoformat(),
            "selected_start": selected_start.isoformat(),
            "selected_end": selected_end.isoformat(),
            "window_hours": hours,
            "context": (args.get("context") or "none").lower(),
            "timezone": LOCAL_TIMEZONE,
        }

    if range_name == "custom":
        start = _parse_datetime(args.get("start")) or (now - timedelta(hours=1))
        end = _parse_datetime(args.get("end")) or now
        bucket = (args.get("bucket") or _bucket_for_span(end - start)).lower()
        limit = int(args.get("limit") or MAX_HISTORY_POINTS)
        return start, end, bucket, limit, range_name, {"timezone": LOCAL_TIMEZONE}

    config = RANGES.get(range_name, RANGES["live"])
    start = now - config["delta"]
    limit = int(args.get("limit") or config["limit"])
    return start, now, str(config["bucket"]), limit, range_name, {"timezone": LOCAL_TIMEZONE}


def history_response(database: DatabaseManager, args) -> Dict[str, Any]:
    start, end, bucket, limit, range_name, meta = resolve_range_with_meta(args)
    rows = database.history(start, end, bucket, limit)
    selected_start = _parse_datetime(meta.get("selected_start"))
    selected_end = _parse_datetime(meta.get("selected_end"))
    return {
        "range": range_name,
        "bucket": bucket,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "count": len(rows),
        **meta,
        "readings": [_reading_api_shape(row, selected_start, selected_end) for row in rows],
    }


def statistics_response(database: DatabaseManager, args) -> Dict[str, Any]:
    start, end, _, _, range_name, meta = resolve_range_with_meta(args)
    stats = database.daily_statistics(start, end)
    return {"range": range_name, "start": start.isoformat(), "end": end.isoformat(), **meta, **stats}


def analytics_response(database: DatabaseManager, args) -> Dict[str, Any]:
    start, end, _, _, range_name, meta = resolve_range_with_meta(args)
    return {
        "range": range_name,
        "start": start.isoformat(),
        "end": end.isoformat(),
        **meta,
        "analytics": database.analytics_for_range(start, end),
    }


def events_response(database: DatabaseManager, args) -> Dict[str, Any]:
    start, end, _, _, range_name, meta = resolve_range_with_meta(args)
    limit = int(args.get("limit") or 500)
    return {
        "range": range_name,
        "start": start.isoformat(),
        "end": end.isoformat(),
        **meta,
        "events": [_event_api_shape(row) for row in database.events(start, end, limit)],
    }


def alerts_response(database: DatabaseManager, args) -> Dict[str, Any]:
    limit = int(args.get("limit") or 50)
    return {"alerts": database.recent_alerts(limit)}


def export_rows(database: DatabaseManager, args) -> Tuple[Dict[str, Any], list[Dict[str, Any]]]:
    start, end, _, _, range_name, meta = resolve_range_with_meta(args)
    limit = int(args.get("limit") or MAX_EXPORT_ROWS)
    return {"range": range_name, "start": start.isoformat(), "end": end.isoformat(), **meta}, database.readings_for_export(start, end, limit)


def _selected_date(args, now: datetime, range_name: str) -> date:
    if args.get("date"):
        try:
            return date.fromisoformat(str(args.get("date")))
        except ValueError:
            return now.astimezone(LOCAL_TZ).date()
    today = now.astimezone(LOCAL_TZ).date()
    return today - timedelta(days=1) if range_name == "yesterday" else today


def _apply_context(start: datetime, end: datetime, args) -> Tuple[datetime, datetime]:
    context = (args.get("context") or "none").lower()
    if context in {"prev", "both"}:
        start -= timedelta(minutes=30)
    if context in {"next", "both"}:
        end += timedelta(minutes=30)
    return start, end


def _bucket_for_span(span: timedelta) -> str:
    if span <= timedelta(hours=2):
        return "raw"
    if span <= timedelta(hours=8):
        return "minute"
    if span <= timedelta(days=2):
        return "5minute"
    if span <= timedelta(days=31):
        return "hour"
    return "day"


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=LOCAL_TZ)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _reading_api_shape(
    row: Dict[str, Any],
    selected_start: datetime | None = None,
    selected_end: datetime | None = None,
) -> Dict[str, Any]:
    raw_values = {sensor: float(row[sensor] or 0) for sensor in GAS_SENSORS}
    gas_values = {sensor: mq_to_ppm(sensor, value) for sensor, value in raw_values.items()}
    gas_avg = sum(gas_values.values()) / len(gas_values)
    timestamp = row["timestamp"]
    parsed_timestamp = _parse_datetime(timestamp)
    context = "selected"
    if selected_start and parsed_timestamp and parsed_timestamp < selected_start:
        context = "previous"
    elif selected_end and parsed_timestamp and parsed_timestamp >= selected_end:
        context = "next"
    return {
        "timestamp": timestamp,
        "temp": round(float(row["temperature"] or 0), 2),
        "hum": round(float(row["humidity"] or 0), 2),
        "mq2": round(gas_values["mq2"], 2),
        "mq3": round(gas_values["mq3"], 2),
        "mq4": round(gas_values["mq4"], 2),
        "mq5": round(gas_values["mq5"], 2),
        "mq7": round(gas_values["mq7"], 2),
        "mq8": round(gas_values["mq8"], 2),
        **{f"{sensor}_adc": round(value, 2) for sensor, value in raw_values.items()},
        "gas": round(gas_avg, 2),
        "gas_unit": "estimated_ppm",
        "overall_aqi": round(float(row.get("overall_aqi", 0) or 0), 2),
        "status": row["status"],
        "reason": row.get("reason", ""),
        "confidence": round(float(row.get("confidence", 0) or 0), 3),
        "alert_sensor": row.get("alert_sensor"),
        "percent_increase": row.get("percent_increase"),
        "samples": row.get("samples", 1),
        "context": context,
        **_min_max(row),
    }


def _min_max(row: Dict[str, Any]) -> Dict[str, Any]:
    values: Dict[str, Any] = {}
    for sensor in ("temperature", "humidity", *GAS_SENSORS, "overall_aqi"):
        api_name = "temp" if sensor == "temperature" else "hum" if sensor == "humidity" else sensor
        convert = lambda _sensor, value: round(
            mq_to_ppm(_sensor, value) if _sensor in GAS_SENSORS else float(value or 0), 2
        )
        if f"min_{sensor}" in row:
            values[f"min_{api_name}"] = convert(sensor, row.get(f"min_{sensor}") or 0)
        if f"max_{sensor}" in row:
            values[f"max_{api_name}"] = convert(sensor, row.get(f"max_{sensor}") or 0)
    return values


def _event_api_shape(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "timestamp": row["timestamp"],
        "type": row.get("event_type", "status_change"),
        "status": row.get("status"),
        "reason": row.get("reason", ""),
        "alert_sensor": row.get("alert_sensor"),
        "percent_increase": row.get("percent_increase"),
        "serial_status": row.get("serial_status"),
        "arduino_connected": bool(row.get("arduino_connected")),
        "values": {
            "temp": row.get("temperature"),
            "hum": row.get("humidity"),
            **{sensor: mq_to_ppm(sensor, row.get(sensor)) for sensor in GAS_SENSORS},
            **{f"{sensor}_adc": round(float(row.get(sensor) or 0), 2) for sensor in GAS_SENSORS},
        },
        "gas_unit": "estimated_ppm",
    }
