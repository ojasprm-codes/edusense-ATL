# Public Website

The source of the current EDUSENSE AI informational website is in
[`source/`](source/). It contains the product explanation, school workflow,
technology pages, sanitized interactive demo, pilot information and support
form. It is intentionally separate from the authenticated classroom portal.

## Run locally

```bash
cd website/source
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Verify and build

```bash
npm test
npm run build
```

The public demo uses labelled sample values. It does not connect to a Raspberry
Pi, serial port, classroom SQLite database, LED or buzzer. The classroom hero
scene is illustrative artwork, not a photograph of a deployed installation.

Contact-delivery settings belong in hosting secrets named
`APPS_SCRIPT_WEBHOOK_URL` and `APPS_SCRIPT_WEBHOOK_SECRET`; never place their
values in source code. Account-specific hosting metadata and generated output
are excluded from this repository.
