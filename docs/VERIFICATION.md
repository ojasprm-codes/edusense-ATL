# Verification Record

## Raspberry Pi

Run from the repository root:

```bash
python3 -m compileall -q raspberry-pi/src raspberry-pi/tests
cd raspberry-pi/src
PYTHONPATH=. python3 ../tests/test_v72_regressions.py
```

Expected result: six tests pass. They cover:

1. estimated ppm plus retained raw ADC in the API shape;
2. estimated ppm plus raw ADC in CSV export;
3. the two-hour range definition;
4. retrieval of 7,200 one-second readings;
5. one-spike rejection followed by sustained-rise escalation; and
6. calibration reset using `OUTPUTS:OFF` instead of `STATUS:SAFE`.

The publication audit also ran a Flask test-client smoke check against the
split repository layout. `/`, `/vendor/chart.umd.min.js`, and `/api/health`
each returned HTTP 200.

## Cloud Worker

```bash
cd cloud/worker
npm ci
copy wrangler.example.jsonc wrangler.jsonc   # Windows
# cp wrangler.example.jsonc wrangler.jsonc   # Linux/macOS
npm run typecheck
npm run build
```

The dry-run build does not deploy or require production secrets. The audit
machine completed TypeScript type-checking and Wrangler's dry-run bundle using
the sanitized D1 binding configuration.

## Public website

```bash
cd website/source
npm ci
npm test
```

The test command builds the vinext application and verifies rendered HTML and
all secure cloud-portal entry links. Both rendered-page tests passed in the
publication tree.

## Arduino

Open `arduino/edusense_v7_uno.ino` in Arduino IDE with the Adafruit DHT and
Adafruit Unified Sensor libraries installed. Select Arduino Uno, verify, and
upload. Complete the manual warm-up and status-command checklist in
`arduino/README.md`.

The audit machine did not have `arduino-cli` installed, so automated firmware
compilation is not claimed in this record.

## Deployment-script checks

On Linux or Raspberry Pi OS:

```bash
bash -n raspberry-pi/deploy/*.sh
```

The installer must resolve `src/app.py`, create a virtual environment, place the
database in `/var/lib/edusense`, configure Nginx and systemd, and avoid embedding
runtime credentials in the repository.

The audit host was Windows and did not provide Bash, so shell syntax is enforced
by the repository's Ubuntu GitHub Actions job rather than claimed as a local
Raspberry Pi execution result.

## Publication safety scan

Before every push, inspect tracked files and search for forbidden material:

```bash
git status --short
git ls-files
git grep -n -I -E 'GOCSPX-|AIza|sk-[A-Za-z0-9_-]{20,}'
git ls-files | grep -E '(\.db$|\.dev\.vars$|device\.json$|\.pem$|\.key$)'
```

Review every match manually. Environment-variable names and empty examples are
allowed; real values are not.
