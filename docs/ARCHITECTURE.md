# Architecture and Data Flow

## Design objective

EDUSENSE separates time-sensitive classroom operation from internet-dependent
services. Sensor collection, calibration, safety classification, local history,
LED control, and buzzer control continue on the Raspberry Pi when cloud access
is unavailable.

## Layer 1: sensing and actuation

The Arduino Uno reads DHT22 temperature/humidity and six MQ analog channels.
Once per second it emits an ordered, newline-terminated packet at 9600 baud:

```text
TEMP:28.6,HUM:74.1,MQ2:108,MQ3:210,MQ4:315,MQ5:320,MQ7:215,MQ8:468
```

It does not contain environmental thresholds. It accepts only the documented
Pi commands and maps them to RGB and buzzer behaviour. A 200-second firmware
lockout keeps outputs off during MQ warm-up.

## Layer 2: Raspberry Pi edge service

The Pi runs a Flask application as a managed systemd service behind local Nginx.
Its modules have narrow responsibilities:

| Module | Responsibility |
|---|---|
| `serial_reader.py` | Reconnect, read, parse, and validate complete packets |
| `sensor_processor.py` | Normalize, persist, shape API output, and coordinate decisions |
| `safety_engine.py` | Calibration, filtering, adaptive analysis, confidence, status |
| `command_sender.py` | Send Pi-authoritative actuator commands |
| `database.py` | SQLite schema, indexed history, alerts, sessions, cloud queue |
| `history.py` | Time-window selection and aggregation |
| `ppm.py` | Sensor-specific estimated-ppm display conversion |
| `cloud_client.py` | Enrollment and retryable outbound telemetry batches |
| `wifi_setup.py` | Local NetworkManager-based school Wi-Fi provisioning |
| `ai_reporter.py` | Evidence-led reports with deterministic offline fallback |

### Startup and reconnect

1. Service opens `/dev/ttyACM0` at 9600 baud.
2. Arduino reconnect triggers `OUTPUTS:OFF` and restarts Pi calibration.
3. Pi receives and stores every valid packet during calibration.
4. No SAFE/ELEVATED/WARNING/DANGER command is sent during calibration.
5. The first completed decision is sent after calibration ends.

### Calibration

Each MQ baseline is the average of valid calibration samples collected during
the mandatory 200-second period. The initial baseline is locked for comparison,
while a deliberately slow rolling baseline can follow stable long-term drift.
Calibration restarts after Pi startup or Arduino reconnection.

### Decision inputs

The engine does not classify from a single threshold or a single sample. It uses:

- median/noise filtering and recent rolling values;
- sensor-specific percentage-rise thresholds;
- sensor-specific absolute ADC guardrails;
- rate of rise and trend direction;
- consecutive-reading persistence;
- multi-sensor correlation;
- confidence and false-spike rejection; and
- controlled escalation and recovery between status levels.

Raw ADC is retained as the authoritative electrical measurement. Estimated ppm
is a display/reporting layer and is always labelled as estimated.

## Layer 3: local persistence and dashboard

SQLite stores sensor readings, status, reasoning, Pi metrics, serial state,
Arduino state, alerts, power sessions, and cloud upload state. WAL mode and
indexes support continuous insertion and time-range queries.

The dashboard requests data from Flask APIs. It never computes status. History
windows use raw values for short ranges and database aggregation for longer
ranges to avoid excessive browser points.

## Layer 4: cloud synchronization

The Pi enrolls once using a short-lived setup code. The returned per-device
credential is stored outside the source tree. Pending readings are uploaded in
bounded outbound HTTPS batches. Failed uploads remain in SQLite and retry with
backoff.

The cloud Worker verifies device credentials, stores accepted telemetry in D1,
and serves authenticated school portal views. Google OAuth, invitations,
memberships, and device assignments control user access. Parent access can be
restricted to an assigned device; authorized staff roles can access school
devices according to portal membership logic.

## Layer 5: public website

The public website explains EDUSENSE and hosts a sanitized interactive demo. It
does not contain private telemetry, Pi addresses, device secrets, enrollment
tokens, or hardware-control endpoints. Its contact endpoint records enquiries
and optionally forwards them through a separately configured server-side webhook.

## Failure behaviour

| Failure | Expected behaviour |
|---|---|
| Internet unavailable | Local sensing, decisions, SQLite, dashboard, LED and buzzer continue |
| Cloud upload fails | Rows remain pending and retry later |
| Arduino disconnects | Pi reports disconnected and resets command state |
| Arduino reconnects | Outputs off and mandatory calibration restarts |
| Pi loses power | Committed SQLite history remains; a new calibration starts on reboot |
| One MQ spike | Persistence logic rejects immediate WARNING/DANGER |
| DHT packet invalid | Arduino skips the incomplete packet |

