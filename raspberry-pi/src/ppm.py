"""Display conversion helpers for MQ sensor ADC values."""

from __future__ import annotations

from typing import Any

from mq_calibration import mq_calibration_engine


def mq_to_ppm(sensor: str, value: Any) -> float:
    return mq_calibration_engine.ppm(sensor, value)


def avg_mq_ppm(values: dict[str, Any]) -> float:
    return mq_calibration_engine.average_ppm(values)


def calibrate_mq_from_clean_air(baseline_adc: dict[str, Any]) -> None:
    mq_calibration_engine.calibrate_from_clean_air(baseline_adc)
