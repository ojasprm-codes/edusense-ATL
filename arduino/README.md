# EDUSENSE Arduino Firmware

The Arduino Uno R3 handles real-time sensor acquisition and physical alerts. The Raspberry Pi performs calibration, database storage, analysis, and every safety decision.

> **Reference-firmware clarification:** This is the new V7-compatible reference firmware created from the current Raspberry Pi protocol. It was not extracted from the Uno and may not be identical to the firmware currently installed. Confirm the RGB LED type, LED pins, and buzzer pin before uploading.

## Hardware

- Arduino Uno R3
- ATmega328P
- DHT22 temperature/humidity sensor
- MQ-2, MQ-3, MQ-4, MQ-5, MQ-7 and MQ-8 modules
- PWM-capable RGB LED
- Buzzer

## Connections

| Component | Arduino pin |
| --- | --- |
| DHT22 data | D2 |
| MQ-2 | A0 |
| MQ-3 | A4 |
| MQ-4 | A5 |
| MQ-5 | A1 |
| MQ-7 | A2 |
| MQ-8 | A3 |
| RGB red | D9 |
| RGB green | D10 |
| RGB blue | D11 |
| Buzzer | D8 |

The firmware defaults to a **common-cathode** RGB LED. If the hardware is common-anode, change `RGB_COMMON_ANODE` to `true` before uploading. Use suitable current-limiting resistors on the RGB LED channels.

## Required Arduino Libraries

Install from Arduino IDE Library Manager:

1. **DHT sensor library** by Adafruit
2. **Adafruit Unified Sensor**

Select **Tools → Board → Arduino AVR Boards → Arduino Uno** and choose the correct serial port.

## Upload and Run

1. Disconnect external power or ensure all modules share a safe common ground.
2. Verify every wire against the table above.
3. Open `edusense_v7_uno.ino` in Arduino IDE.
4. Install the required libraries.
5. Select **Arduino Uno** and the correct USB port.
6. Compile with **Verify**.
7. Upload the sketch.
8. Open Serial Monitor at **9600 baud** with a newline-capable line ending.
9. Confirm that `EDUSENSE_READY` appears once after reset.
10. Confirm that one complete packet appears approximately every second.
11. Close Serial Monitor before starting the Raspberry Pi application, because only one program should own the serial port.

## Communication

- USB serial connection to Raspberry Pi
- Baud rate: `9600`
- One complete reading approximately every second
- Invalid DHT readings cause that entire packet to be skipped rather than sending partial data

Packet format:

```text
TEMP:28.6,HUM:74.1,MQ2:108,MQ3:210,MQ4:315,MQ5:320,MQ7:215,MQ8:468
```

MQ values are raw 10-bit `0–1023` ADC readings. The Raspberry Pi retains the raw ADC values and creates estimated PPM values with sensor-specific models.

## Commands Received from Raspberry Pi

Each command must end with a newline or carriage return:

```text
STATUS:SAFE
STATUS:ELEVATED
STATUS:WARNING
STATUS:DANGER
OUTPUTS:OFF
```

Unknown commands are ignored. The receive buffer is bounded; overlong commands are discarded.

| Command/status | RGB LED | Buzzer |
| --- | --- | --- |
| `STATUS:SAFE` | Green | Off |
| `STATUS:ELEVATED` | Cyan/blue | Off |
| `STATUS:WARNING` | Amber | Intermittent, 500 ms toggle |
| `STATUS:DANGER` | Red | Continuous |
| `OUTPUTS:OFF` | Off | Off |

## Calibration and Warm-up

For the first **200 seconds after Arduino startup**:

- Sensors continue sending readings every second.
- The Pi stores readings and builds baselines.
- LED and buzzer remain off.
- No Arduino-side status decision is made.
- Status commands may be received and remembered, but outputs are not applied until warm-up finishes.
- `OUTPUTS:OFF` always keeps outputs disabled.

The Pi also performs its own calibration logic. The Arduino timer is a hardware-output lockout that prevents alerts during initial warm-up.

## Design Principle

The Arduino never calculates `SAFE`, `ELEVATED`, `WARNING`, or `DANGER`. It only:

1. Reads sensors.
2. Sends complete packets.
3. Obeys trusted status commands from the Raspberry Pi.

This keeps one authoritative decision engine on the Pi, avoids conflicting safety logic, and prevents the browser frontend from controlling safety outputs directly.

## Quick Verification Checklist

After the 200-second warm-up, send these lines from Serial Monitor one at a time:

- `STATUS:SAFE` → green, silent
- `STATUS:ELEVATED` → cyan/blue, silent
- `STATUS:WARNING` → amber, intermittent tone
- `STATUS:DANGER` → red, continuous tone
- `OUTPUTS:OFF` → LED and buzzer off

If colours are inverted, confirm whether the LED is common-anode and update `RGB_COMMON_ANODE`. If red/green/blue are swapped, correct the pin constants or wiring before connecting the Pi.

## Safety Limitation

MQ sensor outputs and calculated PPM values are estimates unless calibrated with certified reference gases and the correct sensor-resistance model. EDUSENSE is an educational/environmental monitoring project and must not replace certified fire alarms, carbon-monoxide alarms, gas detectors, or emergency safety equipment.
