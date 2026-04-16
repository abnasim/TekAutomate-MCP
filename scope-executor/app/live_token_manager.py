"""
In-memory live session token manager for executor-protected actions.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
import threading
from typing import TypedDict


class LiveTokenStatus(TypedDict):
    active: bool
    expiresAt: str | None
    remainingSec: int
    tokenPreview: str | None
    durationMinutes: int | None


class LiveTokenManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._token: str | None = None
        self._expires_at: datetime | None = None
        self._duration_minutes: int | None = None

    def _utc_now(self) -> datetime:
        return datetime.now(timezone.utc)

    def _clear_if_expired(self):
        if self._token and self._expires_at and self._expires_at <= self._utc_now():
            self._token = None
            self._expires_at = None
            self._duration_minutes = None

    def _preview(self) -> str | None:
        if not self._token:
            return None
        if len(self._token) <= 10:
            return self._token
        return f"{self._token[:6]}...{self._token[-4:]}"

    def generate(self, duration_minutes: int) -> tuple[str, LiveTokenStatus]:
        duration_minutes = max(30, min(int(duration_minutes), 24 * 60))
        with self._lock:
            self._token = secrets.token_urlsafe(32)
            self._duration_minutes = duration_minutes
            self._expires_at = self._utc_now() + timedelta(minutes=duration_minutes)
            return self._token, self._status_locked()

    def revoke(self) -> LiveTokenStatus:
        with self._lock:
            self._token = None
            self._expires_at = None
            self._duration_minutes = None
            return self._status_locked()

    def status(self) -> LiveTokenStatus:
        with self._lock:
            return self._status_locked()

    def validate(self, token: str | None) -> tuple[bool, str]:
        candidate = str(token or '').strip()
        with self._lock:
            self._clear_if_expired()
            if not self._token or not self._expires_at:
                return False, 'No active live token. Generate one in the executor UI.'
            if not candidate:
                return False, 'Missing live token.'
            if not secrets.compare_digest(candidate, self._token):
                return False, 'Invalid live token.'
            return True, 'ok'

    def _status_locked(self) -> LiveTokenStatus:
        self._clear_if_expired()
        if not self._token or not self._expires_at:
            return {
                "active": False,
                "expiresAt": None,
                "remainingSec": 0,
                "tokenPreview": None,
                "durationMinutes": None,
            }
        remaining = max(0, int((self._expires_at - self._utc_now()).total_seconds()))
        return {
            "active": True,
            "expiresAt": self._expires_at.isoformat(),
            "remainingSec": remaining,
            "tokenPreview": self._preview(),
            "durationMinutes": self._duration_minutes,
        }
