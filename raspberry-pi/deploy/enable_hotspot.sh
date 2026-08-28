#!/usr/bin/env bash
set -euo pipefail

HOTSPOT_NAME="edusense-setup"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash raspberry-pi/deploy/enable_hotspot.sh"
  exit 1
fi

nmcli connection up "${HOTSPOT_NAME}"
echo "EDUSENSE setup hotspot enabled for local maintenance."
