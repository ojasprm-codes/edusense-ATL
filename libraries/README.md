# Library Overview

## Runtime Dependencies

| Library | Minimum version | Use |
| --- | ---: | --- |
| Flask | 3.0.0 | Local dashboard server and JSON API |
| pyserial | 3.5 | Arduino USB serial communication |
| psutil | 5.9.0 | Raspberry Pi CPU, memory and disk metrics |

## Python Standard Library

The project also uses standard modules including `sqlite3`, `threading`, `datetime`, `pathlib`, `json`, `urllib`, `csv`, `statistics`, `subprocess`, and `unittest`.

## External System Tools

The guided Wi-Fi setup expects NetworkManager's `nmcli` command on Raspberry Pi OS.

Dependencies are installed from `raspberry-pi/requirements.txt`. No copied vendor directory is required.
