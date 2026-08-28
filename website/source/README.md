# EDUSENSE AI Website

Public product website for EDUSENSE AI, an environmental intelligence system for schools.

This project is intentionally separate from the Raspberry Pi classroom prototype. The dashboard demo contains sanitized static sample data and has no connection to a local Pi address, classroom database, serial device, LED, or buzzer.

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production

```bash
npm run build
npm run start
```

The build emits a Cloudflare Worker-compatible application in `dist/`.

## Main Sections

- Product overview
- For Schools
- Technology and architecture
- Sanitized interactive dashboard demo
- Pilot programme
- Support and FAQs
- About and contact enquiry preparation

## Privacy Boundary

Never add live Raspberry Pi URLs, serial credentials, private classroom readings, SQLite databases, API secrets, or direct device controls to this repository.
