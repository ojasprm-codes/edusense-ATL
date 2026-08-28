# Project Journey: From Prototype to EDUSENSE V7

## Problem identification

Classroom environmental conditions change during occupancy, cleaning, science
activities, nearby traffic, poor ventilation, and accidental gas/smoke events.
A single instant reading is difficult to interpret, while many low-cost systems
lose history at restart or use one universal threshold for unrelated sensors.

EDUSENSE was built to explore a better ATL approach: continuous sensing,
baseline-aware interpretation, persistent evidence, understandable guidance,
and a local safety path that does not depend on the internet.

## Early prototype: V3

The first working version established the complete physical path:

```text
Sensors -> Arduino -> USB serial -> Raspberry Pi -> Flask dashboard
```

It proved that temperature, humidity, and six MQ channels could be displayed in
one classroom interface. The main limitations were temporary history and basic
threshold behaviour. A value near 600 after a normal level near 250 could be
misinterpreted or missed depending on the fixed rule and sample timing.

## Persistence and calibration: V4

The next stage introduced the mandatory 200-second MQ stabilization period,
SQLite history, startup/reconnect calibration, and status suppression during
warm-up. Readings continued to be stored and graphed while normal classification
and actuator commands remained disabled.

## Sensor-focused analysis: V5

The interface gained individual sensor views with current, minimum, maximum,
average, graph history, and sensor-specific guidance. History windows expanded
from live data to hours, days, and months with aggregation appropriate to each
range.

## Deployment and field workflow: V6

Development shifted from a desk prototype to a repeatable Raspberry Pi service:
automatic startup, serial reconnection, power-session records, local Wi-Fi setup,
service health, export workflows, and clearer operational instructions.

## Cloud-supported architecture: V7

V7 preserved the Pi-first safety architecture and added:

- outbound-only telemetry synchronization;
- secure device enrollment and retryable upload queue;
- authenticated school and family portal;
- invitation and device-assignment access model;
- current and historical remote dashboards;
- a separate public product website;
- estimated ppm alongside retained raw ADC;
- CSV/PNG evidence export and range-aware analytics; and
- optional AI wording with a deterministic local fallback.

## Key engineering decisions

### Why Arduino and Raspberry Pi are both used

The Uno offers predictable analog acquisition and simple actuator timing. The Pi
provides Linux services, SQLite, networking, history queries, richer analysis,
and web interfaces. Keeping these responsibilities separate made the first ATL
prototype easier to debug and preserved deterministic sampling while the Pi
handled higher-level work.

An ESP32 is a valid future cost-reduction path. It could combine sampling and
Wi-Fi, but would require a new electrical design, firmware architecture,
storage strategy, security model, and validation cycle. The current repository
documents the hardware that was actually developed rather than claiming an
unbuilt ESP version.

### Why baseline-relative logic is used

MQ modules vary with heater history, environment, age, and manufacturing
tolerance. A classroom-specific baseline plus persistence and trend evidence is
more useful for detecting sustained change than one identical number applied to
every sensor.

### Why SQLite remains on the Pi

Local persistence protects history during internet outages and allows the
dashboard and safety engine to keep working. Cloud synchronization is an
additional remote-access path, not the system of record for immediate control.

### Why online AI is optional

An online model can improve the wording of a report, but must not decide whether
to activate classroom hardware. The deterministic safety engine and local report
fallback remain available without a key or internet connection.

## Current scope

The result is a functioning ATL prototype and deployable software stack suitable
for supervised pilots and further calibration work. Moving toward a product
would require certified reference testing, enclosure and power engineering,
electrical compliance, threat modelling, privacy governance, maintenance plans,
and school-led safety approval.

