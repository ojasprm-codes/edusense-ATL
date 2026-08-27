"""Arduino serial reader for EDUSENSE AI V7.

Expected Arduino packet every second:
TEMP:28.6,HUM:74.1,MQ2:108,MQ3:0,MQ4:0,MQ5:320,MQ7:215,MQ8:468
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Optional

try:
    import serial
    from serial import SerialException
except ImportError:
    serial = None  # type: ignore
    SerialException = Exception  # type: ignore


PACKET_KEYS = ("TEMP", "HUM", "MQ2", "MQ3", "MQ4", "MQ5", "MQ7", "MQ8")
RECONNECT_INTERVAL = 3.0

DEFAULT_DATA: Dict[str, Any] = {
    "temperature": 0.0,
    "humidity": 0.0,
    "mq2": 0,
    "mq3": 0,
    "mq4": 0,
    "mq5": 0,
    "mq7": 0,
    "mq8": 0,
    "timestamp": 0.0,
}


class SerialReader:
    """Continuously reads validated Arduino packets on a background thread."""

    def __init__(
        self,
        port: str,
        baudrate: int = 9600,
        timeout: float = 1.0,
        on_packet: Optional[Callable[[Dict[str, Any]], None]] = None,
        on_connect: Optional[Callable[[], None]] = None,
        on_disconnect: Optional[Callable[[], None]] = None,
    ):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.on_packet = on_packet
        self.on_connect = on_connect
        self.on_disconnect = on_disconnect
        self._lock = threading.Lock()
        self._data: Dict[str, Any] = dict(DEFAULT_DATA)
        self._last_received = 0.0
        self._connected = False
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._serial = None
        self._last_error = ""

    @property
    def last_error(self) -> str:
        return self._last_error

    def is_connected(self, stale_after: float = 5.0) -> bool:
        with self._lock:
            if not self._connected or self._last_received == 0:
                return False
            return (time.time() - self._last_received) <= stale_after

    def get_data(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._data)

    def start(self) -> bool:
        if serial is None:
            self._last_error = "pyserial not installed. Run: pip install pyserial"
            return False
        if self._running:
            return True
        self._running = True
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        with self._lock:
            serial_port = self._serial
        if serial_port and serial_port.is_open:
            serial_port.close()
        with self._lock:
            was_connected = self._connected
            self._connected = False
        if was_connected and self.on_disconnect:
            self.on_disconnect()

    def write_command(self, command: str) -> bool:
        """Write a Raspberry Pi decision command back to Arduino."""
        with self._lock:
            serial_port = self._serial
            connected = self._connected
        if not connected or not serial_port or not serial_port.is_open:
            return False
        try:
            serial_port.write((command.strip() + "\n").encode("utf-8"))
            serial_port.flush()
            return True
        except (SerialException, OSError) as exc:
            self._last_error = str(exc)
            with self._lock:
                self._connected = False
            if self.on_disconnect:
                self.on_disconnect()
            return False

    def _open_port(self) -> bool:
        try:
            serial_port = serial.Serial(port=self.port, baudrate=self.baudrate, timeout=self.timeout)
            time.sleep(2)
            serial_port.reset_input_buffer()
            with self._lock:
                self._serial = serial_port
                self._connected = True
            self._last_error = ""
            if self.on_connect:
                self.on_connect()
            return True
        except (SerialException, OSError) as exc:
            self._last_error = str(exc)
            with self._lock:
                self._serial = None
                self._connected = False
            return False

    def _parse_line(self, line: str) -> Optional[Dict[str, Any]]:
        line = line.strip()
        if not line or line == "EDUSENSE_READY":
            return None

        parts = line.split(",")
        if len(parts) != len(PACKET_KEYS):
            return None

        values: Dict[str, str] = {}
        for part in parts:
            key, separator, value = part.partition(":")
            if separator != ":" or key not in PACKET_KEYS or key in values:
                return None
            values[key] = value

        if tuple(values.keys()) != PACKET_KEYS:
            return None

        try:
            temperature = float(values["TEMP"])
            humidity = float(values["HUM"])
            gas_values = {key.lower(): int(values[key]) for key in PACKET_KEYS[2:]}
        except ValueError:
            return None

        if temperature != temperature or humidity != humidity:
            return None
        if not (-40 <= temperature <= 80 and 0 <= humidity <= 100):
            return None
        if any(value < 0 for value in gas_values.values()):
            return None

        return {
            "temperature": round(temperature, 1),
            "humidity": round(humidity, 1),
            **gas_values,
            "timestamp": time.time(),
        }

    def _read_loop(self) -> None:
        while self._running:
            with self._lock:
                serial_port = self._serial
            if not serial_port or not serial_port.is_open:
                if not self._open_port():
                    time.sleep(RECONNECT_INTERVAL)
                    continue
                with self._lock:
                    serial_port = self._serial

            try:
                raw = serial_port.readline()
                if not raw:
                    continue
                parsed = self._parse_line(raw.decode("utf-8", errors="ignore"))
                if not parsed:
                    continue
                with self._lock:
                    self._data = parsed
                    self._last_received = time.time()
                    self._connected = True
                if self.on_packet:
                    self.on_packet(parsed)
            except (SerialException, OSError, UnicodeDecodeError) as exc:
                self._last_error = str(exc)
                with self._lock:
                    was_connected = self._connected
                    self._connected = False
                    serial_port = self._serial
                    self._serial = None
                if was_connected and self.on_disconnect:
                    self.on_disconnect()
                try:
                    if serial_port:
                        serial_port.close()
                except Exception:
                    pass
                time.sleep(1)

        with self._lock:
            was_connected = self._connected
            self._connected = False
        if was_connected and self.on_disconnect:
            self.on_disconnect()
