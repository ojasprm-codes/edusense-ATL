# EDUSENSE AI Website Overview

## Purpose

The EDUSENSE AI website is the visual monitoring layer of the project. It converts raw classroom sensor data into a clear dashboard that can be understood quickly without reading serial output or database records.

## Live Dashboard

[Visit EDUSENSE AI](https://edusense-ai-schools.ojas-premt2.chatgpt.site)

## Main Dashboard Areas

### System Status

The status row gives an immediate view of:

- Overall classroom condition
- Raspberry Pi connectivity
- Web dashboard availability
- Arduino connection state
- Time of the latest update

### Environmental Sensor Cards

Dedicated cards present the current values and state of:

- Temperature
- Humidity
- MQ-2 smoke response
- MQ-3 alcohol-vapour response
- MQ-4 methane response
- MQ-5 LPG response
- MQ-7 carbon-monoxide response
- MQ-8 hydrogen response

The interface separates a numeric reading from its interpretation, making it easier to distinguish normal operation, calibration, warning conditions, and missing-device states.

### Calibration Experience

EDUSENSE includes a guided calibration state for MQ gas sensors. The website can display remaining time, progress, estimated completion, elapsed time, Arduino reconnection state, and database availability while the system establishes a stable reference.

### Live Environment Analytics

The analytics area supports reviewing environmental behaviour instead of showing only one instant reading. Its interface includes multiple time windows, date-oriented controls, sensor selection, and summary information for stored readings and previous sessions.

### Recommendations

The recommendation panel translates system state into concise guidance. During calibration it explains why readings are not yet ready; during normal monitoring it is intended to provide clear next actions based on the available environmental data.

### Responsive Design

The interface adapts from a wide desktop dashboard to a narrower mobile layout while retaining access to sensor cards, analytics controls, system state, and recommendations.

## Data Flow

1. Classroom sensors measure environmental conditions.
2. Arduino collects the hardware readings.
3. Raspberry Pi validates, processes, and stores device data.
4. The Pi synchronizes approved information with the cloud-supported layer.
5. The dashboard displays current state, history, and recommendations.

## Scope of This Repository

This repository documents what the website does and how it fits into EDUSENSE. It does not publish the Cloudflare implementation, private endpoints, account configuration, secrets, database contents, or device authentication details.

Device connection instructions will be added after the Raspberry Pi and Arduino source files are verified.
