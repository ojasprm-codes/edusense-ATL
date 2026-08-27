# Raspberry Pi Logic and Data Flow

## 1. Startup

The Flask application initializes configuration, the SQLite manager, calibration and safety components, serial communication, history/export services, cloud synchronization, Wi-Fi provisioning, and dashboard routes. Runtime values come from environment variables so secrets do not need to be stored in source.

## 2. Arduino Input

`serial_reader.py` manages the USB serial connection. Incoming packets are passed to `sensor_processor.py`, which validates required fields and rejects malformed or stale data before it can influence the safety state.

Expected measurements include temperature, humidity, and MQ-2, MQ-3, MQ-4, MQ-5, MQ-7, and MQ-8 ADC values.

## 3. Calibration

On startup, `mq_calibration.py` gathers a stable clean-air reference for the MQ sensors. During this period the system reports `CALIBRATING` instead of making normal safety decisions. Progress, remaining time, and readiness are exposed to the dashboard.

Once sufficient samples are available, baselines are handed to the safety engine. A slow rolling-baseline update follows stable environmental drift without immediately accepting hazardous changes as normal.

## 4. Safety Engine

`safety_engine.py` compares each gas sensor against:

- its learned baseline;
- configured percentage-rise thresholds;
- absolute ADC guardrails;
- rapid-rise thresholds;
- sensor-specific severity weights; and
- recent readings used for persistence checks.

The system uses five states:

1. `CALIBRATING`
2. `SAFE`
3. `ELEVATED`
4. `WARNING`
5. `DANGER`

Isolated large spikes are filtered to reduce false alarms. Sustained elevated readings increase confidence and escalate the state. The highest meaningful sensor contribution influences the overall result and reason.

## 5. ADC and Estimated PPM

Raw ADC values are retained because they are the direct measurement used by the baseline-relative safety logic. `ppm.py` additionally estimates PPM values for display and export. These are labelled as estimates and are not treated as laboratory-grade measurements.

## 6. Local Persistence

`database.py` stores timestamped sensor values, status, reasoning, system metrics, serial/Arduino state, and cloud-upload status. The database remains local and is excluded from GitHub.

Readings that have not yet reached the cloud remain in an upload queue. Successful batches are marked with an upload timestamp, allowing safe retry after network interruptions.

## 7. History and Exports

`history.py` defines supported time windows and database query limits. The dashboard can request live data, recent hours, days, calendar selections, and custom ranges.

`export_manager.py` shapes readings for export and includes both estimated PPM and retained raw ADC fields. Exported files are runtime artifacts and are ignored by Git.

## 8. Local Dashboard

The Flask server delivers the files under `raspberry-pi/web/`. Browser JavaScript requests live readings, history, calibration state, system status, and exports. CSS provides the responsive desktop/mobile presentation.

## 9. Cloud Synchronization

`cloud_client.py` uses outbound HTTPS; it does not open an inbound internet port on the classroom network.

1. A one-time enrollment code is exchanged for a device ID and device secret.
2. Credentials are written to a protected runtime file with restricted permissions.
3. Pending SQLite readings are batched.
4. A bearer token is created only at request time.
5. Successful rows are marked uploaded.
6. Failures use exponential backoff and never stop local safety processing.

The device credential file is intentionally absent from this repository.

## 10. Wi-Fi Provisioning

`wifi_setup.py` can expose a temporary local setup experience. It scans nearby networks with NetworkManager, accepts a Wi-Fi password and one-time enrollment code locally, connects the Pi, performs enrollment, and minimizes the lifetime of the plaintext password in the process.

## 11. Recommendations

`ai_reporter.py` builds recommendation evidence from the current decision and readings. Optional Gemini or OpenAI providers are used only when their environment keys exist. A deterministic local fallback keeps recommendations available without cloud AI.

## 12. Regression Coverage

The supplied regression suite verifies:

- estimated PPM plus raw ADC API fields;
- CSV measurement and ADC/PPM fields;
- the full two-hour range definition;
- retrieval of 7,200 one-second database readings; and
- rejection of one spike followed by escalation for a sustained rise.
