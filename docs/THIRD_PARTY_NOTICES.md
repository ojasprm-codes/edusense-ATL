# Third-Party Software

EDUSENSE uses open-source dependencies under their respective licenses. The
package lock files remain the authoritative dependency inventories.

## Raspberry Pi

- Flask and its transitive dependencies
- pyserial
- psutil
- Chart.js 4.4.1, whose minified browser distribution is vendored under
  `raspberry-pi/web/vendor/` for offline charts (MIT License)

## Cloud Worker

- TypeScript
- Wrangler and Cloudflare Workers type definitions

## Public website

- React and React DOM
- vinext and Vite
- Tailwind CSS
- lucide-react
- Drizzle ORM and Drizzle Kit
- Cloudflare Vite plugin and Wrangler
- ESLint and associated plugins

Review `raspberry-pi/requirements.txt`, `cloud/worker/package-lock.json`, and
`website/source/package-lock.json` before redistribution. This project does not
remove or supersede any dependency's copyright or license terms.
