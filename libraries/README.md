# Library Overview

## Runtime Dependencies

| Library | Minimum version | Use |
| --- | ---: | --- |
| Flask | 3.0.0 | Local dashboard server and JSON API |
| pyserial | 3.5 | Arduino USB serial communication |
| psutil | 5.9.0 | Raspberry Pi CPU, memory and disk metrics |
| Chart.js | 4.4.1 | Offline local-dashboard charts (vendored minified browser build) |

## Python Standard Library

The project also uses standard modules including `sqlite3`, `threading`, `datetime`, `pathlib`, `json`, `urllib`, `csv`, `statistics`, `subprocess`, and `unittest`.

## External System Tools

The guided Wi-Fi setup expects NetworkManager's `nmcli` command on Raspberry Pi OS.

Python dependencies are installed from `raspberry-pi/requirements.txt`. The
Chart.js browser build is deliberately included in `raspberry-pi/web/vendor/`
so local charts continue working without internet access. Cloud and public-site
JavaScript dependencies are pinned by their respective `package-lock.json`
files and installed with `npm ci`.
