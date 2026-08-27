"""Adaptive environmental safety engine for EDUSENSE AI V7."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import median
import threading
from typing import Any, Deque, Dict, List, Optional

from config import CALIBRATION_SECONDS, GAS_SENSORS, ROLLING_BASELINE_ALPHA, SENSOR_PROFILES


@dataclass(frozen=True)
class SensorAnalysis:
    sensor: str
    label: str
    gas: str
    current: float
    filtered: float
    rolling_average: float
    baseline: float
    percent_increase: float
    rate_per_second: float
    severity: str
    confidence: float
    sustained_count: int
    reason: str


@dataclass(frozen=True)
class SafetyDecision:
    status: str
    reason: str
    sensor: Optional[str] = None
    percent_increase: Optional[float] = None
    confidence: float = 0.0
    overall_aqi: float = 0.0
    analyses: List[SensorAnalysis] = field(default_factory=list)


@dataclass
class _SensorState:
    raw_window: Deque[float] = field(default_factory=lambda: deque(maxlen=5))
    filtered_window: Deque[float] = field(default_factory=lambda: deque(maxlen=12))
    baseline: Optional[float] = None
    abnormal_count: int = 0
    warning_count: int = 0
    danger_count: int = 0
    last_filtered: Optional[float] = None


class SafetyEngine:
    """Calibration, filtering, adaptive baseline, and sensor-fusion engine."""

    def __init__(self, calibration_seconds: int = CALIBRATION_SECONDS):
        self.calibration_seconds = calibration_seconds
        self._lock = threading.RLock()
        self._states = {sensor: _SensorState() for sensor in GAS_SENSORS}
        self._calibration_started_at: Optional[datetime] = None
        self._calibration_completed_at: Optional[datetime] = None
        self._calibration_samples = 0
        self._calibration_sums = {sensor: 0.0 for sensor in GAS_SENSORS}
        self._initial_baseline = {sensor: 0.0 for sensor in GAS_SENSORS}
        self._enabled = False
        self._last_decision = SafetyDecision(
            "CALIBRATING",
            "Stabilizing gas sensors for accurate baseline generation.",
        )

    def start_calibration(self, now: Optional[datetime] = None) -> None:
        with self._lock:
            started = now or _utc_now()
            self._states = {sensor: _SensorState() for sensor in GAS_SENSORS}
            self._calibration_started_at = started
            self._calibration_completed_at = None
            self._calibration_samples = 0
            self._calibration_sums = {sensor: 0.0 for sensor in GAS_SENSORS}
            self._initial_baseline = {sensor: 0.0 for sensor in GAS_SENSORS}
            self._enabled = False
            self._last_decision = SafetyDecision(
                "CALIBRATING",
                "Stabilizing gas sensors for accurate baseline generation.",
                overall_aqi=0.0,
            )

    def is_calibrating(self) -> bool:
        with self._lock:
            return not self._enabled

    def calibration_state(self, now: Optional[datetime] = None) -> Dict[str, Any]:
        with self._lock:
            current = now or _utc_now()
            if not self._calibration_started_at:
                self._calibration_started_at = current
            elapsed = max(0, int((current - self._calibration_started_at).total_seconds()))
            remaining = max(0, self.calibration_seconds - elapsed)
            progress = min(100.0, (elapsed / self.calibration_seconds) * 100)
            completion = self._calibration_started_at + timedelta(seconds=self.calibration_seconds)
            return {
                "active": not self._enabled,
                "started_at": self._calibration_started_at.isoformat(),
                "completed_at": self._calibration_completed_at.isoformat() if self._calibration_completed_at else None,
                "elapsed_seconds": elapsed,
                "remaining_seconds": remaining,
                "duration_seconds": self.calibration_seconds,
                "progress": round(progress, 2),
                "estimated_completion_time": completion.isoformat(),
                "sample_count": self._calibration_samples,
                "reason": "Stabilizing gas sensors for accurate baseline generation.",
                "baseline": dict(self._initial_baseline),
            }

    def process_calibration(self, reading: Dict[str, Any], now: Optional[datetime] = None) -> SafetyDecision:
        with self._lock:
            current_time = now or _utc_now()
            if not self._calibration_started_at:
                self.start_calibration(current_time)

            self._calibration_samples += 1
            for sensor in GAS_SENSORS:
                raw = float(reading.get(sensor, 0))
                state = self._states[sensor]
                filtered = self._filter_value(state, raw)
                self._calibration_sums[sensor] += filtered
                self._initial_baseline[sensor] = self._calibration_sums[sensor] / self._calibration_samples

            elapsed = (current_time - self._calibration_started_at).total_seconds()
            if elapsed >= self.calibration_seconds:
                for sensor in GAS_SENSORS:
                    baseline = max(1.0, self._initial_baseline[sensor])
                    self._states[sensor].baseline = baseline
                    self._initial_baseline[sensor] = baseline
                self._enabled = True
                self._calibration_completed_at = current_time
                return self.evaluate(reading, current_time)

            self._last_decision = SafetyDecision(
                "CALIBRATING",
                "Stabilizing gas sensors for accurate baseline generation.",
                overall_aqi=self._calibration_aqi(reading),
            )
            return self._last_decision

    def evaluate(self, reading: Dict[str, Any], now: Optional[datetime] = None) -> SafetyDecision:
        with self._lock:
            if not self._enabled:
                return self.process_calibration(reading, now)

            analyses = [self._analyze_sensor(sensor, reading) for sensor in GAS_SENSORS]
            active = [item for item in analyses if item.severity != "SAFE"]
            warning_or_higher = [item for item in analyses if item.severity in {"WARNING", "DANGER"}]
            danger_items = [item for item in analyses if item.severity == "DANGER"]
            strongest = max(analyses, key=lambda item: item.confidence)
            correlation_bonus = min(0.25, max(0, len(active) - 1) * 0.08)
            fused_confidence = min(
                1.0,
                strongest.confidence + correlation_bonus + (0.08 if len(warning_or_higher) >= 2 else 0),
            )

            if self._immediate_danger(danger_items, active):
                status = "DANGER"
            elif danger_items and fused_confidence >= 0.78:
                status = "DANGER"
            elif warning_or_higher and fused_confidence >= 0.58:
                status = "WARNING"
            elif active and fused_confidence >= 0.34:
                status = "ELEVATED"
            else:
                status = "SAFE"

            reason = self._reason_for(status, strongest, active, fused_confidence)
            decision = SafetyDecision(
                status=status,
                reason=reason,
                sensor=strongest.sensor if status != "SAFE" else None,
                percent_increase=round(strongest.percent_increase, 1) if status != "SAFE" else None,
                confidence=round(fused_confidence, 3),
                overall_aqi=round(self._overall_aqi(analyses), 2),
                analyses=analyses,
            )
            self._last_decision = decision
            return decision

    def _analyze_sensor(self, sensor: str, reading: Dict[str, Any]) -> SensorAnalysis:
        profile = SENSOR_PROFILES[sensor]
        state = self._states[sensor]
        current = float(reading.get(sensor, 0))
        filtered = self._filter_value(state, current)
        rolling_average = _average(state.filtered_window) or filtered
        previous_average = _average(list(state.filtered_window)[:-4]) or rolling_average
        baseline = max(1.0, state.baseline or rolling_average or 1.0)
        pct = ((rolling_average - baseline) / baseline) * 100
        rate = rolling_average - previous_average

        adaptive_allowed = pct < profile["elevated_pct"] and abs(rate) < max(4.0, baseline * 0.015)
        if adaptive_allowed:
            state.baseline = baseline + ((rolling_average - baseline) * ROLLING_BASELINE_ALPHA)
            baseline = max(1.0, state.baseline)
            pct = ((rolling_average - baseline) / baseline) * 100

        evidence_value = rolling_average
        if current >= baseline * (1 + (profile["elevated_pct"] / 100)):
            evidence_value = max(rolling_average, filtered, current)
        evidence_pct = ((evidence_value - baseline) / baseline) * 100

        instant_severity = self._instant_severity(profile, evidence_value, evidence_pct, rate)
        is_abnormal = instant_severity != "SAFE"
        state.abnormal_count = state.abnormal_count + 1 if is_abnormal else 0
        state.warning_count = state.warning_count + 1 if instant_severity in {"WARNING", "DANGER"} else 0
        state.danger_count = state.danger_count + 1 if instant_severity == "DANGER" else 0

        severity = "SAFE"
        if evidence_value >= profile["danger_abs"] and state.danger_count >= 2:
            severity = "DANGER"
        elif instant_severity == "DANGER" and (state.danger_count >= 2 or state.warning_count >= 3):
            severity = "DANGER"
        elif instant_severity in {"WARNING", "DANGER"} and state.warning_count >= 3:
            severity = "WARNING"
        elif state.abnormal_count >= 3:
            severity = "ELEVATED"

        confidence = self._confidence(profile, severity, evidence_pct, rate, state)
        reason = self._sensor_reason(profile, severity, evidence_pct, rate)
        return SensorAnalysis(
            sensor=sensor,
            label=profile["label"],
            gas=profile["gas"],
            current=current,
            filtered=round(filtered, 2),
            rolling_average=round(rolling_average, 2),
            baseline=round(baseline, 2),
            percent_increase=round(evidence_pct, 2),
            rate_per_second=round(rate, 2),
            severity=severity,
            confidence=round(confidence, 3),
            sustained_count=state.abnormal_count,
            reason=reason,
        )

    def _filter_value(self, state: _SensorState, raw: float) -> float:
        state.raw_window.append(raw)
        local_median = median(state.raw_window)
        if state.last_filtered is None:
            filtered = local_median
        else:
            filtered = (state.last_filtered * 0.62) + (local_median * 0.38)
        state.last_filtered = filtered
        state.filtered_window.append(filtered)
        return filtered

    @staticmethod
    def _instant_severity(profile: Dict[str, Any], value: float, pct: float, rate: float) -> str:
        if value >= profile["danger_abs"] or pct >= profile["danger_pct"]:
            return "DANGER"
        if pct >= profile["rapid_pct"] and rate > 8:
            return "DANGER"
        if value >= profile["warning_abs"] or pct >= profile["warning_pct"]:
            return "WARNING"
        if pct >= profile["elevated_pct"] or rate > 6:
            return "ELEVATED"
        return "SAFE"

    @staticmethod
    def _confidence(profile: Dict[str, Any], severity: str, pct: float, rate: float, state: _SensorState) -> float:
        if severity == "SAFE":
            return max(0.0, min(0.25, pct / max(profile["warning_pct"], 1)))
        threshold = {
            "ELEVATED": profile["elevated_pct"],
            "WARNING": profile["warning_pct"],
            "DANGER": profile["danger_pct"],
        }[severity]
        pct_score = min(1.0, max(0.0, pct / max(threshold, 1)))
        sustain_score = min(1.0, state.abnormal_count / 8)
        rate_score = min(1.0, max(0.0, rate / 20))
        weight = float(profile.get("weight", 1.0))
        return min(1.0, ((pct_score * 0.55) + (sustain_score * 0.3) + (rate_score * 0.15)) * weight)

    @staticmethod
    def _sensor_reason(profile: Dict[str, Any], severity: str, pct: float, rate: float) -> str:
        if severity == "SAFE":
            return f"{profile['label']} stable near baseline"
        if severity == "ELEVATED":
            return f"{profile['label']} shows sustained minor {profile['gas']} increase"
        if severity == "WARNING":
            return f"{profile['label']} indicates significant sustained {profile['gas']} deterioration"
        if rate > 10:
            return f"{profile['label']} rising rapidly with hazardous {profile['gas']} levels"
        return f"{profile['label']} remains above hazardous {profile['gas']} limits"

    @staticmethod
    def _immediate_danger(danger_items: List[SensorAnalysis], active: List[SensorAnalysis]) -> bool:
        if any(item.sustained_count >= 4 and item.confidence >= 0.7 for item in danger_items):
            return True
        return len(danger_items) >= 2 or (len(active) >= 3 and any(item.severity == "DANGER" for item in active))

    @staticmethod
    def _reason_for(status: str, strongest: SensorAnalysis, active: List[SensorAnalysis], confidence: float) -> str:
        if status == "SAFE":
            return "Excellent air quality. Sensor trends are stable near calibrated baseline."
        if status == "ELEVATED":
            return "Minor degradation detected. Recommend ventilation and continued observation."
        if status == "WARNING":
            if len(active) >= 2:
                return f"Significant deterioration across {len(active)} gas sensors. Alert teacher and ventilate."
            return f"{strongest.reason}. Alert teacher and increase ventilation."
        if len(active) >= 2:
            return f"Immediate hazardous environment with correlated gas sensor rise. Confidence {confidence:.0%}."
        return f"{strongest.reason}. Immediate action required."

    @staticmethod
    def _overall_aqi(analyses: List[SensorAnalysis]) -> float:
        if not analyses:
            return 0.0
        scores = []
        for item in analyses:
            profile = SENSOR_PROFILES[item.sensor]
            pct_component = max(0.0, item.percent_increase) / max(profile["danger_pct"], 1)
            abs_component = item.rolling_average / max(profile["danger_abs"], 1)
            scores.append(min(100.0, max(pct_component, abs_component) * 100))
        return min(100.0, (max(scores) * 0.65) + ((_average(scores) or 0) * 0.35))

    @staticmethod
    def _calibration_aqi(reading: Dict[str, Any]) -> float:
        values = [float(reading.get(sensor, 0)) for sensor in GAS_SENSORS]
        return round(min(100.0, (_average(values) or 0) / 10), 2)


def _average(values: Any) -> Optional[float]:
    items = list(values)
    if not items:
        return None
    return sum(items) / len(items)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
