"""EDUSENSE AI V7 local Flask backend with outbound cloud synchronization."""

from __future__ import annotations

import atexit
from datetime import timedelta
import os
from pathlib import Path
import platform
import subprocess
import time
from typing import Any, Dict

from flask import Blueprint, Flask, jsonify, render_template, request

from command_sender import CommandSender
from ai_reporter import AIReporter
from cloud_client import CloudClient
from config import (
    BAUD_RATE,
    BOOT_SCREEN_SECONDS,
    GAS_SENSORS,
    HOST,
    PORT,
    READING_STALE_AFTER_SECONDS,
    SERIAL_PORT,
    SENSOR_PROFILES,
)
from database import DatabaseManager, utc_now
from export_manager import ExportManager
from history import (
    alerts_response,
    analytics_response,
    events_response,
    history_response,
    resolve_range,
    statistics_response,
)
from ppm import mq_to_ppm
from safety_engine import SafetyEngine
from sensor_processor import SensorProcessor
from serial_reader import SerialReader
from wifi_setup import WifiProvisioner, create_setup_blueprint

try:
    import psutil
except ImportError:
    psutil = None  # type: ignore


APP_DIR = Path(__file__).resolve().parent
PUBLISHED_WEB_DIR = APP_DIR.parent / "web"
WEB_DIR = PUBLISHED_WEB_DIR if PUBLISHED_WEB_DIR.is_dir() else APP_DIR

app = Flask(
    __name__,
    template_folder=str(WEB_DIR),
    static_folder=str(WEB_DIR),
    static_url_path="",
)
api = Blueprint("api", __name__, url_prefix="/api")
started_at = time.time()

database = DatabaseManager()
cloud_client = CloudClient(database)
export_manager = ExportManager(database)
ai_reporter = AIReporter()
safety_engine = SafetyEngine()
serial_reader = SerialReader(port=SERIAL_PORT, baudrate=BAUD_RATE)
command_sender = CommandSender(serial_reader)
session_id = database.start_session(utc_now().isoformat(), platform.node())


def _serial_status_snapshot() -> Dict[str, Any]:
    connected = serial_reader.is_connected(READING_STALE_AFTER_SECONDS)
    return {
        "arduino_connected": connected,
        "serial_status": "connected" if connected else "disconnected",
        "serial_port": SERIAL_PORT,
        "last_error": serial_reader.last_error,
    }


def _system_snapshot() -> Dict[str, Any]:
    disk = psutil.disk_usage("/") if psutil else None
    memory = psutil.virtual_memory() if psutil else None
    return {
        "cpu_temp": _pi_temperature(),
        "cpu_usage": psutil.cpu_percent(interval=0.0) if psutil else 0,
        "ram_usage": memory.percent if memory else 0,
        "ram_total_mb": round(memory.total / 1024 / 1024) if memory else 0,
        "disk_usage": disk.percent if disk else 0,
        "disk_free_gb": round(disk.free / 1024 / 1024 / 1024, 2) if disk else 0,
    }


sensor_processor = SensorProcessor(
    database,
    safety_engine,
    command_sender,
    cloud_client=cloud_client,
    system_snapshot_provider=_system_snapshot,
    serial_status_provider=_serial_status_snapshot,
)
serial_reader.on_packet = sensor_processor.process
serial_reader.on_disconnect = command_sender.reset


def _handle_arduino_connect() -> None:
    command_sender.clear_outputs()
    sensor_processor.start_calibration()


serial_reader.on_connect = _handle_arduino_connect
wifi_provisioner = WifiProvisioner(cloud_client)
app.register_blueprint(create_setup_blueprint(wifi_provisioner))


def _init_serial() -> None:
    started = serial_reader.start()
    if not started:
        print(f"[EDUSENSE] Warning: {serial_reader.last_error}")


@app.route("/")
def index():
    return render_template("index.html")


@api.route("/sensors")
def api_sensors():
    return jsonify(sensor_processor.latest_for_api())


@api.route("/boot")
def api_boot():
    elapsed = max(0, int(time.time() - started_at))
    duration = max(0, BOOT_SCREEN_SECONDS)
    remaining = max(0, duration - elapsed)
    progress = 100.0 if duration == 0 else min(100, round((elapsed / duration) * 100, 2))
    return jsonify(
        {
            "product": "EDUSENSE AI V7",
            "subtitle": "Classroom Air Quality Monitor",
            "boot_started_at": started_at,
            "current_time": time.time(),
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "duration_seconds": duration,
            "estimated_completion_time": started_at + duration,
            "progress": progress,
            "timeline": [
                "Initializing System",
                "Loading Database",
                "Loading Historical Records",
                "Connecting Arduino",
                "Checking USB Serial",
                "Loading Safety Checks",
                "Preparing Dashboard",
                "Calibrating Sensors",
                "Ready",
            ],
        }
    )


@api.route("/calibration")
def api_calibration():
    return jsonify(safety_engine.calibration_state())


@api.route("/health")
def api_health():
    database.heartbeat_session(session_id, utc_now().isoformat())
    db_health = database.health()
    serial = _serial_status_snapshot()
    return jsonify(
        {
            **serial,
            "database": db_health,
            "database_status": "online" if db_health["ok"] else "error",
            "uptime_seconds": int(time.time() - started_at),
            "calibration": safety_engine.calibration_state(),
            "cloud": cloud_client.status(),
        }
    )


@api.route("/history")
def api_history():
    return jsonify(history_response(database, request.args))


@api.route("/system")
def api_system():
    database.heartbeat_session(session_id, utc_now().isoformat())
    db_health = database.health()
    serial = _serial_status_snapshot()
    timestamp = utc_now().isoformat()
    system = _system_snapshot()
    database.insert_system_metric(
        {
            "timestamp": timestamp,
            **system,
            "arduino_connected": 1 if serial["arduino_connected"] else 0,
            "serial_status": serial["serial_status"],
            "database_status": "online" if db_health["ok"] else "error",
        }
    )
    return jsonify(
        {
            "timestamp": timestamp,
            **system,
            **serial,
            "database_status": "online" if db_health["ok"] else "error",
            "database_path": db_health["path"],
            "database_readings": db_health["readings"],
            "system_uptime": _system_uptime(),
            "app_uptime_seconds": int(time.time() - started_at),
            "wifi_status": "connected",
            "pi_status": "online",
            "hostname": platform.node(),
            "power": database.power_summary(session_id),
            "calibration": safety_engine.calibration_state(),
            "cloud": cloud_client.status(),
            "mdns_hint": (
                "Install and enable Avahi, then set the Pi hostname to edusense "
                "for http://edusense.local:5000 on the LAN."
            ),
        }
    )


@api.route("/system/history")
def api_system_history():
    start, end, bucket, limit, range_name = resolve_range(request.args)
    rows = database.system_history(start, end, bucket, limit)
    return jsonify(
        {
            "range": range_name,
            "bucket": bucket,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "count": len(rows),
            "readings": rows,
        }
    )


@api.route("/statistics")
def api_statistics():
    return jsonify(statistics_response(database, request.args))


@api.route("/analytics")
def api_analytics():
    return jsonify(analytics_response(database, request.args))


@api.route("/ai/report", methods=["POST"])
def api_ai_report():
    payload = request.get_json(silent=True) or {}
    query = payload.get("query") or {}
    start, end, _, _, range_name = resolve_range(query)
    latest = sensor_processor.latest_for_api()
    evidence = {
        "range": range_name,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "status": latest.get("status", "CALIBRATING"),
        "reason": latest.get("reason", ""),
        "confidence": latest.get("confidence", 0),
        "analyses": latest.get("analyses", []),
        "analytics": database.analytics_for_range(start, end),
        "measurement_unit": "estimated_ppm",
    }
    return jsonify({"ok": True, **ai_reporter.generate(evidence), "range": range_name})


@api.route("/events")
def api_events():
    return jsonify(events_response(database, request.args))


@api.route("/sensor/<sensor>/summary")
def api_sensor_summary(sensor: str):
    sensor = {"temp": "temperature", "hum": "humidity"}.get(sensor.lower(), sensor.lower())
    start, end, bucket, limit, range_name = resolve_range(request.args)
    summary = database.sensor_summary(sensor, start, end, bucket, limit)
    if sensor in GAS_SENSORS:
        _annotate_ppm_summary(sensor, summary)
    latest = sensor_processor.latest_for_api()
    analysis = next(
        (item for item in latest.get("analyses", []) if item.get("sensor") == sensor),
        None,
    )
    label = SENSOR_PROFILES.get(sensor, {}).get("label", sensor.upper())
    status = latest.get("status", "CALIBRATING")
    current_value = latest.get(sensor if sensor not in {"temperature", "humidity"} else ("temp" if sensor == "temperature" else "hum"), None)
    summary.update(
        {
            "range": range_name,
            "bucket": bucket,
            "label": label,
            "system_status": status,
            "live_current": current_value,
            "analysis": analysis,
            "ai_suggestion": _sensor_suggestion(sensor, label, status, analysis, summary),
        }
    )
    return jsonify(summary)


def _annotate_ppm_summary(sensor: str, summary: Dict[str, Any]) -> None:
    for key in ("avg_value", "min_value", "max_value"):
        if summary.get(key) is not None:
            summary[f"{key}_adc"] = summary[key]
            summary[key] = mq_to_ppm(sensor, summary[key])
    summary["measurement_unit"] = "estimated_ppm"
    summary["measurement_note"] = "Estimated using the sensor R0 learned during the mandatory 200-second calibration; raw ADC is retained."


@api.route("/power")
def api_power():
    database.heartbeat_session(session_id, utc_now().isoformat())
    return jsonify(database.power_summary(session_id))


@api.route("/alerts")
def api_alerts():
    return jsonify(alerts_response(database, request.args))


@api.route("/export.csv")
def api_export_csv():
    return export_manager.csv_response(request.args)


@api.route("/export.png", methods=["POST"])
def api_export_png():
    return export_manager.png_response(request.get_json(silent=True) or {})


@api.route("/database/erase", methods=["POST"])
def api_database_erase():
    global session_id
    payload = request.get_json(silent=True) or {}
    if payload.get("confirm") != "ERASE EDUSENSE":
        return jsonify({"ok": False, "error": "Confirmation text did not match."}), 400
    database.erase_all_details()
    session_id = database.start_session(utc_now().isoformat(), platform.node())
    if hasattr(command_sender, "clear_outputs"):
        command_sender.clear_outputs()
    sensor_processor.start_calibration()
    return jsonify({"ok": True, "message": "Database details erased.", "current_session_id": session_id})


app.register_blueprint(api)


def _sensor_suggestion(
    sensor: str,
    label: str,
    status: str,
    analysis: Dict[str, Any] | None,
    summary: Dict[str, Any],
) -> str:
    status = str(status or "SAFE").upper()
    if status == "CALIBRATING":
        return f"{label} is being baselined against current room air. Keep conditions stable until calibration completes."
    if analysis:
        ranks = {"SAFE": 1, "ELEVATED": 2, "WARNING": 3, "DANGER": 4}
        analysis_severity = str(analysis.get("severity", "SAFE")).upper()
        effective_rank = min(ranks.get(status, 1), ranks.get(analysis_severity, 1))
        severity = next((name for name, rank in ranks.items() if rank == effective_rank), "SAFE")
        if severity == "DANGER":
            return f"{label} shows a critical sustained rise above baseline. Move occupants away, ventilate immediately, and inspect the likely source before resetting the alarm."
        if severity == "WARNING":
            return f"{label} is significantly above its calibrated baseline. Notify the responsible teacher, increase ventilation, and continue close observation."
        if severity == "ELEVATED":
            return f"{label} is trending above baseline. Improve airflow and monitor whether the rise continues or settles."
    avg_value = summary.get("avg_value")
    max_value = summary.get("max_value")
    if avg_value is not None and max_value is not None and max_value > avg_value * 1.7:
        return f"{label} has recent peaks above its average. Review the time window for matching classroom activity and watch for repeated spikes."
    return f"{label} remains stable across the selected history window. No immediate action is recommended."


def _close_current_session() -> None:
    try:
        cloud_client.stop()
        database.close_session(session_id, utc_now().isoformat(), "graceful")
    except Exception:
        pass


atexit.register(_close_current_session)


def _pi_temperature() -> float:
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r", encoding="utf-8") as handle:
            return round(int(handle.read().strip()) / 1000, 1)
    except (OSError, ValueError):
        pass

    try:
        result = subprocess.run(
            ["vcgencmd", "measure_temp"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        value = result.stdout.strip().replace("temp=", "").replace("'C", "")
        return round(float(value), 1)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def _system_uptime() -> str:
    if psutil:
        seconds = int(time.time() - psutil.boot_time())
    else:
        seconds = int(time.time() - started_at)
    return str(timedelta(seconds=seconds))


if __name__ == "__main__":
    cloud_client.start()
    _init_serial()
    app.run(host=HOST, port=PORT, debug=os.getenv("EDUSENSE_DEBUG") == "1", use_reloader=False)
