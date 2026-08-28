# Raspberry Pi Application

## Requirements

- Raspberry Pi running Raspberry Pi OS
- Python 3.10 or newer
- Arduino connected over USB serial
- NetworkManager and `nmcli` for the guided Wi-Fi setup flow

## Production install (recommended)

From the cloned repository root on Raspberry Pi OS:

```bash
sudo bash raspberry-pi/deploy/install_edusense_v7.sh
```

This creates the virtual environment, persistent state directory, Nginx reverse
proxy, setup hotspot and boot-managed systemd services. See the
[complete deployment guide](../docs/DEPLOYMENT.md).

## Manual development run

```bash
cd edusense-ATL/raspberry-pi
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python src/app.py
```

The local dashboard defaults to port `5000`. Serial defaults to `/dev/ttyACM0` at `9600` baud. These values can be overridden with environment variables.

## Important Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `EDUSENSE_DB` | SQLite database path | local `edusense.db` |
| `EDUSENSE_TIMEZONE` | Local display timezone | `Asia/Kolkata` |
| `EDUSENSE_SERIAL_PORT` | Arduino serial device | `/dev/ttyACM0` |
| `EDUSENSE_BAUD_RATE` | Serial baud rate | `9600` |
| `EDUSENSE_HOST` | Flask bind host | `0.0.0.0` |
| `EDUSENSE_PORT` | Flask port | `5000` |
| `EDUSENSE_CLOUD_URL` | Cloud endpoint override | project cloud worker |
| `EDUSENSE_DEVICE_CREDENTIALS` | Protected device credential path | `/var/lib/edusense/device.json` |
| `GEMINI_API_KEY` | Optional AI reporter provider | unset |
| `OPENAI_API_KEY` | Optional AI reporter provider | unset |

Never commit the values of keys, Wi-Fi passwords, enrollment codes, or the generated device credential file.

## Module Map

| Module | Responsibility |
| --- | --- |
| `app.py` | Flask application, API routes, orchestration and lifecycle |
| `serial_reader.py` | Arduino serial discovery, packet reading and connection state |
| `sensor_processor.py` | Packet validation, processing, storage and API shaping |
| `mq_calibration.py` | Calibration timing and clean-air baseline collection |
| `safety_engine.py` | Baseline-relative safety decisions, confidence and spike handling |
| `ppm.py` | Estimated PPM conversion while retaining raw ADC |
| `database.py` | SQLite schema, persistence, cloud queue and history queries |
| `history.py` | Time windows, aggregation and history request handling |
| `export_manager.py` | CSV/PDF-oriented export preparation |
| `cloud_client.py` | Enrollment and outbound-only batched HTTPS synchronization |
| `wifi_setup.py` | Setup hotspot, network scan and secure local provisioning |
| `command_sender.py` | Safe commands from Pi to Arduino |
| `ai_reporter.py` | Recommendations with optional external AI and local fallback |
| `config.py` | Environment-driven configuration and sensor profiles |

## Test

```bash
cd raspberry-pi
PYTHONPATH=src python -m unittest -v tests/test_v72_regressions.py
```
