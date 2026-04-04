"""
VNC availability probing and native WebSocket bridge management.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import secrets
import socket
import threading
import time
from typing import Callable

from websockets.asyncio.server import ServerConnection, serve


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _read_rfb_banner(host: str, port: int, timeout: float = 2.0) -> bytes:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        data = b""
        while not data.endswith(b"\n") and len(data) < 64:
            chunk = sock.recv(64 - len(data))
            if not chunk:
                break
            data += chunk
        return data


@dataclass
class _ProbeCacheEntry:
    available: bool
    checked_at: float
    error: str | None = None
    rfb_banner: str | None = None


@dataclass
class _VncSession:
    session_id: str
    vnc_token: str
    target_host: str
    target_port: int
    listen_host: str
    bind_host: str
    listen_port: int
    ws_url: str
    created_at: datetime
    last_touched_at: datetime
    thread: threading.Thread | None = None
    ready_event: threading.Event = field(default_factory=threading.Event)
    stop_event: threading.Event = field(default_factory=threading.Event)
    loop: asyncio.AbstractEventLoop | None = None
    stop_future: asyncio.Future | None = None
    active_connections: int = 0
    start_error: str | None = None
    last_error: str | None = None
    rfb_banner: str | None = None

    def running(self) -> bool:
        return bool(self.thread and self.thread.is_alive() and not self.stop_event.is_set() and not self.start_error)

    def payload(self) -> dict:
        return {
            "running": self.running(),
            "session_id": self.session_id,
            "vnc_token": self.vnc_token,
            "target": {
                "host": self.target_host,
                "port": self.target_port,
            },
            "listen": {
                "host": self.listen_host,
                "bindHost": self.bind_host,
                "port": self.listen_port,
            },
            "ws_url": self.ws_url,
            "createdAt": _iso(self.created_at),
            "lastTouchedAt": _iso(self.last_touched_at),
            "uptime_sec": max(0, int((_utc_now() - self.created_at).total_seconds())),
            "activeConnections": self.active_connections,
            "rfbBanner": self.rfb_banner,
            "lastError": self.last_error,
        }


class VncProxyManager:
    def __init__(
        self,
        *,
        listen_host: str,
        bind_host: str | None = None,
        live_token_status_provider: Callable[[], dict],
        log_callback: Callable[[str], None] | None = None,
        inactivity_timeout_sec: int = 300,
        probe_cache_ttl_sec: int = 60,
    ):
        self._listen_host = listen_host or "127.0.0.1"
        self._bind_host = bind_host or "0.0.0.0"
        self._live_token_status_provider = live_token_status_provider
        self._log_callback = log_callback
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
                    "rfbBanner": entry.rfb_banner,
                }

        available = False
        error: str | None = None
        banner_text: str | None = None
        try:
            banner = _read_rfb_banner(host, port, timeout=2.0)
            banner_text = banner.decode("ascii", errors="replace").strip() if banner else None
            if banner.startswith(b"RFB "):
                available = True
            else:
                error = f"Unexpected VNC banner: {banner_text or '<empty>'}"
        except Exception as exc:
            error = str(exc)

        with self._lock:
            self._probe_cache[key] = _ProbeCacheEntry(
                available=available,
                checked_at=now,
                error=error,
                rfb_banner=banner_text,
            )

        return {
            "ok": True,
            "available": available,
            "target": {"host": host, "port": port},
            "error": error,
            "cached": False,
            "checkedAt": now,
            "rfbBanner": banner_text,
        }

    def test_target(self, target_host: str, target_port: int = 5900) -> dict:
        result = self.probe(target_host, target_port)
        if not result.get("ok"):
            return result
        if result.get("available"):
            return {
                "ok": True,
                "reachable": True,
                "target": result.get("target"),
                "rfbBanner": result.get("rfbBanner"),
                "message": f"VNC server responded with {result.get('rfbBanner') or 'an RFB banner'}.",
            }
        return {
            "ok": True,
            "reachable": False,
            "target": result.get("target"),
            "rfbBanner": result.get("rfbBanner"),
            "error": result.get("error") or "VNC server did not return a valid RFB banner.",
        }

    def start(self, target_host: str, target_port: int = 5900, listen_port: int = 6080) -> dict:
        host = str(target_host or "").strip()
        port = int(target_port or 5900)
        desired_listen_port = int(listen_port or 6080)
        if not host:
            raise ValueError("Missing target_host")

        key = self._target_key(host, port)
        probe_result = self.probe(host, port)
        if not probe_result.get("available"):
            self._log(f"Bridge start skipped: target {host}:{port} not available ({probe_result.get('error') or 'probe failed'})")
            return {"ok": False, "error": probe_result.get("error") or "VNC not available for target.", "available": False}

        with self._lock:
            self._sweep_locked()
            existing = self._sessions_by_target.get(key)
            if existing and existing.running():
                existing.last_touched_at = _utc_now()
                self._log(f"Bridge reused for {host}:{port} on ws://{existing.listen_host}:{existing.listen_port}")
                return {"ok": True, **existing.payload(), "reused": True}

            listen_port_resolved = self._allocate_listen_port_locked(desired_listen_port)
            now_dt = _utc_now()
            session = _VncSession(
                session_id=secrets.token_urlsafe(12),
                vnc_token=secrets.token_urlsafe(24),
                target_host=host,
                target_port=port,
                listen_host=self._listen_host,
                bind_host=self._bind_host,
                listen_port=listen_port_resolved,
                ws_url=f"ws://{self._listen_host}:{listen_port_resolved}",
                created_at=now_dt,
                last_touched_at=now_dt,
                rfb_banner=probe_result.get("rfbBanner"),
            )
            session.thread = threading.Thread(target=self._run_bridge_thread, args=(session,), daemon=True)
            self._sessions_by_target[key] = session
            self._sessions_by_id[session.session_id] = session
            session.thread.start()
            self._log(f"Bridge starting for {host}:{port} on ws://{session.listen_host}:{listen_port_resolved}")

        session.ready_event.wait(timeout=3.0)
        with self._lock:
            if session.start_error:
                self._log(f"Bridge failed for {host}:{port}: {session.start_error}")
                self._remove_session_locked(session)
                raise RuntimeError(session.start_error)
            if not session.running():
                self._log(f"Bridge did not reach running state for {host}:{port}")
                self._remove_session_locked(session)
                raise RuntimeError("VNC bridge did not start cleanly.")
            session.last_touched_at = _utc_now()
            self._log(f"Bridge ready for {host}:{port} on ws://{session.listen_host}:{session.listen_port}")
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
            self._prune_exited_locked()
            if target_host:
                key = self._target_key(str(target_host).strip(), int(target_port or 5900))
                session = self._sessions_by_target.get(key)
                if not session or not session.running():
                    return {"ok": True, "running": False}
                session.last_touched_at = _utc_now()
                return {"ok": True, **session.payload()}
            sessions = [session.payload() for session in self._sessions_by_id.values() if session.running()]
            return {"ok": True, "running": bool(sessions), "sessions": sessions}

    def summary(self) -> dict:
        with self._lock:
            self._prune_exited_locked()
            latest_probe_key = None
            latest_probe = None
            for key, entry in self._probe_cache.items():
                if latest_probe is None or entry.checked_at > latest_probe.checked_at:
                    latest_probe_key = key
                    latest_probe = entry

            sessions = [session.payload() for session in self._sessions_by_id.values() if session.running()]
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
                    "rfbBanner": latest_probe.rfb_banner,
                }
            return result

    def _cleanup_loop(self):
        while not self._stop_event.wait(15):
            try:
                with self._lock:
                    self._sweep_locked()
            except Exception:
                continue

    def _prune_exited_locked(self):
        for session in list(self._sessions_by_id.values()):
            if session.thread and not session.thread.is_alive():
                self._remove_session_locked(session)

    def _sweep_locked(self):
        live_status = self._live_token_status_provider() or {}
        if not live_status.get("active"):
            self._stop_all_locked()
            return

        now_dt = _utc_now()
        for session in list(self._sessions_by_id.values()):
            if not session.running():
                self._remove_session_locked(session)
                continue
            idle_sec = (now_dt - session.last_touched_at).total_seconds()
            if session.active_connections <= 0 and idle_sec >= self._inactivity_timeout_sec:
                self._stop_session_locked(session)

    def _stop_all_locked(self):
        for session in list(self._sessions_by_id.values()):
            self._stop_session_locked(session)

    def _stop_session_locked(self, session: _VncSession):
        self._log(f"Bridge stopping for {session.target_host}:{session.target_port}")
        session.stop_event.set()
        loop = session.loop
        stop_future = session.stop_future
        if loop and stop_future and not stop_future.done():
            try:
                loop.call_soon_threadsafe(stop_future.set_result, None)
            except Exception:
                pass
        thread = session.thread
        self._remove_session_locked(session)
        if thread and thread.is_alive():
            thread.join(timeout=2.0)

    def _remove_session_locked(self, session: _VncSession):
        self._sessions_by_id.pop(session.session_id, None)
        self._sessions_by_target.pop(self._target_key(session.target_host, session.target_port), None)

    def _allocate_listen_port_locked(self, desired_port: int) -> int:
        port = max(1024, int(desired_port))
        active_ports = {session.listen_port for session in self._sessions_by_id.values() if session.running()}
        while port in active_ports or not self._port_available(port):
            port += 1
        return port

    def _port_available(self, port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind((self._bind_host, port))
            return True
        except Exception:
            return False

    def _run_bridge_thread(self, session: _VncSession):
        loop = asyncio.new_event_loop()
        session.loop = loop
        asyncio.set_event_loop(loop)
        stop_future = loop.create_future()
        session.stop_future = stop_future

        async def _runner():
            try:
                async with serve(
                    lambda websocket: self._handle_client(session, websocket),
                    session.bind_host,
                    session.listen_port,
                    compression=None,
                    max_size=None,
                    ping_interval=20,
                    ping_timeout=20,
                ):
                    self._log(f"WebSocket server listening on {session.bind_host}:{session.listen_port} for {session.target_host}:{session.target_port}")
                    session.ready_event.set()
                    await stop_future
            except Exception as exc:
                session.start_error = str(exc)
                session.last_error = str(exc)
                self._log(f"WebSocket server failed on {session.bind_host}:{session.listen_port}: {exc}")
                session.ready_event.set()

        try:
            loop.run_until_complete(_runner())
        finally:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            loop.close()

    async def _handle_client(self, session: _VncSession, websocket: ServerConnection):
        self._touch_session(session, connected_delta=1)
        self._log(f"VNC WS client connected for {session.target_host}:{session.target_port}")
        reader = None
        writer = None
        try:
            reader, writer = await asyncio.open_connection(session.target_host, session.target_port)
            sock = writer.get_extra_info("socket")
            if sock is not None:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self._log(f"TCP tunnel connected to {session.target_host}:{session.target_port}")

            async def _ws_to_tcp():
                while True:
                    message = await websocket.recv(decode=False)
                    if message is None:
                        break
                    if isinstance(message, str):
                        message = message.encode("utf-8")
                    writer.write(message)
                    await writer.drain()
                    self._touch_session(session)

            async def _tcp_to_ws():
                first_chunk = True
                while True:
                    data = await reader.read(65536)
                    if not data:
                        break
                    if first_chunk:
                        first_chunk = False
                        banner = data[:32].decode("ascii", errors="replace").strip()
                        self._log(f"Received first TCP bytes from {session.target_host}:{session.target_port}: {banner or '<binary>'}")
                    await websocket.send(data)
                    self._touch_session(session)

            tasks = [
                asyncio.create_task(_ws_to_tcp()),
                asyncio.create_task(_tcp_to_ws()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                exc = task.exception()
                if exc:
                    raise exc
        except Exception as exc:
            session.last_error = str(exc)
            self._log(f"VNC bridge error for {session.target_host}:{session.target_port}: {exc}")
            try:
                await websocket.close()
            except Exception:
                pass
        finally:
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
            self._touch_session(session, connected_delta=-1)
            self._log(f"VNC WS client disconnected for {session.target_host}:{session.target_port}")

    def _touch_session(self, session: _VncSession, *, connected_delta: int = 0):
        with self._lock:
            if session.session_id not in self._sessions_by_id:
                return
            session.last_touched_at = _utc_now()
            if connected_delta:
                session.active_connections = max(0, session.active_connections + connected_delta)

    def _target_key(self, host: str, port: int) -> str:
        return f"{host}:{int(port)}"

    def _log(self, message: str):
        callback = self._log_callback
        if not callback:
            return
        try:
            callback(str(message))
        except Exception:
            pass
