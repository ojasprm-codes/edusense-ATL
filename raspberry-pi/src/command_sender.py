"""Arduino command sender for Raspberry Pi-owned EDUSENSE status decisions."""

from __future__ import annotations

from typing import Optional


class CommandSender:
    """Sends STATUS commands only when calibration is complete and status changes."""

    VALID_STATUSES = {"SAFE", "ELEVATED", "WARNING", "DANGER"}

    def __init__(self, serial_reader):
        self.serial_reader = serial_reader
        self.last_sent_status: Optional[str] = None

    def send_status_if_changed(self, status: str) -> bool:
        status = status.upper()
        if status not in self.VALID_STATUSES:
            return False
        if status == self.last_sent_status:
            return False
        sent = self.send_status(status, force=False)
        return sent

    def send_status(self, status: str, force: bool = False) -> bool:
        status = status.upper()
        if status not in self.VALID_STATUSES:
            return False
        if not force and status == self.last_sent_status:
            return False
        sent = self.serial_reader.write_command(f"STATUS:{status}")
        if sent:
            self.last_sent_status = status
        return sent

    def reset(self) -> None:
        self.last_sent_status = None

    def clear_outputs(self) -> bool:
        """Force outputs off without issuing an environmental status decision."""
        self.last_sent_status = None
        return self.serial_reader.write_command("OUTPUTS:OFF")
