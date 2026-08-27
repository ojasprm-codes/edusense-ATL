"""Coordinates packet processing, persistence, AI decisions, and commands."""

from __future__ import annotations

import threading
from typing import Any, Callable, Dict, Optional

from database import DatabaseManager, utc_now
from ppm import calibrate_mq_from_clean_air, mq_to_ppm
from safety_engine import SafetyEngine


SystemSnapshotProvider = Callable[[], Dict[str, Any]]
SerialStatusProvider = Callable[[], Dict[str, Any]]


class SensorProcessor:
    """Processes one complete Arduino sensor packet per second."""

    def __init__(
        self,
        database: DatabaseManager,
        safety_engine: SafetyEngine,
        command_sender,
        cloud_client=None,
        system_snapshot_provider: Optional[SystemSnapshotProvider] = None,
        serial_status_provider: Optional[SerialStatusProvider] = None,
    ):
        self.database = database
        self.safety_engine = safety_engine
        self.command_sender = command_sender
        self.cloud_client = cloud_client
        self.system_snapshot_provider = system_snapshot_provider or (lambda: {})
        self.serial_status_provider = serial_status_provider or (lambda: {})
        self._lock = threading.RLock()
        self._latest = self._default_reading()
        self.start_calibration()

    def start_calibration(self) -> None:
        now = utc_now()
        self.safety_engine.start_calibration(now)
        if hasattr(self.command_sender, "reset"):
            self.command_sender.reset()
        with self._lock:
            current = dict(self._latest)
            current["status"] = "CALIBRATING"
            current["reason"] = "Stabilizing gas sensors for accurate baseline generation."
            current["calibration"] = self.safety_engine.calibration_state(now)
            self._latest = current

    def process(self, packet: Dict[str, Any]) -> Dict[str, Any]:
        now = utc_now()
        timestamp = now.isoformat()
        normalized = {
            "timestamp": timestamp,
            "temperature": round(float(packet["temperature"]), 1),
            "humidity": round(float(packet["humidity"]), 1),
            "mq2": int(packet["mq2"]),
            "mq3": int(packet["mq3"]),
            "mq4": int(packet["mq4"]),
            "mq5": int(packet["mq5"]),
            "mq7": int(packet["mq7"]),
            "mq8": int(packet["mq8"]),
        }

        was_calibrating = self.safety_engine.is_calibrating()
        if was_calibrating:
            decision = self.safety_engine.process_calibration(normalized, now)
        else:
            decision = self.safety_engine.evaluate(normalized, now)
        calibration = self.safety_engine.calibration_state(now)
        if was_calibrating and not calibration.get("active"):
            calibrate_mq_from_clean_air(calibration.get("baseline", {}))
        system = self.system_snapshot_provider()
        serial = self.serial_status_provider()

        reading = {
            **normalized,
            "overall_aqi": decision.overall_aqi,
            "status": decision.status,
            "reason": decision.reason,
            "confidence": decision.confidence,
            "alert_sensor": decision.sensor,
            "percent_increase": decision.percent_increase,
            "pi_cpu_temp": float(system.get("cpu_temp", 0) or 0),
            "cpu_usage": float(system.get("cpu_usage", 0) or 0),
            "ram_usage": float(system.get("ram_usage", 0) or 0),
            "disk_usage": float(system.get("disk_usage", 0) or 0),
            "arduino_connected": 1 if serial.get("arduino_connected") else 0,
            "serial_status": str(serial.get("serial_status", "unknown")),
        }

        # Calibration samples are first-class history and are also needed for a
        # complete, power-loss-safe cloud backlog.
        self.database.insert_reading(reading)
        if self.cloud_client is not None:
            self.cloud_client.notify_reading()

        if decision.status in {"SAFE", "ELEVATED", "WARNING", "DANGER"}:
            self.command_sender.send_status_if_changed(decision.status)
            if decision.status in {"WARNING", "DANGER"}:
                self.database.insert_alert(
                    {
                        "timestamp": timestamp,
                        "status": decision.status,
                        "message": decision.reason,
                        "sensor": decision.sensor,
                        "percent_increase": decision.percent_increase,
                        "confidence": decision.confidence,
                    }
                )

        api_reading = {
            **reading,
            "calibration": calibration,
            "analyses": [analysis.__dict__ for analysis in decision.analyses],
        }
        with self._lock:
            self._latest = dict(api_reading)
        return api_reading

    def latest(self) -> Dict[str, Any]:
        with self._lock:
            latest = dict(self._latest)
        if latest["timestamp"] is None:
            stored = self.database.latest_reading()
            if stored:
                latest = dict(stored)
                latest["analyses"] = []
        latest["calibration"] = self.safety_engine.calibration_state()
        return latest

    @staticmethod
    def _api_shape(reading: Dict[str, Any]) -> Dict[str, Any]:
        sensors = ("mq2", "mq3", "mq4", "mq5", "mq7", "mq8")
        raw_values = {sensor: float(reading.get(sensor, 0) or 0) for sensor in sensors}
        ppm_values = {sensor: mq_to_ppm(sensor, value) for sensor, value in raw_values.items()}
        gas_avg = sum(ppm_values.values()) / len(ppm_values)
        return {
            "timestamp": reading.get("timestamp"),
            "temp": reading.get("temperature", 0.0),
            "hum": reading.get("humidity", 0.0),
            **ppm_values,
            **{f"{sensor}_adc": value for sensor, value in raw_values.items()},
            "gas": round(gas_avg, 2),
            "gas_unit": "estimated_ppm",
            "measurement_note": "Estimated from ADC and the 200-second clean-air R0 baseline; not certified ppm.",
            "overall_aqi": reading.get("overall_aqi", 0),
            "status": reading.get("status", "CALIBRATING"),
            "reason": reading.get("reason", ""),
            "confidence": reading.get("confidence", 0),
            "alert_sensor": reading.get("alert_sensor"),
            "percent_increase": reading.get("percent_increase"),
            "calibration": reading.get("calibration", {}),
            "analyses": reading.get("analyses", []),
        }

    def latest_for_api(self) -> Dict[str, Any]:
        return self._api_shape(self.latest())

    @staticmethod
    def _default_reading() -> Dict[str, Any]:
        return {
            "timestamp": None,
            "temperature": 0.0,
            "humidity": 0.0,
            "mq2": 0,
            "mq3": 0,
            "mq4": 0,
            "mq5": 0,
            "mq7": 0,
            "mq8": 0,
            "overall_aqi": 0.0,
            "status": "CALIBRATING",
            "reason": "Stabilizing gas sensors for accurate baseline generation.",
            "confidence": 0.0,
            "calibration": {},
            "analyses": [],
        }
