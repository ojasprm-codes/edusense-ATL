"""Reliable outbound-only synchronization between a classroom Pi and EDUSENSE Cloud."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import platform
import threading
import time
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from database import DatabaseManager, utc_now
from ppm import mq_to_ppm
LOGGER = logging.getLogger("edusense.cloud")
DEFAULT_CLOUD_URL = "https://edusense-cloud.ojasprm.workers.dev"


class CloudClient:
    """Uploads SQLite-backed batches without accepting inbound internet traffic."""

    def __init__(
        self,
        database: DatabaseManager,
        cloud_url: Optional[str] = None,
        credentials_path: Optional[Path] = None,
    ) -> None:
        self.database = database
        self.cloud_url = (cloud_url or os.getenv("EDUSENSE_CLOUD_URL", DEFAULT_CLOUD_URL)).rstrip("/")
        self.credentials_path = Path(
            credentials_path
            or os.getenv("EDUSENSE_DEVICE_CREDENTIALS", "/var/lib/edusense/device.json")
        )
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._wake = threading.Event()
        self._lock = threading.RLock()
        self._last_success: Optional[str] = None
        self._last_error = ""
        self._backoff_seconds = 2.0

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run, name="edusense-cloud-sync", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        self._wake.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)

    def notify_reading(self) -> None:
        self._wake.set()

    def status(self) -> Dict[str, Any]:
        credentials = self._load_credentials()
        with self._lock:
            return {
                "configured": bool(credentials),
                "cloud_url": self.cloud_url,
                "device_id": credentials.get("device_id") if credentials else None,
                "last_success": self._last_success,
                "last_error": self._last_error,
                "pending_readings": self.database.pending_cloud_count(),
            }

    def enroll(
        self,
        enrollment_token: str,
        hardware_serial: str,
        name: str,
        firmware_version: str = "EDUSENSE AI V7",
    ) -> Dict[str, Any]:
        payload = {
            "enrollmentToken": enrollment_token,
            "hardwareSerial": hardware_serial,
            "name": name,
            "firmwareVersion": firmware_version,
        }
        response = self._post_json("/api/device/enroll", payload, timeout=15)
        device_id = str(response.get("deviceId", ""))
        device_secret = str(response.get("deviceSecret", ""))
        if not device_id or not device_secret:
            raise RuntimeError("Cloud enrollment did not return device credentials")
        self._save_credentials(
            {
                "device_id": device_id,
                "device_secret": device_secret,
                "cloud_url": str(response.get("cloudUrl") or self.cloud_url).rstrip("/"),
                "hardware_serial": hardware_serial,
                "enrolled_at": utc_now().isoformat(),
            }
        )
        self.cloud_url = str(response.get("cloudUrl") or self.cloud_url).rstrip("/")
        self._wake.set()
        return {"device_id": device_id, "cloud_url": self.cloud_url}

    def _run(self) -> None:
        while self._running:
            credentials = self._load_credentials()
            if not credentials:
                self._wake.wait(timeout=10)
                self._wake.clear()
                continue
            uploaded_any = False
            try:
                for _ in range(12):
                    batch = self.database.pending_cloud_readings(60)
                    if not batch:
                        break
                    self._upload_batch(batch, credentials)
                    uploaded_any = True
                with self._lock:
                    self._last_error = ""
                    self._backoff_seconds = 2.0
                self._wake.wait(timeout=1 if uploaded_any else 5)
                self._wake.clear()
            except Exception as exc:  # Network failures must never affect local safety processing.
                with self._lock:
                    self._last_error = str(exc)[:300]
                    delay = self._backoff_seconds
                    self._backoff_seconds = min(60.0, self._backoff_seconds * 2)
                LOGGER.warning("Cloud synchronization paused: %s", exc)
                self._wake.wait(timeout=delay)
                self._wake.clear()

    def _upload_batch(self, rows: list[Dict[str, Any]], credentials: Dict[str, str]) -> None:
        payload = {
            "firmwareVersion": "EDUSENSE AI V7.3 PPM",
            "hostname": platform.node(),
            "measurementUnit": "ESTIMATED_PPM",
            "measurementNote": "Estimated ppm plus retained raw ADC; safety classification remains baseline-relative and Pi-authoritative.",
            "readings": [self._cloud_reading(row) for row in rows],
        }
        token = f"{credentials['device_id']}.{credentials['device_secret']}"
        self._post_json("/api/device/telemetry", payload, token=token, timeout=12)
        uploaded_at = utc_now().isoformat()
        self.database.mark_cloud_uploaded((int(row["id"]) for row in rows), uploaded_at)
        with self._lock:
            self._last_success = uploaded_at

    @staticmethod
    def _cloud_reading(row: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = datetime.fromisoformat(str(row["timestamp"]))
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return {
            "captured_at": int(timestamp.timestamp()),
            "temperature": row.get("temperature"),
            "humidity": row.get("humidity"),
            **{sensor: mq_to_ppm(sensor, row.get(sensor)) for sensor in ("mq2", "mq3", "mq4", "mq5", "mq7", "mq8")},
            **{f"{sensor}_adc": row.get(sensor) for sensor in ("mq2", "mq3", "mq4", "mq5", "mq7", "mq8")},
            "overall_aqi": row.get("overall_aqi"),
            "ai_status": row.get("status", "CALIBRATING"),
            "confidence": float(row.get("confidence") or 0) * 100,
            "reason": row.get("reason"),
            "pi_cpu_temp": row.get("pi_cpu_temp"),
            "cpu_usage": row.get("cpu_usage"),
            "ram_usage": row.get("ram_usage"),
            "disk_usage": row.get("disk_usage"),
            "arduino_connected": bool(row.get("arduino_connected")),
            "serial_status": row.get("serial_status"),
        }

    def _post_json(
        self,
        path: str,
        payload: Dict[str, Any],
        token: Optional[str] = None,
        timeout: int = 10,
    ) -> Dict[str, Any]:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers = {"Content-Type": "application/json", "User-Agent": "EDUSENSE-Pi/7"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(f"{self.cloud_url}{path}", data=body, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error", "")
            except Exception:
                detail = ""
            raise RuntimeError(f"Cloud returned HTTP {exc.code}: {detail or exc.reason}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f"Cloud is unreachable: {exc}") from exc

    def _load_credentials(self) -> Optional[Dict[str, str]]:
        try:
            data = json.loads(self.credentials_path.read_text(encoding="utf-8"))
            if data.get("device_id") and data.get("device_secret"):
                if data.get("cloud_url"):
                    self.cloud_url = str(data["cloud_url"]).rstrip("/")
                return data
        except (OSError, ValueError, TypeError):
            return None
        return None

    def _save_credentials(self, data: Dict[str, str]) -> None:
        self.credentials_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.credentials_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.credentials_path)
