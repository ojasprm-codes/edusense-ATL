"""SQLite persistence layer for EDUSENSE AI V7 readings, alerts, sessions, and cloud sync."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

from config import DATABASE_PATH, GAS_SENSORS, SENSORS


READING_COLUMNS = {
    "timestamp": "TEXT NOT NULL",
    "temperature": "REAL NOT NULL DEFAULT 0",
    "humidity": "REAL NOT NULL DEFAULT 0",
    "mq2": "INTEGER NOT NULL DEFAULT 0",
    "mq3": "INTEGER NOT NULL DEFAULT 0",
    "mq4": "INTEGER NOT NULL DEFAULT 0",
    "mq5": "INTEGER NOT NULL DEFAULT 0",
    "mq7": "INTEGER NOT NULL DEFAULT 0",
    "mq8": "INTEGER NOT NULL DEFAULT 0",
    "overall_aqi": "REAL NOT NULL DEFAULT 0",
    "status": "TEXT NOT NULL DEFAULT 'CALIBRATING'",
    "reason": "TEXT NOT NULL DEFAULT ''",
    "confidence": "REAL NOT NULL DEFAULT 0",
    "alert_sensor": "TEXT",
    "percent_increase": "REAL",
    "pi_cpu_temp": "REAL NOT NULL DEFAULT 0",
    "cpu_usage": "REAL NOT NULL DEFAULT 0",
    "ram_usage": "REAL NOT NULL DEFAULT 0",
    "disk_usage": "REAL NOT NULL DEFAULT 0",
    "arduino_connected": "INTEGER NOT NULL DEFAULT 0",
    "serial_status": "TEXT NOT NULL DEFAULT 'unknown'",
    "cloud_uploaded_at": "TEXT",
}

SYSTEM_METRIC_COLUMNS = {
    "timestamp": "TEXT NOT NULL",
    "cpu_temp": "REAL NOT NULL DEFAULT 0",
    "cpu_usage": "REAL NOT NULL DEFAULT 0",
    "ram_usage": "REAL NOT NULL DEFAULT 0",
    "ram_total_mb": "REAL NOT NULL DEFAULT 0",
    "disk_usage": "REAL NOT NULL DEFAULT 0",
    "disk_free_gb": "REAL NOT NULL DEFAULT 0",
    "arduino_connected": "INTEGER NOT NULL DEFAULT 0",
    "serial_status": "TEXT NOT NULL DEFAULT 'unknown'",
    "database_status": "TEXT NOT NULL DEFAULT 'unknown'",
}


class DatabaseManager:
    """Thread-safe SQLite wrapper using short-lived prepared operations."""

    def __init__(self, path: Path = DATABASE_PATH):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS readings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL
                )
                """
            )
            self._ensure_columns(conn, "readings", READING_COLUMNS)
            conn.executescript(
                """
                CREATE INDEX IF NOT EXISTS idx_readings_timestamp
                    ON readings(timestamp);

                CREATE INDEX IF NOT EXISTS idx_readings_status_timestamp
                    ON readings(status, timestamp);

                CREATE INDEX IF NOT EXISTS idx_readings_timestamp_status_aqi
                    ON readings(timestamp, status, overall_aqi);

                CREATE INDEX IF NOT EXISTS idx_readings_serial_timestamp
                    ON readings(serial_status, timestamp);

                CREATE INDEX IF NOT EXISTS idx_readings_cloud_pending
                    ON readings(cloud_uploaded_at, id);

                CREATE TABLE IF NOT EXISTS alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL,
                    sensor TEXT,
                    percent_increase REAL,
                    confidence REAL NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_alerts_timestamp
                    ON alerts(timestamp);

                CREATE TABLE IF NOT EXISTS app_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    boot_timestamp TEXT NOT NULL,
                    shutdown_timestamp TEXT,
                    last_seen_timestamp TEXT NOT NULL,
                    hostname TEXT NOT NULL DEFAULT '',
                    app_version TEXT NOT NULL DEFAULT 'EDUSENSE AI V7',
                    shutdown_type TEXT NOT NULL DEFAULT 'running'
                );

                CREATE INDEX IF NOT EXISTS idx_app_sessions_boot
                    ON app_sessions(boot_timestamp);

                CREATE TABLE IF NOT EXISTS system_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp
                    ON system_metrics(timestamp);
                """
            )
            self._ensure_columns(conn, "system_metrics", SYSTEM_METRIC_COLUMNS)
            self._ensure_columns(conn, "alerts", {"confidence": "REAL NOT NULL DEFAULT 0"})
            self._ensure_columns(
                conn,
                "app_sessions",
                {
                    "last_seen_timestamp": "TEXT NOT NULL DEFAULT ''",
                    "hostname": "TEXT NOT NULL DEFAULT ''",
                    "app_version": "TEXT NOT NULL DEFAULT 'EDUSENSE AI V7'",
                    "shutdown_type": "TEXT NOT NULL DEFAULT 'running'",
                },
            )

    @staticmethod
    def _ensure_columns(conn: sqlite3.Connection, table: str, columns: Dict[str, str]) -> None:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")

    def insert_reading(self, reading: Dict[str, Any]) -> int:
        columns = list(READING_COLUMNS.keys())
        placeholders = ", ".join("?" for _ in columns)
        values = [reading.get(column) for column in columns]
        with self.connect() as conn:
            cursor = conn.execute(
                f"INSERT INTO readings ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
            return int(cursor.lastrowid)

    def insert_alert(self, alert: Dict[str, Any]) -> int:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO alerts (
                    timestamp, status, message, sensor, percent_increase, confidence
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    alert["timestamp"],
                    alert["status"],
                    alert["message"],
                    alert.get("sensor"),
                    alert.get("percent_increase"),
                    alert.get("confidence", 0),
                ),
            )
            return int(cursor.lastrowid)

    def insert_system_metric(self, metric: Dict[str, Any]) -> int:
        columns = list(SYSTEM_METRIC_COLUMNS.keys())
        placeholders = ", ".join("?" for _ in columns)
        values = [metric.get(column) for column in columns]
        with self.connect() as conn:
            cursor = conn.execute(
                f"INSERT INTO system_metrics ({', '.join(columns)}) VALUES ({placeholders})",
                values,
            )
            return int(cursor.lastrowid)

    def system_history(self, start: datetime, end: datetime, bucket: str, limit: int) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            if bucket == "raw":
                rows = conn.execute(
                    """
                    SELECT *
                    FROM system_metrics
                    WHERE timestamp >= ? AND timestamp < ?
                    ORDER BY timestamp ASC, id ASC
                    LIMIT ?
                    """,
                    (start.isoformat(), end.isoformat(), limit),
                ).fetchall()
                return [dict(row) for row in rows]

            expression = self._bucket_expression(bucket)
            rows = conn.execute(
                f"""
                SELECT
                    MIN(timestamp) AS timestamp,
                    AVG(cpu_temp) AS cpu_temp,
                    AVG(cpu_usage) AS cpu_usage,
                    AVG(ram_usage) AS ram_usage,
                    AVG(ram_total_mb) AS ram_total_mb,
                    AVG(disk_usage) AS disk_usage,
                    AVG(disk_free_gb) AS disk_free_gb,
                    MAX(arduino_connected) AS arduino_connected,
                    MAX(serial_status) AS serial_status,
                    MAX(database_status) AS database_status,
                    COUNT(id) AS samples
                FROM (
                    SELECT *, {expression} AS bucket_key
                    FROM system_metrics
                    WHERE timestamp >= ? AND timestamp < ?
                )
                GROUP BY bucket_key
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                (start.isoformat(), end.isoformat(), limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def latest_reading(self) -> Optional[Dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM readings ORDER BY timestamp DESC, id DESC LIMIT 1"
            ).fetchone()
            return dict(row) if row else None

    def baseline(self, minutes: int, before_timestamp: str) -> Dict[str, Optional[float]]:
        before = datetime.fromisoformat(before_timestamp)
        after = before - timedelta(minutes=minutes)
        with self.connect() as conn:
            row = conn.execute(
                f"""
                SELECT COUNT(*) AS sample_count,
                       {", ".join(f"AVG({sensor}) AS {sensor}" for sensor in SENSORS)}
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                  AND status != 'CALIBRATING'
                """,
                (after.isoformat(), before_timestamp),
            ).fetchone()
            data = dict(row) if row else {}
            data["sample_count"] = row["sample_count"] if row else 0
            return data

    def history(self, start: datetime, end: datetime, bucket: str, limit: int) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            if bucket == "raw":
                rows = conn.execute(
                    """
                    SELECT *
                    FROM readings
                    WHERE timestamp >= ? AND timestamp < ?
                    ORDER BY timestamp ASC, id ASC
                    LIMIT ?
                    """,
                    (start.isoformat(), end.isoformat(), limit),
                ).fetchall()
                return [dict(row) for row in rows]

            expression = self._bucket_expression(bucket)
            sensor_select = ", ".join(
                f"AVG(bucketed.{column}) AS {column}, "
                f"MIN(bucketed.{column}) AS min_{column}, "
                f"MAX(bucketed.{column}) AS max_{column}"
                for column in (
                    "temperature",
                    "humidity",
                    "mq2",
                    "mq3",
                    "mq4",
                    "mq5",
                    "mq7",
                    "mq8",
                    "overall_aqi",
                    "pi_cpu_temp",
                    "cpu_usage",
                    "ram_usage",
                    "disk_usage",
                )
            )
            rows = conn.execute(
                f"""
                WITH bucketed AS (
                    SELECT
                        *,
                        {expression} AS bucket_key,
                        CASE status
                            WHEN 'DANGER' THEN 4
                            WHEN 'WARNING' THEN 3
                            WHEN 'ELEVATED' THEN 2
                            WHEN 'SAFE' THEN 1
                            ELSE 0
                        END AS severity_rank
                    FROM readings
                    WHERE timestamp >= ? AND timestamp < ?
                ),
                ranked AS (
                    SELECT *,
                           ROW_NUMBER() OVER (
                               PARTITION BY bucket_key
                               ORDER BY severity_rank DESC, timestamp DESC, id DESC
                           ) AS rn
                    FROM bucketed
                )
                SELECT
                    MIN(bucketed.timestamp) AS timestamp,
                    {sensor_select},
                    ranked.status,
                    ranked.reason,
                    ranked.confidence,
                    ranked.alert_sensor,
                    ranked.percent_increase,
                    ranked.arduino_connected,
                    ranked.serial_status,
                    COUNT(bucketed.id) AS samples
                FROM bucketed
                JOIN ranked ON ranked.bucket_key = bucketed.bucket_key AND ranked.rn = 1
                GROUP BY bucketed.bucket_key
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                (start.isoformat(), end.isoformat(), limit),
            ).fetchall()
            return [dict(row) for row in rows]

    @staticmethod
    def _bucket_expression(bucket: str) -> str:
        if bucket == "minute":
            return "strftime('%Y-%m-%dT%H:%M:00', timestamp)"
        if bucket == "5minute":
            return (
                "strftime('%Y-%m-%dT%H:', timestamp) || "
                "printf('%02d:00', (CAST(strftime('%M', timestamp) AS INTEGER) / 5) * 5)"
            )
        if bucket == "hour":
            return "strftime('%Y-%m-%dT%H:00:00', timestamp)"
        if bucket == "day":
            return "strftime('%Y-%m-%dT00:00:00', timestamp)"
        return "strftime('%Y-%m-%dT%H:%M:00', timestamp)"

    def readings_for_export(self, start: datetime, end: datetime, limit: int) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT timestamp, temperature, humidity, mq2, mq3, mq4, mq5, mq7, mq8,
                       overall_aqi, status, reason, confidence, alert_sensor,
                       percent_increase, arduino_connected, serial_status
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                ORDER BY timestamp ASC, id ASC
                LIMIT ?
                """,
                (start.isoformat(), end.isoformat(), limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def pending_cloud_readings(self, limit: int = 60) -> List[Dict[str, Any]]:
        """Return locally durable readings that have not reached the cloud yet."""
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM readings
                WHERE cloud_uploaded_at IS NULL
                ORDER BY id ASC
                LIMIT ?
                """,
                (max(1, min(int(limit), 60)),),
            ).fetchall()
            return [dict(row) for row in rows]

    def mark_cloud_uploaded(self, reading_ids: Iterable[int], uploaded_at: str) -> None:
        ids = [int(value) for value in reading_ids]
        if not ids:
            return
        placeholders = ", ".join("?" for _ in ids)
        with self.connect() as conn:
            conn.execute(
                f"UPDATE readings SET cloud_uploaded_at = ? WHERE id IN ({placeholders})",
                [uploaded_at, *ids],
            )

    def pending_cloud_count(self) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS count FROM readings WHERE cloud_uploaded_at IS NULL"
            ).fetchone()
            return int(row["count"] if row else 0)

    def daily_statistics(self, start: datetime, end: datetime) -> Dict[str, Any]:
        sensor_select = ", ".join(
            f"AVG({s}) AS avg_{s}, MIN({s}) AS min_{s}, MAX({s}) AS max_{s}"
            for s in SENSORS
        )
        with self.connect() as conn:
            daily = conn.execute(
                f"""
                SELECT DATE(timestamp) AS day, {sensor_select}, AVG(overall_aqi) AS avg_aqi
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                  AND status != 'CALIBRATING'
                GROUP BY DATE(timestamp)
                ORDER BY day ASC
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchall()
            overall = conn.execute(
                f"""
                SELECT COUNT(*) AS sample_count, AVG(overall_aqi) AS avg_aqi, {sensor_select}
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                  AND status != 'CALIBRATING'
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchone()
            rows = conn.execute(
                """
                SELECT timestamp, status
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                  AND status != 'CALIBRATING'
                ORDER BY timestamp ASC
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchall()

        return {
            "daily": [dict(row) for row in daily],
            "overall": dict(overall) if overall else {},
            "durations": self._status_durations(rows, end),
        }

    def analytics_for_range(self, start: datetime, end: datetime) -> Dict[str, Any]:
        sensor_select = ", ".join(
            f"AVG({s}) AS avg_{s}, MIN({s}) AS min_{s}, MAX({s}) AS max_{s}"
            for s in SENSORS
        )
        with self.connect() as conn:
            overall = conn.execute(
                f"""
                SELECT COUNT(*) AS sample_count,
                       MIN(timestamp) AS first_reading,
                       MAX(timestamp) AS last_reading,
                       AVG(overall_aqi) AS avg_aqi,
                       MAX(overall_aqi) AS max_aqi,
                       SUM(CASE WHEN status = 'WARNING' THEN 1 ELSE 0 END) AS warning_samples,
                       SUM(CASE WHEN status = 'DANGER' THEN 1 ELSE 0 END) AS danger_samples,
                       SUM(CASE WHEN arduino_connected = 1 THEN 1 ELSE 0 END) AS connected_samples,
                       {sensor_select}
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                  AND status != 'CALIBRATING'
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchone()
            status_rows = conn.execute(
                """
                SELECT timestamp, status
                FROM readings
                WHERE timestamp >= ? AND timestamp < ?
                  AND status != 'CALIBRATING'
                ORDER BY timestamp ASC, id ASC
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchall()
            event_counts = conn.execute(
                """
                SELECT status, COUNT(*) AS count
                FROM alerts
                WHERE timestamp >= ? AND timestamp < ?
                GROUP BY status
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchall()

        data = dict(overall) if overall else {}
        sample_count = int(data.get("sample_count") or 0)
        expected_seconds = max(1, int((end - start).total_seconds()))
        connected_samples = int(data.get("connected_samples") or 0)
        data["durations"] = self._status_durations(status_rows, end)
        data["warning_events"] = 0
        data["danger_events"] = 0
        for row in event_counts:
            if row["status"] == "WARNING":
                data["warning_events"] = row["count"]
            elif row["status"] == "DANGER":
                data["danger_events"] = row["count"]
        data["data_coverage_pct"] = round(min(100.0, (sample_count / expected_seconds) * 100), 2)
        data["arduino_uptime_pct"] = (
            round(min(100.0, (connected_samples / max(sample_count, 1)) * 100), 2)
            if sample_count else 0.0
        )
        data["range_seconds"] = expected_seconds
        return data

    def events(self, start: datetime, end: datetime, limit: int = 500) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                WITH ordered AS (
                    SELECT *,
                           LAG(status) OVER (ORDER BY timestamp ASC, id ASC) AS previous_status,
                           LAG(serial_status) OVER (ORDER BY timestamp ASC, id ASC) AS previous_serial
                    FROM readings
                    WHERE timestamp >= ? AND timestamp < ?
                      AND status != 'CALIBRATING'
                )
                SELECT timestamp, status, reason, alert_sensor, percent_increase,
                       temperature, humidity, mq2, mq3, mq4, mq5, mq7, mq8,
                       serial_status, arduino_connected,
                       CASE
                           WHEN previous_status IS NULL THEN 'range_start'
                           WHEN status != previous_status THEN 'status_change'
                           WHEN previous_serial IS NOT NULL AND serial_status != previous_serial THEN 'serial_change'
                           ELSE 'sample'
                       END AS event_type
                FROM ordered
                WHERE previous_status IS NULL
                   OR status != previous_status
                   OR (previous_serial IS NOT NULL AND serial_status != previous_serial)
                ORDER BY timestamp ASC
                LIMIT ?
                """,
                (start.isoformat(), end.isoformat(), limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def recent_alerts(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM alerts ORDER BY timestamp DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def start_session(self, boot_timestamp: str, hostname: str) -> int:
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE app_sessions
                SET shutdown_timestamp = COALESCE(shutdown_timestamp, ?),
                    shutdown_type = 'interrupted_or_power_loss'
                WHERE shutdown_timestamp IS NULL
                  AND shutdown_type = 'running'
                """,
                (boot_timestamp,),
            )
            cursor = conn.execute(
                """
                INSERT INTO app_sessions (
                    boot_timestamp, last_seen_timestamp, hostname, app_version, shutdown_type
                ) VALUES (?, ?, ?, 'EDUSENSE AI V7', 'running')
                """,
                (boot_timestamp, boot_timestamp, hostname),
            )
            return int(cursor.lastrowid)

    def heartbeat_session(self, session_id: int, timestamp: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE app_sessions
                SET last_seen_timestamp = ?
                WHERE id = ? AND shutdown_type = 'running'
                """,
                (timestamp, session_id),
            )

    def close_session(self, session_id: int, timestamp: str, shutdown_type: str = "graceful") -> None:
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE app_sessions
                SET shutdown_timestamp = ?,
                    last_seen_timestamp = ?,
                    shutdown_type = ?
                WHERE id = ?
                """,
                (timestamp, timestamp, shutdown_type, session_id),
            )

    def power_summary(self, current_session_id: int) -> Dict[str, Any]:
        with self.connect() as conn:
            sessions = conn.execute(
                """
                SELECT *
                FROM app_sessions
                ORDER BY boot_timestamp DESC, id DESC
                LIMIT 8
                """
            ).fetchall()
            previous = conn.execute(
                """
                SELECT *
                FROM app_sessions
                WHERE id != ?
                ORDER BY boot_timestamp DESC, id DESC
                LIMIT 1
                """,
                (current_session_id,),
            ).fetchone()
            last_reading = conn.execute(
                """
                SELECT timestamp, status, overall_aqi, temperature, humidity,
                       mq2, mq3, mq4, mq5, mq7, mq8
                FROM readings
                ORDER BY timestamp DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
            count = conn.execute("SELECT COUNT(*) AS c FROM readings").fetchone()["c"]

        return {
            "current_session_id": current_session_id,
            "previous_session": dict(previous) if previous else None,
            "recent_sessions": [dict(row) for row in sessions],
            "last_stored_reading": dict(last_reading) if last_reading else None,
            "stored_reading_count": count,
            "storage_note": (
                "The Raspberry Pi cannot collect new Arduino packets while powered off, "
                "but EDUSENSE AI V7 permanently preserves the last stored readings and "
                "records whether the previous app session ended gracefully or was interrupted."
            ),
        }

    def sensor_summary(
        self,
        sensor: str,
        start: datetime,
        end: datetime,
        bucket: str,
        limit: int,
    ) -> Dict[str, Any]:
        if sensor not in set(SENSORS):
            raise ValueError(f"Unsupported sensor: {sensor}")

        with self.connect() as conn:
            latest = conn.execute(
                f"""
                SELECT timestamp, {sensor} AS value, status, reason
                FROM readings
                WHERE timestamp BETWEEN ? AND ?
                ORDER BY timestamp DESC, id DESC
                LIMIT 1
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchone()
            stats = conn.execute(
                f"""
                SELECT COUNT(*) AS sample_count,
                       MIN({sensor}) AS min_value,
                       MAX({sensor}) AS max_value,
                       AVG({sensor}) AS avg_value
                FROM readings
                WHERE timestamp BETWEEN ? AND ?
                """,
                (start.isoformat(), end.isoformat()),
            ).fetchone()

            if bucket == "raw":
                rows = conn.execute(
                    f"""
                    SELECT timestamp, {sensor} AS value, status
                    FROM readings
                    WHERE timestamp BETWEEN ? AND ?
                    ORDER BY timestamp ASC, id ASC
                    LIMIT ?
                    """,
                    (start.isoformat(), end.isoformat(), limit),
                ).fetchall()
            else:
                expression = self._bucket_expression(bucket)
                rows = conn.execute(
                    f"""
                    WITH bucketed AS (
                        SELECT *,
                               {expression} AS bucket_key,
                               CASE status
                                   WHEN 'DANGER' THEN 4
                                   WHEN 'WARNING' THEN 3
                                   WHEN 'ELEVATED' THEN 2
                                   WHEN 'SAFE' THEN 1
                                   ELSE 0
                               END AS severity_rank
                        FROM readings
                        WHERE timestamp BETWEEN ? AND ?
                    ),
                    ranked AS (
                        SELECT *,
                               ROW_NUMBER() OVER (
                                   PARTITION BY bucket_key
                                   ORDER BY severity_rank DESC, timestamp DESC, id DESC
                               ) AS rn
                        FROM bucketed
                    )
                    SELECT MIN(bucketed.timestamp) AS timestamp,
                           AVG(bucketed.{sensor}) AS value,
                           ranked.status
                    FROM bucketed
                    JOIN ranked ON ranked.bucket_key = bucketed.bucket_key AND ranked.rn = 1
                    GROUP BY bucketed.bucket_key
                    ORDER BY timestamp ASC
                    LIMIT ?
                    """,
                    (start.isoformat(), end.isoformat(), limit),
                ).fetchall()

        summary = dict(stats) if stats else {}
        return {
            "sensor": sensor,
            "is_gas_sensor": sensor in GAS_SENSORS,
            "current": dict(latest) if latest else None,
            "sample_count": summary.get("sample_count", 0),
            "min_value": summary.get("min_value"),
            "max_value": summary.get("max_value"),
            "avg_value": summary.get("avg_value"),
            "readings": [dict(row) for row in rows],
        }

    def health(self) -> Dict[str, Any]:
        try:
            with self.connect() as conn:
                conn.execute("SELECT 1").fetchone()
                count = conn.execute("SELECT COUNT(*) AS c FROM readings").fetchone()["c"]
            return {"ok": True, "path": str(self.path), "readings": count, "error": ""}
        except sqlite3.Error as exc:
            return {"ok": False, "path": str(self.path), "readings": 0, "error": str(exc)}

    def erase_all_details(self) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM readings")
            conn.execute("DELETE FROM alerts")
            conn.execute("DELETE FROM system_metrics")
            conn.execute("DELETE FROM app_sessions")
            conn.execute(
                "DELETE FROM sqlite_sequence WHERE name IN ('readings', 'alerts', 'system_metrics', 'app_sessions')"
            )

    @staticmethod
    def _status_durations(rows: Iterable[sqlite3.Row], end: datetime) -> Dict[str, int]:
        durations = {"CALIBRATING": 0, "SAFE": 0, "ELEVATED": 0, "WARNING": 0, "DANGER": 0}
        previous: Optional[Tuple[datetime, str]] = None
        for row in rows:
            current_time = datetime.fromisoformat(row["timestamp"])
            if previous:
                previous_time, previous_status = previous
                durations[previous_status] = durations.get(previous_status, 0) + max(
                    0, int((current_time - previous_time).total_seconds())
                )
            previous = (current_time, row["status"])
        if previous:
            previous_time, previous_status = previous
            durations[previous_status] = durations.get(previous_status, 0) + max(
                0, int((end - previous_time).total_seconds())
            )
        return durations


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
