"""MQ sensor calibration and ppm estimation for EDUSENSE AI V7.

Arduino sends raw ADC counts. This module keeps those raw values in SQLite and
converts them for display with an MQ-style Rs/R0 curve when a clean-air baseline
is available from the 200-second calibration.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from config import BASE_DIR, GAS_SENSORS


CALIBRATION_PATH = BASE_DIR / "mq_calibration.json"


MQ_CURVES: Dict[str, Dict[str, float]] = {
    # Curve constants are practical datasheet-style approximations. They should
    # be tuned with known calibration gas before treating values as certified ppm.
    "mq2": {"a": 574.25, "b": -2.222, "clean_air_factor": 9.8, "min": 0.0, "max": 10000.0},
    "mq3": {"a": 0.4091, "b": -1.497, "clean_air_factor": 60.0, "min": 0.0, "max": 10000.0},
    "mq4": {"a": 1012.7, "b": -2.786, "clean_air_factor": 4.4, "min": 0.0, "max": 10000.0},
    "mq5": {"a": 3812.95, "b": -2.513, "clean_air_factor": 6.5, "min": 0.0, "max": 10000.0},
    "mq7": {"a": 99.042, "b": -1.518, "clean_air_factor": 27.5, "min": 0.0, "max": 10000.0},
    "mq8": {"a": 976.97, "b": -0.688, "clean_air_factor": 70.0, "min": 0.0, "max": 10000.0},
}


class MQCalibrationEngine:
    """Converts raw ADC readings to estimated ppm using persisted clean-air R0."""

    def __init__(self, path: Path = CALIBRATION_PATH, adc_max: float = 1023.0, vc: float = 5.0, rl_kohm: float = 10.0):
        self.path = Path(path)
        self.adc_max = adc_max
        self.vc = vc
        self.rl_kohm = rl_kohm
        self.r0 = {sensor: 0.0 for sensor in GAS_SENSORS}
        self.load()

    def load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        stored = data.get("r0_kohm", {})
        for sensor in GAS_SENSORS:
            try:
                self.r0[sensor] = max(0.0, float(stored.get(sensor, 0.0)))
            except (TypeError, ValueError):
                self.r0[sensor] = 0.0

    def save(self) -> None:
        payload = {"r0_kohm": self.r0}
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def calibrate_from_clean_air(self, baseline_adc: Dict[str, Any]) -> None:
        changed = False
        for sensor in GAS_SENSORS:
            rs = self.rs_from_adc(baseline_adc.get(sensor, 0))
            factor = MQ_CURVES[sensor]["clean_air_factor"]
            if rs > 0 and factor > 0:
                next_r0 = rs / factor
                if abs(next_r0 - self.r0.get(sensor, 0.0)) > 0.001:
                    self.r0[sensor] = round(next_r0, 6)
                    changed = True
        if changed:
            self.save()

    def ppm(self, sensor: str, raw_adc: Any) -> float:
        sensor = sensor.lower()
        curve = MQ_CURVES.get(sensor)
        if not curve:
            return 0.0
        rs = self.rs_from_adc(raw_adc)
        r0 = self.r0.get(sensor, 0.0)
        if rs <= 0 or r0 <= 0:
            return self.estimated_index(sensor, raw_adc)
        ratio = max(0.001, rs / r0)
        ppm = curve["a"] * (ratio ** curve["b"])
        return round(min(max(ppm, curve["min"]), curve["max"]), 2)

    def estimated_index(self, sensor: str, raw_adc: Any) -> float:
        try:
            raw = max(0.0, float(raw_adc or 0))
        except (TypeError, ValueError):
            raw = 0.0
        # Conservative fallback before calibration: readable, but not inflated.
        return round(raw * 1.2, 2)

    def rs_from_adc(self, raw_adc: Any) -> float:
        try:
            raw = min(max(float(raw_adc or 0), 1.0), self.adc_max - 1.0)
        except (TypeError, ValueError):
            raw = 1.0
        vout = (raw / self.adc_max) * self.vc
        if vout <= 0:
            return 0.0
        return self.rl_kohm * ((self.vc - vout) / vout)

    def average_ppm(self, values: Dict[str, Any]) -> float:
        return round(sum(self.ppm(sensor, values.get(sensor, 0)) for sensor in GAS_SENSORS) / len(GAS_SENSORS), 2)


mq_calibration_engine = MQCalibrationEngine()
