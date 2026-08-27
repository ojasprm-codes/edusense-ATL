# EDUSENSE ATL — Cloud-Supported Classroom Monitoring

[![Live Dashboard](https://img.shields.io/badge/Live%20Dashboard-Open-16d9e8?style=for-the-badge)](https://edusense-ai-schools.ojas-premt2.chatgpt.site)
![Python](https://img.shields.io/badge/Python-Raspberry%20Pi-3776AB?logo=python&logoColor=white)
![Tests](https://img.shields.io/badge/Regression%20Tests-5%20Passing-18d976)

**EDUSENSE ATL** is a smart-classroom environmental monitoring system that combines an Arduino sensor layer, Raspberry Pi intelligence, local storage, safety classification, and an outbound-only cloud connection.

## Live Website

### [Open the EDUSENSE AI dashboard](https://edusense-ai-schools.ojas-premt2.chatgpt.site)

The public website presents classroom conditions, device connectivity, safety state, historical trends, calibration progress, and recommendations. Cloudflare implementation details and private account configuration are not included in this repository.

## Architecture

```mermaid
flowchart LR
    Sensors[Environmental sensors] --> Arduino[Arduino]
    Arduino -->|Serial packets| Pi[Raspberry Pi]
    Pi --> Engine[Calibration and safety engine]
    Engine --> DB[(Local SQLite)]
    Engine --> Local[Local dashboard]
    DB --> Sync[Outbound cloud sync]
    Sync --> Web[Public dashboard]
```

## Raspberry Pi Features

- Validates and normalizes incoming Arduino packets
- Manages MQ sensor calibration and rolling baselines
- Converts retained raw ADC readings into estimated PPM values
- Classifies conditions as CALIBRATING, SAFE, ELEVATED, WARNING, or DANGER
- Rejects isolated spikes while detecting sustained rises
- Stores readings and system state locally in SQLite
- Serves a responsive local Flask dashboard
- Provides live, historical, calendar, custom-range, and export APIs
- Sends batched telemetry to the cloud using outbound HTTPS only
- Supports secure device enrollment and a local Wi-Fi setup portal
- Tracks Pi CPU temperature, CPU, RAM, disk, serial, Arduino, and cloud status
- Generates recommendations with deterministic fallback and optional AI providers

## Arduino Features

- Reads DHT22 and six MQ sensor channels
- Sends a complete serial packet every second at 9600 baud
- Rejects partial packets when DHT data is invalid
- Keeps LED and buzzer disabled for the first 200 seconds
- Receives Pi-authoritative SAFE, ELEVATED, WARNING and DANGER commands
- Drives green, cyan/blue, amber and red status colours
- Provides intermittent WARNING and continuous DANGER buzzer patterns

## Repository Layout

```text
raspberry-pi/
├── src/          Core Python application
├── web/          Local dashboard interface
├── tests/        Regression tests
└── requirements.txt
arduino/          Uno reference firmware and execution guide
cloud/            Public cloud overview only
docs/             Architecture and logic documentation
libraries/        Dependency overview
```

## Documentation

- [Arduino firmware, wiring and upload guide](arduino/README.md)
- [Raspberry Pi setup and modules](raspberry-pi/README.md)
- [Complete Pi logic and data flow](docs/pi-logic.md)
- [Website overview](docs/website-overview.md)
- [Cloud overview](cloud/README.md)
- [Library overview](libraries/README.md)

## Verification

- All uploaded Python modules compile
- 5 supplied Raspberry Pi regression tests pass
- Arduino source matches the documented pin map, packet protocol, warm-up lockout and command table
- Public-tree and secret-pattern scans completed successfully

## Security and Safety

Databases, records, credentials, Wi-Fi passwords, enrollment tokens, Cloudflare source, private bindings, old screenshots, exports and caches are excluded.

MQ/PPM results are estimates unless calibrated with certified reference gases. EDUSENSE must not replace certified fire, carbon-monoxide, gas, or emergency safety equipment.

## Current Status

The Raspberry Pi application, local dashboard, Arduino Uno reference firmware, cloud overview, and full technical documentation are published.
