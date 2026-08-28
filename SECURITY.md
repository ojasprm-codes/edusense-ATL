# Security Policy

## Public repository boundary

This repository contains source code and sanitized deployment examples. It must
never contain live classroom data or credentials.

Do not commit:

- SQLite, D1 export, CSV, PNG report, or log files;
- school Wi-Fi names or passwords;
- Google OAuth client secrets;
- Gemini, OpenAI, Cloudflare, GitHub, or webhook secrets;
- Raspberry Pi device credentials or enrollment tokens;
- `.dev.vars`, `.env`, `device.json`, private keys, or certificates;
- account-specific Cloudflare project, D1 database, or binding identifiers.

## Runtime design

- Classroom safety decisions remain on the Raspberry Pi.
- Pi-to-cloud communication is outbound HTTPS only.
- Device secrets are generated during enrollment and stored outside the source
  tree with owner-only permissions.
- The cloud stores hashes of device and session credentials.
- School portal sessions use secure, HTTP-only cookies.
- Parents require an invitation and device assignment.
- The public website contains no classroom telemetry or hardware controls.

## Reporting a problem

Do not open a public issue containing a credential, private classroom record, or
school network detail. Revoke the exposed credential first, remove it from the
runtime system, and contact the repository owner privately.

