"""Export services for EDUSENSE AI V7."""

from __future__ import annotations

import base64
import csv
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any, Dict, Iterable

from flask import Response, jsonify

from config import BASE_DIR, GAS_SENSORS
from database import DatabaseManager
from history import export_rows
from ppm import mq_to_ppm


EXPORT_DIR = BASE_DIR / "exports"


class ExportManager:
    """Creates lightweight CSV/PNG exports without blocking live acquisition."""

    CSV_FIELDS = [
        "timestamp",
        "temperature",
        "humidity",
        "measurement_unit",
        "gas_average_estimated_ppm",
        "mq2_estimated_ppm",
        "mq3_estimated_ppm",
        "mq4_estimated_ppm",
        "mq5_estimated_ppm",
        "mq7_estimated_ppm",
        "mq8_estimated_ppm",
        "mq2_adc",
        "mq3_adc",
        "mq4_adc",
        "mq5_adc",
        "mq7_adc",
        "mq8_adc",
        "overall_aqi",
        "status",
        "reason",
        "confidence",
        "alert_sensor",
        "percent_increase",
        "arduino_connected",
        "serial_status",
    ]

    def __init__(self, database: DatabaseManager, export_dir: Path = EXPORT_DIR):
        self.database = database
        self.export_dir = Path(export_dir)
        self.export_dir.mkdir(parents=True, exist_ok=True)

    def csv_response(self, args) -> Response:
        meta, rows = export_rows(self.database, args)
        output = self._csv_text(rows)
        filename = self._filename("csv", meta)
        saved_path = ""
        if len(rows) > 5:
            path = self.export_dir / filename
            path.write_text(output, encoding="utf-8", newline="")
            saved_path = str(path)
        response = Response(
            output,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
        if saved_path:
            response.headers["X-EDUSENSE-Saved-Path"] = saved_path
        return response

    def png_response(self, payload: Dict[str, Any]):
        image = str(payload.get("image", ""))
        points = int(payload.get("points") or 0)
        if not image.startswith("data:image/png;base64,"):
            return jsonify({"ok": False, "error": "Invalid PNG payload."}), 400
        if points < 5:
            return jsonify({"ok": True, "saved_path": "", "message": "Need 5+ points to save folder copy."})
        filename = f"edusense_chart_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        path = self.export_dir / filename
        try:
            raw = base64.b64decode(image.split(",", 1)[1], validate=True)
        except ValueError:
            return jsonify({"ok": False, "error": "Invalid PNG payload."}), 400
        if len(raw) < 64 or not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            return jsonify({"ok": False, "error": "Invalid PNG image."}), 400
        path.write_bytes(raw)
        return jsonify({"ok": True, "saved_path": str(path), "points": points})

    def _csv_text(self, rows: Iterable[Dict[str, Any]]) -> str:
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=self.CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(self._csv_row(row))
        return output.getvalue()

    def _csv_row(self, row: Dict[str, Any]) -> Dict[str, Any]:
        values: Dict[str, Any] = {
            "timestamp": row.get("timestamp", ""),
            "temperature": row.get("temperature", ""),
            "humidity": row.get("humidity", ""),
            "measurement_unit": "ESTIMATED_PPM_WITH_RAW_ADC",
            "overall_aqi": row.get("overall_aqi", ""),
            "status": row.get("status", ""),
            "reason": row.get("reason", ""),
            "confidence": row.get("confidence", ""),
            "alert_sensor": row.get("alert_sensor", ""),
            "percent_increase": row.get("percent_increase", ""),
            "arduino_connected": row.get("arduino_connected", ""),
            "serial_status": row.get("serial_status", ""),
        }
        ppm_values = {sensor: mq_to_ppm(sensor, row.get(sensor)) for sensor in GAS_SENSORS}
        values["gas_average_estimated_ppm"] = round(sum(ppm_values.values()) / len(ppm_values), 2)
        for sensor in GAS_SENSORS:
            values[f"{sensor}_estimated_ppm"] = ppm_values[sensor]
            values[f"{sensor}_adc"] = row.get(sensor, "")
        return values

    @staticmethod
    def _filename(extension: str, meta: Dict[str, Any]) -> str:
        label = meta.get("selected_date") or meta.get("range") or "custom"
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"edusense_{label}_{stamp}.{extension}"
