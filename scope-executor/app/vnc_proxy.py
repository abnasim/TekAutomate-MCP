"""
VNC availability probing and websockify session management.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Callable


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


@dataclass
class _ProbeCacheEntry:
    available: bool
    checked_at: float
    error: str | None = None


@dataclass
class _VncSession:
    session_id: str
    vnc_token: str
    target_host: str
    target_port: int
    listen_host: str
    listen_port: int
    ws_url: str
    process: subprocess.Popen
    created_at: datetime
    last_touched_at: datetime

    def payload(self) -> dict:
        return {
            "running": self.process.poll() is None,
            "session_id": self.session_id,
            "vnc_token": self.vnc_token,
            "target": {
                "host": self.target_host,
                "port": self.target_port,
            },
            "listen": {
                "host": self.listen_host,
                "port": self.listen_port,
            },
            "ws_url": self.ws_url,
            "createdAt": _iso(self.created_at),
            "lastTouchedAt": _iso(self.last_touched_at),
            "uptime_sec": max(0, int((_utc_now() - self.created_at).total_seconds())),
        }


class VncProxyManager:
    def __init__(
        self,
        *,
        listen_host: str,
        live_token_status_provider: Callable[[], dict],
        inactivity_timeout_sec: int = 300,
        probe_cache_ttl_sec: int = 60,
    ):
        self._listen_host = listen_host or "127.0.0.1"
        self._live_token_status_provider = live_token_status_provider
        self._inactivity_timeout_sec = max(60, int(inactivity_timeout_sec))
        self._probe_cache_ttl_sec = max(5, int(probe_cache_ttl_sec))
        self._lock = threading.Lock()
        self._probe_cache: dict[str, _ProbeCacheEntry] = {}
        self._sessions_by_target: dict[str, _VncSession] = {}
        self._sessions_by_id: dict[str, _VncSession] = {}
        self._stop_event = threading.Event()
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def shutdown(self):
        self._stop_event.set()
        with self._lock:
            self._stop_all_locked()

    def probe(self, target_host: str, target_port: int = 5900) -> dict:
        host = str(target_host or "").strip()
        port = int(target_port or 5900)
        if not host:
            return {
                "ok": False,
                "available": False,
                "target": {"host": host, "port": port},
                "error": "Missing target_host",
                "cached": False,
            }

        key = self._target_key(host, port)
        now = time.time()
        with self._lock:
            entry = self._probe_cache.get(key)
            if entry and now - entry.checked_at <= self._probe_cache_ttl_sec:
                return {
                    "ok": True,
                    "available": entry.available,
                    "target": {"host": host, "port": port},
                    "error": entry.error,
                    "cached": True,
                    "checkedAt": entry.checked_at,
                }

        available = False
        error: str | None = None
        try:
            with socket.create_connection((host, port), timeout=2.0):
                available = True
        except Exception as exc:
            error = str(exc)

        with self._lock:
            self._probe_cache[key] = _ProbeCacheEntry(available=available, checked_at=now, error=error)

        return {
            "ok": True,
            "available": available,
            "target": {"host": host, "port": port},
            "error": error,
            "cached": False,
            "checkedAt": now,
        }

    def start(self, target_host: str, target_port: int = 5900, listen_port: int = 6080) -> dict:
        host = str(target_host or "").strip()
        port = int(target_port or 5900)
        desired_listen_port = int(listen_port or 6080)
        if not host:
            raise ValueError("Missing target_host")

        key = self._target_key(host, port)
        with self._lock:
            self._sweep_locked()
            existing = self._sessions_by_target.get(key)
            if existing and existing.process.poll() is None:
                existing.last_touched_at = _utc_now()
                return {"ok": True, **existing.payload(), "reused": True}

            probe_result = self.probe(host, port)
            if not probe_result.get("available"):
                return {"ok": False, "error": probe_result.get("error") or "VNC not available for target.", "available": False}

            command = self._build_command()
            listen_port_resolved = self._allocate_listen_port_locked(desired_listen_port)
            proc = subprocess.Popen(
                [*command, str(listen_port_resolved), f"{host}:{port}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            time.sleep(0.25)
            if proc.poll() is not None:
                raise RuntimeError("websockify exited immediately. Check that it is installed in the executor environment.")

            now_dt = _utc_now()
            session = _VncSession(
                session_id=secrets.token_urlsafe(12),
                vnc_token=secrets.token_urlsafe(24),
                target_host=host,
                target_port=port,
                listen_host=self._listen_host,
                listen_port=listen_port_resolved,
                ws_url=f"ws://{self._listen_host}:{listen_port_resolved}",
                process=proc,
                created_at=now_dt,
                last_touched_at=now_dt,
            )
            self._sessions_by_target[key] = session
            self._sessions_by_id[session.session_id] = session
            return {"ok": True, **session.payload(), "reused": False}

    def stop(self, session_id: str | None = None) -> dict:
        with self._lock:
            if session_id:
                session = self._sessions_by_id.get(str(session_id).strip())
                if not session:
                    return {"ok": True, "stopped": 0}
                self._stop_session_locked(session)
                return {"ok": True, "stopped": 1}
            count = len(self._sessions_by_id)
            self._stop_all_locked()
            return {"ok": True, "stopped": count}

    def status(self, target_host: str | None = None, target_port: int | None = None) -> dict:
        with self._lock:
            self._sweep_locked()
            if target_host:
                key = self._target_key(str(target_host).strip(), int(target_port or 5900))
                session = self._sessions_by_target.get(key)
                if not session or session.process.poll() is not None:
                    return {"ok": True, "running": False}
                session.last_touched_at = _utc_now()
                return {"ok": True, **session.payload()}
            sessions = [session.payload() for session in self._sessions_by_id.values() if session.process.poll() is None]
            return {"ok": True, "running": bool(sessions), "sessions": sessions}

    def summary(self) -> dict:
        with self._lock:
            self._sweep_locked()
            latest_probe_key = None
            latest_probe = None
            for key, entry in self._probe_cache.items():
                if latest_probe is None or entry.checked_at > latest_probe.checked_at:
                    latest_probe_key = key
                    latest_probe = entry

            sessions = [session.payload() for session in self._sessions_by_id.values() if session.process.poll() is None]
            result = {
                "ok": True,
                "running": bool(sessions),
                "sessionCount": len(sessions),
                "sessions": sessions,
            }
            if latest_probe_key and latest_probe:
                host, _, port = latest_probe_key.rpartition(":")
                result["latestProbe"] = {
                    "target": {"host": host, "port": int(port or 5900)},
                    "available": latest_probe.available,
                    "error": latest_probe.error,
                    "checkedAt": latest_probe.checked_at,
                    "ageSec": max(0, int(time.time() - latest_probe.checked_at)),
                }
            return result

    def _cleanup_loop(self):
        while not self._stop_event.wait(15):
            with self._lock:
                self._sweep_locked()

    def _sweep_locked(self):
        live_status = self._live_token_status_provider() or {}
        if not live_status.get("active"):
            self._stop_all_locked()
            return

        now_dt = _utc_now()
        for session in list(self._sessions_by_id.values()):
            if session.process.poll() is not None:
                self._remove_session_locked(session)
                continue
            idle_sec = (now_dt - session.last_touched_at).total_seconds()
            if idle_sec >= self._inactivity_timeout_sec:
                self._stop_session_locked(session)

    def _stop_all_locked(self):
        for session in list(self._sessions_by_id.values()):
            self._stop_session_locked(session)

    def _stop_session_locked(self, session: _VncSession):
        try:
            if session.process.poll() is None:
                session.process.terminate()
                session.process.wait(timeout=2.0)
        except Exception:
            try:
                session.process.kill()
            except Exception:
                pass
        self._remove_session_locked(session)

    def _remove_session_locked(self, session: _VncSession):
        self._sessions_by_id.pop(session.session_id, None)
        self._sessions_by_target.pop(self._target_key(session.target_host, session.target_port), None)

    def _allocate_listen_port_locked(self, desired_port: int) -> int:
        port = max(1024, int(desired_port))
        active_ports = {session.listen_port for session in self._sessions_by_id.values() if session.process.poll() is None}
        while port in active_ports or not self._port_available(port):
            port += 1
        return port

    def _port_available(self, port: int) -> bool:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("0.0.0.0", port))
            sock.close()
            return True
        except Exception:
            return False

    def _build_command(self) -> list[str]:
        if shutil.which("websockify"):
            return ["websockify"]
        return [sys.executable, "-m", "websockify"]

    def _target_key(self, host: str, port: int) -> str:
        return f"{host}:{int(port)}"
