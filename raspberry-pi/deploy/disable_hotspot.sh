#!/usr/bin/env bash
set -euo pipefail

HOTSPOT_NAME="edusense-setup"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash raspberry-pi/deploy/disable_hotspot.sh"
  exit 1
fi

nmcli connection down "${HOTSPOT_NAME}" || true
nmcli connection modify "${HOTSPOT_NAME}" connection.autoconnect no || true
echo "EDUSENSE setup hotspot disabled."
