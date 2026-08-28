# Cloud Overview

Live website: [EDUSENSE AI](https://edusense-ai-schools.ojas-premt2.chatgpt.site)

The cloud-supported layer receives authenticated telemetry batches from enrolled classroom devices and presents approved environmental information through the public dashboard.

## Publicly Documented Flow

```mermaid
sequenceDiagram
    participant Pi as Raspberry Pi
    participant API as Cloud endpoint
    participant UI as EDUSENSE dashboard
    Pi->>API: Authenticated telemetry batch
    API-->>Pi: Upload acknowledgement
    UI->>API: Request dashboard data
    API-->>UI: Current and historical readings
```

The Raspberry Pi remains authoritative for local collection, calibration, safety classification, and storage. Network or cloud failures do not stop local processing.

## Included source

The deployable Worker, D1 migrations, package lock, and a sanitized Wrangler
configuration are in [`worker/`](worker/). Copy `wrangler.example.jsonc` to
`wrangler.jsonc`, create a D1 database, replace the placeholder database ID,
apply migrations, configure secrets, and deploy with Wrangler. See
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the complete procedure.

## Intentionally excluded

- account identifiers and private bindings
- databases and classroom telemetry
- enrollment codes and device secrets
- API tokens and OAuth credentials
- production environment configuration
