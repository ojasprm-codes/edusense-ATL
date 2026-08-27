"""Local-only first-boot Wi-Fi and cloud enrollment portal for EDUSENSE."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from typing import Any, Dict, List

from flask import Blueprint, Response, jsonify, request

from cloud_client import CloudClient


SETUP_CONNECTION = "edusense-setup"
SCHOOL_CONNECTION = "edusense-school"


def _html() -> str:
    return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EDUSENSE Device Setup</title><style>
:root{color-scheme:dark;--bg:#07101c;--panel:#0e1a29;--line:#29394f;--text:#f8fafc;--muted:#94a3b8;--cyan:#22d3ee}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:18px;letter-spacing:0}.panel{width:min(560px,100%);padding:28px;background:var(--panel);border:1px solid var(--line);border-radius:8px}.brand{color:var(--cyan);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.3px}h1{font-size:28px;line-height:1.15;margin:8px 0}.muted{color:var(--muted)}form{display:grid;gap:14px;margin-top:22px}label{display:grid;gap:6px;font-weight:700}input,select,button{width:100%;min-height:46px;border-radius:6px;font:inherit}input,select{background:#08121f;border:1px solid var(--line);color:var(--text);padding:0 12px}button{border:0;background:var(--cyan);color:#06242b;font-weight:800;cursor:pointer}.status{margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:6px}.hidden{display:none}.steps{padding-left:20px;color:var(--muted)}code{color:#d5f8ff}</style></head><body><main class="panel"><div class="brand">EDUSENSE AI V7</div><h1>Connect this classroom device</h1><p class="muted">The school Wi-Fi password is saved only by NetworkManager on this Raspberry Pi. It is never sent to EDUSENSE Cloud.</p><ol class="steps"><li>Select the school network.</li><li>Enter its Wi-Fi password.</li><li>Enter the one-time setup code from the secure cloud portal.</li></ol><form id="setup"><label>School Wi-Fi<select id="ssid" name="ssid" required><option>Scanning...</option></select></label><label>Wi-Fi password<input name="password" type="password" minlength="8" maxlength="63" required autocomplete="current-password"></label><label>Cloud setup code<input name="enrollment_token" required maxlength="200" autocomplete="off" placeholder="edu_..."></label><label>Classroom or room name<input name="device_name" required maxlength="120" value="EDUSENSE Classroom"></label><button type="submit">Connect securely</button></form><div id="status" class="status hidden"></div></main><script>
const status=document.getElementById('status'),form=document.getElementById('setup'),ssid=document.getElementById('ssid');const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function scan(){try{const r=await fetch('/api/setup/networks');const d=await r.json();ssid.innerHTML=d.networks.map(n=>'<option value="'+esc(n.ssid)+'">'+esc(n.ssid)+' ('+n.signal+'%)'+(n.security?' - secured':'')+'</option>').join('')||'<option value="">No network found</option>'}catch(e){ssid.innerHTML='<option value="">Scan failed</option>'}}form.onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(form));status.classList.remove('hidden');status.textContent='Saving settings. This setup Wi-Fi will disconnect in a moment...';const r=await fetch('/api/setup/provision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const d=await r.json();if(!r.ok){status.textContent=d.error||'Setup failed';return}form.classList.add('hidden');status.innerHTML='<strong>Settings accepted.</strong><br>Reconnect your phone to the school Wi-Fi. The Pi will appear as <code>http://edusense.local</code> and will begin sending data securely.'};scan();</script></body></html>"""


class WifiProvisioner:
    def __init__(self, cloud_client: CloudClient) -> None:
        self.cloud_client = cloud_client
        self.state_path = Path(os.getenv("EDUSENSE_PROVISION_STATE", "/var/lib/edusense/provisioning.json"))
        self._lock = threading.RLock()
        self._state: Dict[str, Any] = {"state": "ready", "message": "Waiting for setup."}
        self._maintenance_mode = False
        try:
            stored = json.loads(self.state_path.read_text(encoding="utf-8"))
            self._maintenance_mode = bool(stored.get("maintenance_mode"))
            self._state.update(stored)
        except (OSError, ValueError, TypeError):
            pass

    @property
    def configured(self) -> bool:
        return bool(self.cloud_client.status().get("configured"))

    @property
    def setup_allowed(self) -> bool:
        return not self.configured or self._maintenance_mode

    def networks(self) -> List[Dict[str, Any]]:
        result = subprocess.run(
            ["nmcli", "-t", "--escape", "yes", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes", "ifname", "wlan0"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Wi-Fi scan failed")
        unique: Dict[str, Dict[str, Any]] = {}
        for line in result.stdout.splitlines():
            parts = self._split_nmcli(line)
            if len(parts) < 3 or not parts[0]:
                continue
            try:
                signal = int(parts[1])
            except ValueError:
                signal = 0
            current = unique.get(parts[0])
            if not current or signal > current["signal"]:
                unique[parts[0]] = {"ssid": parts[0], "signal": signal, "security": parts[2]}
        return sorted(unique.values(), key=lambda item: (-item["signal"], item["ssid"].lower()))

    def begin(self, ssid: str, password: str, enrollment_token: str, device_name: str) -> None:
        if self.configured and not self._maintenance_mode:
            raise RuntimeError("This device is already enrolled")
        if not ssid or len(ssid.encode("utf-8")) > 32:
            raise ValueError("Select a valid Wi-Fi network")
        if not 8 <= len(password) <= 63:
            raise ValueError("Wi-Fi password must contain 8 to 63 characters")
        if not self.configured and not enrollment_token.startswith("edu_"):
            raise ValueError("Enter a valid cloud setup code")
        with self._lock:
            if self._state.get("state") == "working":
                raise RuntimeError("Setup is already in progress")
            self._state = {"state": "working", "message": "Connecting to school Wi-Fi."}
        thread = threading.Thread(
            target=self._provision,
            args=(ssid, password, enrollment_token, device_name),
            name="edusense-wifi-provision",
            daemon=True,
        )
        thread.start()

    def reset_network(self) -> None:
        """Forget the school Wi-Fi and return wlan0 to setup-hotspot mode."""
        with self._lock:
            if self._state.get("state") == "resetting":
                raise RuntimeError("Network reset is already in progress")
            self._maintenance_mode = True
            self._state = {
                "state": "resetting",
                "message": "Forgetting school Wi-Fi and enabling the setup hotspot.",
                "maintenance_mode": True,
                "updated_at": time.time(),
            }
            self._persist_state()
        threading.Thread(target=self._reset_network_worker, name="edusense-network-reset", daemon=True).start()

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._state)

    def _provision(self, ssid: str, password: str, token: str, device_name: str) -> None:
        time.sleep(2.5)  # Allow the browser to receive the accepted response before the AP stops.
        try:
            already_enrolled = self.configured
            subprocess.run(["nmcli", "connection", "delete", SCHOOL_CONNECTION], capture_output=True, timeout=10, check=False)
            result = subprocess.run(
                ["nmcli", "device", "wifi", "connect", ssid, "password", password, "ifname", "wlan0", "name", SCHOOL_CONNECTION],
                capture_output=True,
                text=True,
                timeout=45,
                check=False,
            )
            password = ""  # Minimize its lifetime in this process.
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "Could not connect to the school Wi-Fi")
            for _ in range(20):
                if self._internet_available():
                    break
                time.sleep(1)
            else:
                raise RuntimeError("School Wi-Fi connected but internet access is unavailable")
            if already_enrolled:
                device_id = self.cloud_client.status().get("device_id") or "existing device"
                self._set_state("complete", f"Wi-Fi updated for cloud device {device_id}.")
            else:
                enrollment = self.cloud_client.enroll(token, self.hardware_serial(), device_name)
                self._set_state("complete", f"Connected to cloud device {enrollment['device_id']}.")
            self._maintenance_mode = False
            self._persist_state()
            subprocess.run(["nmcli", "connection", "down", SETUP_CONNECTION], capture_output=True, timeout=10, check=False)
        except Exception as exc:
            self._set_state("error", str(exc)[:300])
            # A failed first-time setup must remain recoverable without imaging
            # the SD card again.
            subprocess.run(
                ["nmcli", "connection", "up", SETUP_CONNECTION],
                capture_output=True,
                timeout=15,
                check=False,
            )

    def _reset_network_worker(self) -> None:
        time.sleep(3.0)  # Let the dashboard receive the accepted response first.
        try:
            subprocess.run(["nmcli", "connection", "delete", SCHOOL_CONNECTION], capture_output=True, timeout=15, check=False)
            result = subprocess.run(["nmcli", "connection", "up", SETUP_CONNECTION], capture_output=True, text=True, timeout=25, check=False)
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "Could not enable the EDUSENSE setup hotspot")
            self._set_state("maintenance", "Setup hotspot active. Open http://10.42.0.1/setup.")
        except Exception as exc:
            self._set_state("error", str(exc)[:300])

    def _internet_available(self) -> bool:
        try:
            result = subprocess.run(
                ["nmcli", "-t", "-f", "GENERAL.STATE", "device", "show", "wlan0"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            return result.returncode == 0 and "100 (connected)" in result.stdout
        except (OSError, subprocess.SubprocessError):
            return False

    def _set_state(self, state: str, message: str) -> None:
        data = {"state": state, "message": message, "updated_at": time.time(),
                "maintenance_mode": self._maintenance_mode}
        with self._lock:
            self._state = data
        self._persist_state()

    def _persist_state(self) -> None:
        try:
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            self.state_path.write_text(json.dumps(self._state), encoding="utf-8")
        except OSError:
            pass

    @staticmethod
    def hardware_serial() -> str:
        try:
            cpuinfo = Path("/proc/cpuinfo").read_text(encoding="utf-8", errors="ignore")
            match = re.search(r"^Serial\s*:\s*([0-9a-fA-F]+)$", cpuinfo, re.MULTILINE)
            if match:
                return f"rpi-{match.group(1).lower()}"
        except OSError:
            pass
        try:
            return f"rpi-{Path('/etc/machine-id').read_text(encoding='utf-8').strip()}"
        except OSError:
            return "rpi-unknown"

    @staticmethod
    def _split_nmcli(line: str) -> List[str]:
        values, current, escaped = [], [], False
        for char in line:
            if escaped:
                current.append(char)
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == ":":
                values.append("".join(current))
                current = []
            else:
                current.append(char)
        values.append("".join(current))
        return values


def create_setup_blueprint(provisioner: WifiProvisioner) -> Blueprint:
    blueprint = Blueprint("device_setup", __name__)

    @blueprint.get("/setup")
    def setup_page() -> Response:
        if not provisioner.setup_allowed:
            return Response("Device setup is locked after enrollment.", status=403, mimetype="text/plain")
        page = _html()
        if provisioner.configured:
            page = page.replace(
                "Cloud setup code<input name=\"enrollment_token\" required",
                "Cloud setup code (already enrolled - leave blank)<input name=\"enrollment_token\"",
            )
        return Response(page, mimetype="text/html", headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"})

    @blueprint.get("/api/setup/networks")
    def setup_networks():
        if not provisioner.setup_allowed:
            return jsonify({"error": "Device setup is locked."}), 403
        try:
            return jsonify({"networks": provisioner.networks()})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 503

    @blueprint.post("/api/setup/provision")
    def setup_provision():
        payload = request.get_json(silent=True) or {}
        try:
            provisioner.begin(
                str(payload.get("ssid", "")).strip(),
                str(payload.get("password", "")),
                str(payload.get("enrollment_token", "")).strip(),
                str(payload.get("device_name", "EDUSENSE Classroom")).strip()[:120],
            )
            return jsonify({"accepted": True}), 202
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 409

    @blueprint.get("/api/setup/status")
    def setup_status():
        return jsonify({**provisioner.status(), "cloud": provisioner.cloud_client.status()})

    @blueprint.post("/api/setup/reset-network")
    def reset_network():
        payload = request.get_json(silent=True) or {}
        if payload.get("confirm") != "RESET NETWORK":
            return jsonify({"error": "Type RESET NETWORK to confirm."}), 400
        try:
            provisioner.reset_network()
            return jsonify({"accepted": True, "message": "Network reset scheduled."}), 202
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 409

    return blueprint
