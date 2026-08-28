# EDUSENSE AI School Portal

Cloudflare Worker and D1 backend for authenticated remote EDUSENSE classroom
monitoring. The Worker accepts outbound telemetry from enrolled Raspberry Pi
devices and gives authorized school users a read-only view of classroom air
conditions, ventilation guidance, device health, and saved history.

## Security Model

- The public EDUSENSE website contains no classroom data.
- Raspberry Pi devices make outbound HTTPS requests only.
- Device credentials are randomly generated and stored hashed in D1.
- Google sign-in uses Authorization Code + PKCE.
- Sessions use hashed random tokens in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
- Parents require an invitation and explicit classroom-device assignment.
- Safety decisions, Arduino status commands, LEDs, and buzzers remain local to the Pi.

## OAuth Registration

Register a Google OAuth 2.0 Web Application using this exact production callback:

```text
https://edusense-cloud.ojasprm.workers.dev/auth/google/callback
```

Google requires an OAuth 2.0 Web Application with the callback above and the
portal origin as an authorized JavaScript origin.

Configure these Worker secrets after registration:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

Never commit provider credentials or `.dev.vars`.

## Development

```bash
npm install
npm run typecheck
npm run build
npm run db:local
npm run dev
```

Production D1 migrations are in `migrations/`. The deployed database is located
in the APAC region.
