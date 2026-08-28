#!/usr/bin/env bash
set -euo pipefail

APP_NAME="edusense-v7"
HOTSPOT_NAME="edusense-setup"
HOSTNAME_VALUE="edusense"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${APP_DIR}/src"
APP_USER="${SUDO_USER:-$(whoami)}"
SYSTEM_PYTHON="/usr/bin/python3"
VENV_DIR="${APP_DIR}/.venv"
PYTHON_BIN="${VENV_DIR}/bin/python"
STATE_DIR="/var/lib/edusense"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
WIFI_SERVICE="/etc/systemd/system/edusense-wifi-setup.service"
WIFI_HELPER="/usr/local/sbin/edusense-wifi-boot"
NGINX_SITE="/etc/nginx/sites-available/edusense"
AP_ENV="${STATE_DIR}/setup-ap.env"
AI_ENV="${STATE_DIR}/ai.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash raspberry-pi/deploy/install_edusense_v7.sh"
  exit 1
fi

echo "[EDUSENSE] Installing Raspberry Pi services..."
apt-get update
apt-get install -y python3 python3-pip python3-venv network-manager avahi-daemon nginx openssl
"${SYSTEM_PYTHON}" -m venv "${VENV_DIR}"
"${PYTHON_BIN}" -m pip install --upgrade pip
"${PYTHON_BIN}" -m pip install -r "${APP_DIR}/requirements.txt"

install -d -m 0750 -o "${APP_USER}" -g "${APP_USER}" "${STATE_DIR}"
usermod -a -G dialout,netdev "${APP_USER}"

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

if [[ ! -f "${AI_ENV}" ]]; then
  install -m 0600 -o "${APP_USER}" -g "${APP_USER}" /dev/null "${AI_ENV}"
fi

hostnamectl set-hostname "${HOSTNAME_VALUE}"
if grep -qE '^127\.0\.1\.1\s+' /etc/hosts; then
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1   ${HOSTNAME_VALUE}/" /etc/hosts
else
  echo "127.0.1.1   ${HOSTNAME_VALUE}" >> /etc/hosts
fi

systemctl enable NetworkManager avahi-daemon
systemctl restart NetworkManager avahi-daemon

cat > /etc/polkit-1/rules.d/49-edusense-networkmanager.rules <<'POLKIT'
polkit.addRule(function(action, subject) {
  if (subject.isInGroup("netdev") && action.id.indexOf("org.freedesktop.NetworkManager.") === 0) {
    return polkit.Result.YES;
  }
});
POLKIT

if [[ ! -f "${AP_ENV}" ]]; then
  SERIAL_SUFFIX="$(awk -F': ' '/^Serial/{print substr($2,length($2)-3)}' /proc/cpuinfo | tr '[:lower:]' '[:upper:]')"
  SERIAL_SUFFIX="${SERIAL_SUFFIX:-SETUP}"
  AP_PASSWORD="$(openssl rand -hex 6)"
  cat > "${AP_ENV}" <<ENV
EDUSENSE_SETUP_SSID=EDUSENSE-${SERIAL_SUFFIX}
EDUSENSE_SETUP_PASSWORD=${AP_PASSWORD}
ENV
  chmod 0600 "${AP_ENV}"
fi
# shellcheck disable=SC1090
source "${AP_ENV}"

nmcli connection delete "${HOTSPOT_NAME}" >/dev/null 2>&1 || true
nmcli connection add con-name "${HOTSPOT_NAME}" type wifi ifname wlan0 \
  wifi.mode ap wifi.ssid "${EDUSENSE_SETUP_SSID}" 802-11-wireless.band bg \
  wifi-sec.key-mgmt wpa-psk wifi-sec.psk "${EDUSENSE_SETUP_PASSWORD}" \
  ipv4.method shared ipv4.addresses 10.42.0.1/24 ipv6.method disabled \
  connection.autoconnect no connection.autoconnect-priority -50

cat > "${WIFI_HELPER}" <<'HELPER'
#!/usr/bin/env bash
set -euo pipefail
if nmcli -t -f NAME connection show --active | grep -qx 'edusense-school'; then
  exit 0
fi
if nmcli -t -f NAME connection show | grep -qx 'edusense-school'; then
  nmcli --wait 25 connection up edusense-school && exit 0 || true
fi
nmcli connection up edusense-setup || true
HELPER
chmod 0755 "${WIFI_HELPER}"

cat > "${WIFI_SERVICE}" <<SERVICE
[Unit]
Description=EDUSENSE Wi-Fi selection
After=NetworkManager.service
Wants=NetworkManager.service
Before=${APP_NAME}.service

[Service]
Type=oneshot
ExecStart=${WIFI_HELPER}
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SERVICE

cat > "${SERVICE_FILE}" <<SERVICE
[Unit]
Description=EDUSENSE AI V7 Classroom Service
After=network-online.target edusense-wifi-setup.service
Wants=network-online.target edusense-wifi-setup.service

[Service]
Type=simple
User=${APP_USER}
SupplementaryGroups=dialout netdev
WorkingDirectory=${SOURCE_DIR}
ExecStart=${PYTHON_BIN} ${SOURCE_DIR}/app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=EDUSENSE_HOST=127.0.0.1
Environment=EDUSENSE_PORT=5000
Environment=EDUSENSE_DB=${STATE_DIR}/edusense.db
Environment=EDUSENSE_CLOUD_URL=https://edusense-cloud.ojasprm.workers.dev
Environment=EDUSENSE_DEVICE_CREDENTIALS=${STATE_DIR}/device.json
Environment=EDUSENSE_PROVISION_STATE=${STATE_DIR}/provisioning.json
EnvironmentFile=-${AI_ENV}

[Install]
WantedBy=multi-user.target
SERVICE

cat > "${NGINX_SITE}" <<'NGINX'
server {
    listen 80;
    server_name edusense.local edusense 10.42.0.1;
    client_max_body_size 1m;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
ln -sf "${NGINX_SITE}" /etc/nginx/sites-enabled/edusense
rm -f /etc/nginx/sites-enabled/default
nginx -t

for old_service in edusense-v3 edusense-v6; do
  systemctl disable --now "${old_service}.service" >/dev/null 2>&1 || true
done
systemctl daemon-reload
systemctl enable nginx edusense-wifi-setup.service "${APP_NAME}.service"
systemctl restart nginx edusense-wifi-setup.service "${APP_NAME}.service"

echo
echo "[EDUSENSE] V7 installation complete"
echo "Temporary setup Wi-Fi: ${EDUSENSE_SETUP_SSID}"
echo "Temporary setup password: ${EDUSENSE_SETUP_PASSWORD}"
echo "Setup page: http://10.42.0.1/setup"
echo "Local dashboard after school Wi-Fi setup: http://edusense.local"
echo "Service logs: sudo journalctl -u ${APP_NAME} -f"
