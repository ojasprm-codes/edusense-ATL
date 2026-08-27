"""Optional cloud-model narratives for EDUSENSE reports.

Safety classification remains entirely inside SafetyEngine. This module only
turns already-computed evidence into plain-language classroom guidance.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict
from urllib.request import Request, urlopen


class AIReporter:
    def __init__(self) -> None:
        self.provider = os.getenv("EDUSENSE_AI_PROVIDER", "auto").lower()
        self.gemini_key = os.getenv("GEMINI_API_KEY", "")
        self.openai_key = os.getenv("OPENAI_API_KEY", "")
        self._lock = threading.Lock()
        self._cache: Dict[str, tuple[float, str, str]] = {}

    def generate(self, evidence: Dict[str, Any]) -> Dict[str, Any]:
        cache_key = json.dumps(evidence, sort_keys=True, default=str)
        with self._lock:
            cached = self._cache.get(cache_key)
            if cached and time.monotonic() - cached[0] < 300:
                return {"report": cached[1], "source": cached[2], "cached": True}

        fallback = self._fallback(evidence)
        try:
            if self.provider in {"auto", "gemini"} and self.gemini_key:
                report = self._gemini(evidence)
                source = "Gemini"
            elif self.provider in {"auto", "openai"} and self.openai_key:
                report = self._openai(evidence)
                source = "OpenAI"
            else:
                report, source = fallback, "EDUSENSE local engine"
        except Exception:
            report, source = fallback, "EDUSENSE local engine"

        with self._lock:
            self._cache[cache_key] = (time.monotonic(), report, source)
        return {"report": report, "source": source, "cached": False}

    @staticmethod
    def _prompt(evidence: Dict[str, Any]) -> str:
        return (
            "You are the reporting assistant for a classroom environmental monitor. "
            "The deterministic EDUSENSE safety engine is authoritative. Never override its status, "
            "invent ppm concentrations, diagnose illness, or claim regulatory compliance. MQ values "
            "are raw ADC response counts. Write 3 concise sentences: evidence, recommended classroom "
            "action, and what to monitor next. Evidence JSON:\n" +
            json.dumps(evidence, separators=(",", ":"), default=str)
        )

    def _gemini(self, evidence: Dict[str, Any]) -> str:
        model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        body = {"contents": [{"parts": [{"text": self._prompt(evidence)}]}], "generationConfig": {"temperature": 0.2, "maxOutputTokens": 220}}
        data = self._post(url, body, {"x-goog-api-key": self.gemini_key})
        return str(data["candidates"][0]["content"]["parts"][0]["text"]).strip()

    def _openai(self, evidence: Dict[str, Any]) -> str:
        model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
        body = {"model": model, "input": self._prompt(evidence), "temperature": 0.2, "max_output_tokens": 220}
        data = self._post("https://api.openai.com/v1/responses", body, {"Authorization": f"Bearer {self.openai_key}"})
        if data.get("output_text"):
            return str(data["output_text"]).strip()
        return str(data["output"][0]["content"][0]["text"]).strip()

    @staticmethod
    def _post(url: str, payload: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
        request = Request(url, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json", **headers}, method="POST")
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8"))

    @staticmethod
    def _fallback(evidence: Dict[str, Any]) -> str:
        status = str(evidence.get("status") or "CALIBRATING").upper()
        coverage = float(evidence.get("analytics", {}).get("data_coverage_pct") or 0)
        reason = str(evidence.get("reason") or "No sustained anomaly has been identified.")
        actions = {
            "CALIBRATING": "Keep the room conditions stable while the 200-second baseline completes.",
            "SAFE": "Continue normal classroom operation and routine ventilation.",
            "ELEVATED": "Improve ventilation and watch whether the rise settles or continues.",
            "WARNING": "Alert the responsible teacher, increase ventilation, and inspect likely sources.",
            "DANGER": "Move occupants away from the suspected source and follow the school's emergency procedure immediately.",
        }
        return f"{status}: {reason} {actions.get(status, actions['WARNING'])} Selected-range data coverage is {coverage:.0f}%; continue monitoring raw ADC trends and correlated sensor changes."
