# EDUSENSE AI V7 Classroom Monitor Deployment

V7 keeps the Flask dashboard, SQLite history, local safety decision engine, Arduino commands,
and alarms on the Raspberry Pi. It adds outbound-only cloud synchronization and a
first-boot school Wi-Fi setup flow. The Pi is never opened directly to the internet.

## Install

Clone this repository on the Pi, then run the installer from the repository root:

```bash
cd ~/edusense-ATL
sudo bash raspberry-pi/deploy/install_edusense_v7.sh
```

The installer disables old `edusense-v3` and `edusense-v6` services to prevent a
port conflict. V7 starts with its own SQLite database and does not import old history.

## Optional AI Reports

The safety engine, status, LED, and buzzer never depend on an online AI model. To
enable richer wording for the on-demand **Generate range report** button, configure
one provider on the Pi:

```bash
sudo nano /var/lib/edusense/ai.env
```

For Gemini:

```text
EDUSENSE_AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

Or for OpenAI:

```text
EDUSENSE_AI_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

Then apply it with `sudo systemctl restart edusense-v7`. The file is readable only
by the service owner. If no key is configured or internet is unavailable, the local
evidence engine automatically produces the report.

## First Device Setup

1. Sign in to the EDUSENSE Cloud portal and create the school workspace.
2. Choose **Have a device? Use now** and generate a 15-minute setup code.
3. Power on the Pi and join the unique `EDUSENSE-XXXX` Wi-Fi printed by the installer.
4. Open `http://10.42.0.1/setup`.
5. Select school Wi-Fi, enter its password, and enter the cloud setup code.
6. Reconnect the phone to school Wi-Fi and open `http://edusense.local` for the local dashboard.

NetworkManager stores the school Wi-Fi secret only on the Pi. Cloud telemetry uses
HTTPS and a per-device credential. Unsent readings remain in SQLite and resume after
internet recovery or a reboot.

## Operations

```bash
sudo systemctl status edusense-v7
sudo journalctl -u edusense-v7 -f
sudo systemctl restart edusense-v7
curl http://127.0.0.1:5000/api/health
curl http://127.0.0.1:5000/api/setup/status
```

Enrollment credentials are stored at `/var/lib/edusense/device.json` with owner-only
permissions. Device release/reset is intentionally an administrator operation rather
than an unauthenticated dashboard action.
