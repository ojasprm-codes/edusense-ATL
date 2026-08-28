# Complete Builder and Deployment Guide

This guide starts from a clean Raspberry Pi OS installation and ends with a
boot-managed local classroom monitor. Cloud and public-website deployment are
separate, optional stages. The Raspberry Pi continues collecting, deciding,
storing and controlling outputs when internet access is unavailable.

## 1. Required hardware

- Raspberry Pi 3B+ or newer, official-quality power supply and microSD card
- Arduino Uno R3 and USB data cable
- DHT22
- MQ2, MQ3, MQ4, MQ5, MQ7 and MQ8 modules
- RGB LED, appropriate current-limiting resistors and buzzer/driver as required
- enclosure with ventilation that does not expose mains voltage or loose wiring

Follow the verified sensor pin map in the root README. Confirm RGB type and
output pins against the physical unit before flashing the reference firmware.

## 2. Prepare Raspberry Pi OS

1. Use Raspberry Pi Imager to install current 64-bit Raspberry Pi OS.
2. In Imager settings, create a non-default user, set the hostname, configure
   Wi-Fi and enable SSH only if remote administration is required.
3. Boot the Pi, open a terminal and update it:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

After reconnecting, confirm the Arduino device name:

```bash
ls -l /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
```

## 3. Obtain the project

```bash
sudo apt install -y git
cd ~
git clone https://github.com/ojasprm-codes/edusense-ATL.git
cd edusense-ATL
```

Do not copy `.db`, `.env`, `device.json`, OAuth files or Wi-Fi profiles from
another installation. Each device should begin with its own state and secrets.

## 4. Flash the Arduino reference firmware

Use `arduino/edusense_v7_uno.ino` and follow `arduino/README.md`. The sketch is a
V7-compatible reference implementation; it was not extracted from the existing
Uno. Verify the physical RGB and buzzer wiring before uploading. Close Arduino
Serial Monitor when finished so the Pi can own the serial port.

## 5. Install the Pi service

From the repository root:

```bash
sudo bash raspberry-pi/deploy/install_edusense_v7.sh
```

The installer:

- creates `raspberry-pi/.venv` and installs pinned Python requirements;
- adds the service user to `dialout` and `netdev`;
- stores persistent state in `/var/lib/edusense`;
- creates an `edusense-v7` systemd service;
- configures Nginx and `http://edusense.local`;
- configures a protected first-setup Wi-Fi hotspot;
- disables old `edusense-v3` and `edusense-v6` services to prevent port clashes;
- enables automatic restart and boot startup.

The installer prints the unique temporary setup SSID and password. Record them
privately for installation staff; do not add them to GitHub or photographs.

## 6. Verify the local monitor

```bash
sudo systemctl status edusense-v7 --no-pager
sudo journalctl -u edusense-v7 -n 100 --no-pager
curl http://127.0.0.1:5000/api/health
sudo bash raspberry-pi/deploy/status_edusense.sh
```

Open `http://edusense.local` from a computer on the same network. If mDNS is not
available, find the Pi address with `hostname -I` and open `http://PI_ADDRESS`.

On every Pi boot or Arduino reconnection, allow the mandatory 200-second
calibration to complete. During calibration, readings and history continue, but
no SAFE/ELEVATED/WARNING/DANGER command is sent. The first post-calibration
decision is produced from the collected baseline.

## 7. School Wi-Fi and cloud enrollment

If no saved school connection works, join the printed `EDUSENSE-XXXX` hotspot
and open `http://10.42.0.1/setup`. Select the school Wi-Fi, enter its password,
and optionally enter a 15-minute enrollment code created in the school portal.
The password remains in NetworkManager on the Pi; it is not uploaded to cloud.

The Pi only makes outbound HTTPS requests. Never port-forward Flask, Nginx,
SSH or the setup hotspot to the public internet.

## 8. Optional AI report wording

Local status decisions never depend on Gemini, OpenAI or internet access. For
optional narrative range reports, edit the owner-only environment file:

```bash
sudo nano /var/lib/edusense/ai.env
sudo chmod 600 /var/lib/edusense/ai.env
sudo systemctl restart edusense-v7
```

Use either `GEMINI_API_KEY` with `EDUSENSE_AI_PROVIDER=gemini`, or
`OPENAI_API_KEY` with `EDUSENSE_AI_PROVIDER=openai`. Never put API keys in source
files, browser JavaScript, screenshots or GitHub. With no provider, the local
evidence engine still creates deterministic recommendations.

## 9. Operations and updates

```bash
cd ~/edusense-ATL
git pull --ff-only
sudo systemctl restart edusense-v7
sudo journalctl -u edusense-v7 -f
```

Back up only the local state when required:

```bash
sudo systemctl stop edusense-v7
sudo cp /var/lib/edusense/edusense.db /secure/backup/location/
sudo systemctl start edusense-v7
```

Do not commit the backup. SQLite history survives ordinary service restarts,
reboots and power recovery because it is stored outside the source checkout.

## 10. Cloudflare Worker and D1

Requirements: Node.js 20+ and a Cloudflare account.

```bash
cd cloud/worker
npm ci
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler login
npx wrangler d1 create edusense-cloud
```

Put the returned D1 ID only in the ignored `wrangler.jsonc`. Then run:

```bash
npm run typecheck
npm run db:remote
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run build
npx wrangler deploy
```

Generate `SESSION_SECRET` with a cryptographically secure tool, for example
`openssl rand -base64 48`. Register the exact deployed callback URL in the
Google OAuth Web Application. Keep production IDs, tokens and `.dev.vars` out
of version control. Update `EDUSENSE_CLOUD_URL` in the Pi service if deploying
under a different Worker hostname.

## 11. Public website

The website is an informational project site and sanitized demo, not the live
classroom portal. Build it independently:

```bash
cd website/source
npm ci
npm test
npm run build
```

Configure `APPS_SCRIPT_WEBHOOK_URL` and `APPS_SCRIPT_WEBHOOK_SECRET` only as
hosting secrets if the contact form is enabled. Never expose classroom data,
device credentials or Pi URLs through the public website.

## 12. Acceptance checklist

- One complete ordered serial packet arrives approximately every second.
- The 200-second calibration cannot be skipped and outputs remain off.
- Baseline sample count increases and is locked before monitoring starts.
- A one-second spike does not create WARNING or DANGER.
- Sustained and correlated increases escalate through the backend.
- Browser status exactly matches the Flask API; frontend code makes no decision.
- SQLite history remains after reboot and charts load stored ranges.
- Arduino receives commands only from the Pi after calibration.
- Disconnecting internet does not stop local monitoring or history.
- Reconnecting internet drains the queued cloud uploads.
- No secret, database, Wi-Fi password or OAuth credential exists in Git history.

## 13. Safety boundary

This educational prototype is not a certified fire, carbon-monoxide, gas or
life-safety instrument. Estimated PPM is not laboratory-grade without certified
reference-gas calibration and a validated sensor-resistance model. Maintain
certified alarms, emergency procedures and teacher judgement independently.
