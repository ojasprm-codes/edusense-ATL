from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import tempfile
import unittest

from database import DatabaseManager, READING_COLUMNS
from command_sender import CommandSender
from export_manager import ExportManager
from history import RANGES
from safety_engine import SafetyEngine
from sensor_processor import SensorProcessor


def packet(value: int) -> dict[str, float | int]:
    return {
        "temperature": 25.0,
        "humidity": 50.0,
        "mq2": value,
        "mq3": value,
        "mq4": value,
        "mq5": value,
        "mq7": value,
        "mq8": value,
    }


class UnitContractTests(unittest.TestCase):
    def test_calibration_output_reset_does_not_send_safe_status(self) -> None:
        class SerialStub:
            def __init__(self) -> None:
                self.commands: list[str] = []

            def write_command(self, command: str) -> bool:
                self.commands.append(command)
                return True

        serial = SerialStub()
        sender = CommandSender(serial)
        sender.last_sent_status = "DANGER"

        self.assertTrue(sender.clear_outputs())
        self.assertEqual(serial.commands, ["OUTPUTS:OFF"])
        self.assertIsNone(sender.last_sent_status)

    def test_live_api_returns_estimated_ppm_and_retains_raw_adc(self) -> None:
        shaped = SensorProcessor._api_shape({**packet(253), "timestamp": "2026-01-01T00:00:00+00:00"})
        self.assertGreater(shaped["mq2"], 0)
        self.assertEqual(shaped["mq2_adc"], 253)
        self.assertEqual(shaped["gas_unit"], "estimated_ppm")

    def test_csv_contains_estimated_ppm_and_raw_adc_fields(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            manager = ExportManager(DatabaseManager(Path(folder) / "test.db"), Path(folder) / "exports")
            text = manager._csv_text([{**packet(253), "timestamp": "2026-01-01T00:00:00+00:00"}])
            header = text.splitlines()[0]
            self.assertIn("measurement_unit", header)
            self.assertIn("mq2_adc", header)
            self.assertIn("mq2_estimated_ppm", header)


class HistoryRangeTests(unittest.TestCase):
    def test_two_hour_range_allows_every_second(self) -> None:
        config = RANGES["2h"]
        self.assertEqual(config["delta"], timedelta(hours=2))
        self.assertGreaterEqual(config["limit"], 7200)

    def test_database_returns_full_two_hour_window(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            database = DatabaseManager(Path(folder) / "test.db")
            start = datetime(2026, 1, 1, tzinfo=timezone.utc)
            columns = list(READING_COLUMNS)
            rows = []
            for second in range(7200):
                reading = {
                    **{column: 0 for column in columns},
                    **packet(250 + (second % 5)),
                    "timestamp": (start + timedelta(seconds=second)).isoformat(),
                    "status": "SAFE",
                    "reason": "Stable",
                    "serial_status": "connected",
                    "cloud_uploaded_at": None,
                }
                rows.append([reading.get(column) for column in columns])
            placeholders = ",".join("?" for _ in columns)
            connection = sqlite3.connect(database.path)
            try:
                connection.executemany(
                    f"INSERT INTO readings ({','.join(columns)}) VALUES ({placeholders})",
                    rows,
                )
                connection.commit()
            finally:
                connection.close()
            result = database.history(start, start + timedelta(hours=2), "raw", 7500)
            self.assertEqual(len(result), 7200)
            self.assertEqual(result[0]["timestamp"], start.isoformat())
            self.assertEqual(result[-1]["timestamp"], (start + timedelta(seconds=7199)).isoformat())


class SafetyRegressionTests(unittest.TestCase):
    def test_single_600_spike_is_rejected_but_sustained_rise_escalates(self) -> None:
        engine = SafetyEngine(calibration_seconds=1)
        started = datetime(2026, 1, 1, tzinfo=timezone.utc)
        engine.start_calibration(started)
        engine.process_calibration(packet(250), started)
        engine.process_calibration(packet(250), started + timedelta(seconds=1))

        spike = engine.evaluate(packet(600), started + timedelta(seconds=2))
        self.assertNotIn(spike.status, {"WARNING", "DANGER"})

        decisions = [engine.evaluate(packet(600), started + timedelta(seconds=3 + index)) for index in range(8)]
        self.assertIn(decisions[-1].status, {"WARNING", "DANGER"})
        self.assertGreaterEqual(decisions[-1].confidence, 0.58)


if __name__ == "__main__":
    unittest.main()
