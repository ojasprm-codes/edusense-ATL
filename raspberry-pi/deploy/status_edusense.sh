#!/usr/bin/env bash
set -euo pipefail

echo "EDUSENSE service:"
systemctl --no-pager --full status edusense-v7 || true

echo
echo "Hotspot connection:"
nmcli connection show edusense-setup || true

echo
echo "Active Wi-Fi device:"
nmcli device status | grep -E 'wlan0|DEVICE' || true

echo
echo "URLs:"
echo "  http://edusense.local"
echo "  http://10.42.0.1"

echo
echo "Recent EDUSENSE logs:"
journalctl -u edusense-v7 -n 40 --no-pager || true
