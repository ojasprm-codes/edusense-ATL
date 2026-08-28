# Evidence and Asset Provenance

This document separates implementation evidence from presentation assets.

## Interface captures

| File | What it represents |
|---|---|
| `website/images/edusense-ai-site-preview.png` | Capture of the current public EDUSENSE website |
| `website/images/edusense-v7-dashboard.png` | Capture of the current EDUSENSE V7 dashboard interface |

These images demonstrate interface design only. They are not evidence of sensor
accuracy, certification, or a school-wide deployment.

## Public website assets

The source under `website/source/public/` is copied from the currently deployed
website project. The classroom background is an illustrative visual created for
the website. It is not a photograph and is not presented as one. Dashboard data
shown in the public demo is fixed and sanitized.

## Hardware evidence

No verified hardware photograph was available in the audited source folders, so
this repository does not add a stock photo or generated hardware photograph.
Hardware connections are documented as text and diagrams. Future photographs
should be added only with a date, caption, and confirmation that they show the
actual EDUSENSE prototype.

## Source provenance

- Raspberry Pi source, tests, web assets, deployment scripts, and Arduino
  reference firmware were compared against `D:\edusense-v7-cloud`.
- Cloud Worker source was copied from the active local `edusense-cloud` project;
  account-specific Wrangler configuration was replaced by a sanitized example.
- Public website source was copied from the active local `edusense-website`
  project; `.openai`, build output, and hosting identifiers were excluded.

## Claims policy

Documentation must use **estimated ppm**, **prototype**, and **educational
monitor** where applicable. It must not claim certified concentration accuracy,
medical benefit, life-safety compliance, or an installation that has not been
verified.

