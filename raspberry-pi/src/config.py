"""Central configuration for EDUSENSE AI V7."""

from pathlib import Path
import os


BASE_DIR = Path(__file__).resolve().parent

DATABASE_PATH = Path(os.getenv("EDUSENSE_DB", BASE_DIR / "edusense.db"))
LOCAL_TIMEZONE = os.getenv("EDUSENSE_TIMEZONE", "Asia/Kolkata")

SERIAL_PORT = os.getenv("EDUSENSE_SERIAL_PORT", "/dev/ttyACM0")
BAUD_RATE = int(os.getenv("EDUSENSE_BAUD_RATE", "9600"))
SERIAL_TIMEOUT = float(os.getenv("EDUSENSE_SERIAL_TIMEOUT", "1.0"))

HOST = os.getenv("EDUSENSE_HOST", "0.0.0.0")
PORT = int(os.getenv("EDUSENSE_PORT", "5000"))

SENSORS = ("temperature", "humidity", "mq2", "mq3", "mq4", "mq5", "mq7", "mq8")
GAS_SENSORS = ("mq2", "mq3", "mq4", "mq5", "mq7", "mq8")

BASELINE_WINDOW_MINUTES = int(os.getenv("EDUSENSE_BASELINE_WINDOW_MINUTES", "30"))
MIN_BASELINE_SAMPLES = int(os.getenv("EDUSENSE_MIN_BASELINE_SAMPLES", "20"))
CALIBRATION_SECONDS = int(os.getenv("EDUSENSE_CALIBRATION_SECONDS", "200"))
ROLLING_BASELINE_ALPHA = float(os.getenv("EDUSENSE_ROLLING_BASELINE_ALPHA", "0.015"))

READING_STALE_AFTER_SECONDS = float(os.getenv("EDUSENSE_STALE_AFTER_SECONDS", "5"))
MAX_HISTORY_POINTS = int(os.getenv("EDUSENSE_MAX_HISTORY_POINTS", "1200"))
MAX_EXPORT_ROWS = int(os.getenv("EDUSENSE_MAX_EXPORT_ROWS", "250000"))
BOOT_SCREEN_SECONDS = int(os.getenv("EDUSENSE_BOOT_SCREEN_SECONDS", "12"))

STATUS_LEVELS = ("CALIBRATING", "SAFE", "ELEVATED", "WARNING", "DANGER")

SENSOR_PROFILES = {
    "mq2": {
        "label": "MQ-2 Smoke",
        "gas": "smoke and combustible gases",
        "elevated_pct": 18,
        "warning_pct": 38,
        "danger_pct": 70,
        "rapid_pct": 55,
        "warning_abs": 520,
        "danger_abs": 720,
        "weight": 1.25,
    },
    "mq3": {
        "label": "MQ-3 Alcohol",
        "gas": "alcohol vapors",
        "elevated_pct": 22,
        "warning_pct": 48,
        "danger_pct": 85,
        "rapid_pct": 65,
        "warning_abs": 500,
        "danger_abs": 760,
        "weight": 0.85,
    },
    "mq4": {
        "label": "MQ-4 Methane",
        "gas": "methane",
        "elevated_pct": 16,
        "warning_pct": 34,
        "danger_pct": 62,
        "rapid_pct": 48,
        "warning_abs": 480,
        "danger_abs": 690,
        "weight": 1.15,
    },
    "mq5": {
        "label": "MQ-5 LPG",
        "gas": "LPG and natural gas",
        "elevated_pct": 16,
        "warning_pct": 32,
        "danger_pct": 58,
        "rapid_pct": 45,
        "warning_abs": 500,
        "danger_abs": 700,
        "weight": 1.2,
    },
    "mq7": {
        "label": "MQ-7 Carbon Monoxide",
        "gas": "carbon monoxide",
        "elevated_pct": 12,
        "warning_pct": 24,
        "danger_pct": 42,
        "rapid_pct": 35,
        "warning_abs": 430,
        "danger_abs": 620,
        "weight": 1.45,
    },
    "mq8": {
        "label": "MQ-8 Hydrogen",
        "gas": "hydrogen",
        "elevated_pct": 18,
        "warning_pct": 36,
        "danger_pct": 64,
        "rapid_pct": 50,
        "warning_abs": 480,
        "danger_abs": 700,
        "weight": 1.05,
    },
}
