"""
Persistent worker process for Tek Automate executor.

Supports:
- generic `run_python` jobs
- live-mode `capture_screenshot` jobs
- live-mode `send_scpi` jobs

Live-mode jobs reuse cached PyVISA sessions keyed by VISA resource so repeated
captures and commands do not reconnect on every request.
"""

import io
import json
import os
import sys
import threading
import time
import traceback
import warnings
import base64
import string

_real_stdout = sys.stdout

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

warnings.filterwarnings("ignore")

_null = open(os.devnull, "w")
_real_stderr = sys.stderr
sys.stderr = _null

try:
    import pyvisa
except Exception:
    pyvisa = None
try:
    import tm_devices  # noqa: F401
except Exception:
    pass
try:
    import tekhsi  # noqa: F401
except Exception:
    pass

sys.stderr = _real_stderr
_null.close()

_session_lock = threading.Lock()
_resource_manager = None
_scope_sessions: dict[str, object] = {}
_socket_sessions: dict[str, object] = {}  # Raw socket sessions for SOCKET VISA resources
_capture_locks: dict[str, threading.Lock] = {}
_visa_locks: dict[str, threading.Lock] = {}  # Per-VISA resource lock — prevents send_scpi + screenshot race
_recent_capture_results: dict[str, tuple[float, dict]] = {}
_recent_capture_errors: dict[str, tuple[float, str]] = {}
_recent_scpi_activity: dict[str, tuple[float, dict]] = {}
_DEFAULT_CAPTURE_TIMEOUT_MS = 15000
_BUSY_CAPTURE_CACHE_MAX_AGE_SEC = 10.0
_SCPI_CHUNK_SIZE_SOCKET = 8
_SCPI_CHUNK_SIZE_VISA = 12
_SCPI_CHUNK_PAUSE_SEC = 0.12
_CAPTURE_RETRY_COUNT = 2
_RAW_READ_PREFIXES = (
    "FILESYSTEM:READFILE",
    "FILESYSTEM:READFILE?",
)


def _visa_lock_for(visa: str) -> threading.Lock:
    """Get or create a per-VISA lock. All operations on the same instrument must hold this."""
    with _session_lock:
        lock = _visa_locks.get(visa)
        if lock is None:
            lock = threading.Lock()
            _visa_locks[visa] = lock
        return lock


def _is_socket_resource(visa: str) -> bool:
    """Check if VISA resource is a raw socket (not VXI-11 INSTR)."""
    return "SOCKET" in visa.upper()


def _parse_socket_address(visa: str) -> tuple[str, int]:
    """Extract host and port from TCPIP::host::port::SOCKET resource string."""
    parts = visa.split("::")
    host = parts[1] if len(parts) > 1 else "127.0.0.1"
    port = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 4000
    return host, port


def _get_socket_session(visa: str):
    """Get or create a raw SocketInstr session for SOCKET resources."""
    try:
        from app.socket_instr import SocketInstr
    except ModuleNotFoundError:
        try:
            from socket_instr import SocketInstr
        except ModuleNotFoundError as exc:
            raise RuntimeError(f"Could not import SocketInstr: {exc}") from exc
    with _session_lock:
        session = _socket_sessions.get(visa)
        if session is not None:
            try:
                # Health check with short timeout — don't block 20s on stale session
                session.set_timeout(3)
                session.write('*OPC?')
                resp = session.read()
                session.set_timeout(5)  # restore default
                if resp.strip() == '1':
                    return session
            except Exception:
                pass
            # Session is stale — close and reopen
            try:
                session.close()
            except Exception:
                pass
            _socket_sessions.pop(visa, None)
        host, port = _parse_socket_address(visa)
        session = SocketInstr(host, port, timeout=5)
        session.clear()  # device clear on fresh connection
        _socket_sessions[visa] = session
        return session


def _reset_socket_session(visa: str):
    """Close and remove a cached socket session."""
    with _session_lock:
        session = _socket_sessions.pop(visa, None)
        if session is not None:
            try:
                session.close()
            except Exception:
                pass


def _emit(obj: dict):
    _real_stdout.write(json.dumps(obj) + "\n")
    _real_stdout.flush()


def _resource_manager_instance():
    global _resource_manager
    if _resource_manager is None:
        if pyvisa is None:
            raise RuntimeError("pyvisa is not available in worker")
        # Try default backend (NI-VISA) first, fall back to pyvisa-py
        try:
            _resource_manager = pyvisa.ResourceManager()
        except Exception:
            _resource_manager = pyvisa.ResourceManager("@py")
    return _resource_manager


def _reset_resource_manager():
    global _resource_manager
    with _session_lock:
        for visa, session in list(_scope_sessions.items()):
            try:
                session.close()
            except Exception:
                pass
            _scope_sessions.pop(visa, None)
        if _resource_manager is not None:
            try:
                _resource_manager.close()
            except Exception:
                pass
            _resource_manager = None


def _capture_lock_for(visa: str) -> threading.Lock:
    with _session_lock:
        lock = _capture_locks.get(visa)
        if lock is None:
            lock = threading.Lock()
            _capture_locks[visa] = lock
        return lock


def _capture_timeout_ms(job: dict) -> int:
    """Resolve a practical screenshot timeout from job fields."""
    timeout_ms = job.get("timeout_ms")
    if timeout_ms is not None:
        try:
            return max(5000, min(int(timeout_ms), 15000))
        except Exception:
            pass
    timeout_sec = job.get("timeout_sec")
    if timeout_sec is not None:
        try:
            return max(5000, min(int(timeout_sec) * 1000, 15000))
        except Exception:
            pass
    return _DEFAULT_CAPTURE_TIMEOUT_MS


def _record_scpi_activity(visa: str, *, command_count: int, total_ms: float, had_timeout: bool, used_socket: bool):
    _recent_scpi_activity[visa] = (
        time.time(),
        {
            "command_count": command_count,
            "total_ms": total_ms,
            "had_timeout": had_timeout,
            "used_socket": used_socket,
        },
    )


def _recent_scpi_settle_delay(visa: str) -> float:
    recent = _recent_scpi_activity.get(visa)
    if not recent:
        return 0.0
    timestamp, meta = recent
    if time.time() - timestamp > 8.0:
        return 0.0
    command_count = int(meta.get("command_count", 0) or 0)
    total_ms = float(meta.get("total_ms", 0) or 0)
    had_timeout = bool(meta.get("had_timeout", False))
    if had_timeout:
        return 0.8
    if command_count >= 18 or total_ms >= 4000:
        return 0.45
    if command_count >= 10 or total_ms >= 2000:
        return 0.2
    return 0.0


def _command_timeout_ms(cmd: str, default_timeout_ms: int) -> int:
    upper = cmd.upper()
    timeout_ms = default_timeout_ms
    if upper.endswith("?"):
        timeout_ms = max(timeout_ms, 4000)
    if (
        "MEASUREMENT:" in upper
        or "MEASUREMENT;" in upper
        or "MEASUREMENT:MEAS" in upper
        or "MEASU" in upper
        or "BUS:" in upper
        or "DISPLAY?" in upper
        or "THRESH" in upper
    ):
        timeout_ms = max(timeout_ms, 7000)
    if (
        "AUTOSET" in upper
        or "SAVE:" in upper
        or "RECALL:" in upper
        or "RECALL:" in upper
        or "FILESYSTEM:" in upper
        or "*RST" in upper
    ):
        timeout_ms = max(timeout_ms, 12000)
    return timeout_ms


def _command_settle_seconds(cmd: str) -> float:
    upper = cmd.upper()
    if any(token in upper for token in ("AUTOSET", "SAVE:", "FILESYSTEM:", "RECALL:", "RECAll:", "ACQUIRE:STATE", "ACQuire:STATE")):
        return 0.18
    if any(token in upper for token in ("MEASU", "HORIZ", "TRIGGER", "BUS:", "DISPLAY:")):
        return 0.04
    return 0.0


def _set_session_timeout(session, timeout_ms: int, use_socket: bool):
    if use_socket:
        session.set_timeout(timeout_ms / 1000.0)
    else:
        session.timeout = timeout_ms


def _requires_raw_read(cmd: str) -> bool:
    upper = cmd.strip().lstrip(":").upper()
    return any(upper.startswith(prefix) for prefix in _RAW_READ_PREFIXES)


def _raw_payload_to_result(data: bytes) -> dict:
    if not data:
        return {
            "response": "",
            "isBinary": False,
            "byteCount": 0,
            "encoding": "utf-8",
            "rawBase64": "",
        }

    try:
        decoded = data.decode("utf-8")
        printable = sum(1 for ch in decoded if ch in string.printable or ch in "\n\r\t")
        is_text = ("\x00" not in decoded) and (printable / max(len(decoded), 1) >= 0.85)
        if is_text:
            return {
                "response": decoded,
                "isBinary": False,
                "byteCount": len(data),
                "encoding": "utf-8",
            }
    except UnicodeDecodeError:
        pass

    return {
        "response": f"[binary payload {len(data)} bytes; see rawBase64]",
        "isBinary": True,
        "byteCount": len(data),
        "encoding": "base64",
        "rawBase64": base64.b64encode(data).decode("ascii"),
    }


def _readfile_payload_via_visa_stream(scpi, chunk_size: int = 65536) -> bytes:
    """Read FILESystem:READFile payload via low-level VISA reads.

    FILESystem:READFile is not IEEE 488.2 compliant and may not terminate in a
    way that MessageBasedResource.read_raw() can consume reliably. We therefore
    read low-level chunks until the driver reports the transfer completed, or
    a timeout occurs after at least some bytes were received.
    """
    data = bytearray()
    success_max = getattr(pyvisa.constants.StatusCode, "success_max_count_read", None) if pyvisa else None
    error_timeout = getattr(pyvisa.constants.StatusCode, "error_timeout", None) if pyvisa else None

    while True:
        try:
            chunk, status = scpi.visalib.read(scpi.session, chunk_size)
            if chunk:
                data.extend(bytes(chunk))
            if status != success_max:
                break
        except Exception as exc:
            error_code = getattr(exc, "error_code", None)
            if data and error_timeout is not None and error_code == error_timeout:
                break
            raise

    return bytes(data)


def _open_command_session(visa: str, timeout_ms: int, use_socket: bool):
    if use_socket:
        session = _get_socket_session(visa)
        _set_session_timeout(session, timeout_ms, True)
        return session, False
    session = _open_fresh_scope_session(visa)
    session.timeout = timeout_ms
    session.write_termination = "\n"
    session.read_termination = "\n"
    return session, True


def _get_scope_session(visa: str):
    with _session_lock:
        session = _scope_sessions.get(visa)
        if session is not None:
            try:
                _ = session.session
                old_timeout = getattr(session, "timeout", 5000)
                old_write_term = getattr(session, "write_termination", None)
                old_read_term = getattr(session, "read_termination", None)
                session.timeout = 3000
                session.write_termination = "\n"
                session.read_termination = "\n"
                try:
                    resp = str(session.query("*IDN?")).strip()
                    if resp:
                        return session
                finally:
                    session.timeout = old_timeout
                    session.write_termination = old_write_term
                    session.read_termination = old_read_term
            except Exception:
                try:
                    session.close()
                except Exception:
                    pass
                _scope_sessions.pop(visa, None)
        rm = _resource_manager_instance()
        try:
            session = rm.open_resource(visa)
        except Exception:
            # The cached ResourceManager itself can go stale after another job
            # closes underlying VISA state. Rebuild it once and retry.
            _reset_resource_manager()
            rm = _resource_manager_instance()
            session = rm.open_resource(visa)
        try:
            session.clear()
        except Exception:
            pass
        _scope_sessions[visa] = session
        return session


def _reset_scope_session(visa: str):
    """Force close and remove a cached session so next _get_scope_session opens fresh."""
    with _session_lock:
        session = _scope_sessions.pop(visa, None)
        if session is not None:
            try:
                session.close()
            except Exception:
                pass


def _open_fresh_scope_session(visa: str):
    """Open a fresh PyVISA scope session for one-off SCPI work."""
    rm = _resource_manager_instance()
    try:
        session = rm.open_resource(visa)
    except Exception:
        _reset_resource_manager()
        rm = _resource_manager_instance()
        session = rm.open_resource(visa)
    try:
        session.clear()
    except Exception:
        pass
    return session


def _close_all_sessions():
    global _resource_manager
    with _session_lock:
        for visa, session in list(_scope_sessions.items()):
            try:
                session.close()
            except Exception:
                pass
            _scope_sessions.pop(visa, None)
        for visa, session in list(_socket_sessions.items()):
            try:
                session.close()
            except Exception:
                pass
            _socket_sessions.pop(visa, None)
        if _resource_manager is not None:
            try:
                _resource_manager.close()
            except Exception:
                pass
            _resource_manager = None



def _handle_capture_screenshot(job: dict) -> dict:
    visa = job.get("visa")
    scope_type = job.get("scope_type") or "modern"
    capture_timeout_ms = _capture_timeout_ms(job)
    if not isinstance(visa, str) or not visa:
        raise RuntimeError("capture_screenshot requires visa")

    lock = _capture_lock_for(visa)
    with lock:
        now = time.time()
        recent = _recent_capture_results.get(visa)
        if recent and now - recent[0] < 0.75:
            return recent[1]
        recent_error = _recent_capture_errors.get(visa)
        if recent_error and now - recent_error[0] < 1.5:
            raise RuntimeError(recent_error[1])

        try:
            settle_delay = _recent_scpi_settle_delay(visa)
            if settle_delay > 0:
                time.sleep(settle_delay)
            # Use raw SocketInstr for SOCKET resources — pyvisa can't handle
            # binary block transfers (screenshots, curve data) over raw sockets.
            last_error = None
            for attempt in range(_CAPTURE_RETRY_COUNT):
                try:
                    if _is_socket_resource(visa):
                        if attempt > 0:
                            _reset_socket_session(visa)
                            time.sleep(0.25 * attempt)
                        try:
                            sock = _get_socket_session(visa)
                        except Exception:
                            _reset_socket_session(visa)
                            sock = _get_socket_session(visa)
                        sock.set_timeout(capture_timeout_ms / 1000.0)
                        data = sock.fetch_screen("temp_screenshot.png")
                    else:
                        try:
                            scpi = _get_scope_session(visa)
                        except Exception:
                            _reset_scope_session(visa)
                            _reset_resource_manager()
                            scpi = _get_scope_session(visa)
                        old_timeout = getattr(scpi, "timeout", capture_timeout_ms)
                        old_write_term = getattr(scpi, "write_termination", None)
                        old_read_term = getattr(scpi, "read_termination", None)
                        try:
                            scpi.timeout = capture_timeout_ms
                            scpi.write_termination = "\n"
                            scpi.read_termination = None

                            if scope_type == "legacy":
                                # DPO 5k/7k series - HARDCOPY method
                                temp_path = 'C:/Temp/screenshot.png'
                                scpi.write('HARDCOPY:PORT FILE')
                                scpi.write(f'HARDCOPY:FILENAME "{temp_path}"')
                                scpi.write('HARDCOPY START')
                                scpi.write('*WAI')
                                scpi.write(f'FILESYSTEM:READFILE "{temp_path}"')
                                data = _readfile_payload_via_visa_stream(scpi)
                                scpi.write(f'FILESYSTEM:DELETE "{temp_path}"')
                                scpi.write('*WAI')
                            elif scope_type == "export":
                                # MSO/DPO 70000 series - EXPort method
                                import time as _time
                                remote_path = 'C:/TekScope/screenshot.png'
                                scpi.write(f'EXPort:FILEName "{remote_path}"')
                                scpi.write('EXPort:FORMat PNG')
                                scpi.write('EXPort:VIEW FULLSCREEN')
                                scpi.write('EXPort:PALEtte COLOR')
                                scpi.write('EXPort START')
                                if str(scpi.query('*OPC?')).strip() != '1':
                                    raise RuntimeError("EXPort START did not complete")
                                _time.sleep(1.0)
                                old_read_timeout = scpi.timeout
                                scpi.timeout = 30000
                                scpi.write(f'FILESYSTEM:READFILE "{remote_path}"')
                                data = _readfile_payload_via_visa_stream(scpi)
                                scpi.timeout = old_read_timeout
                                scpi.write(f'FILESYSTEM:DELETE "{remote_path}"')
                            else:
                                # MSO 2/4/5/6 series - SAVE:IMAGE method (modern)
                                temp_path = 'C:/Temp_Screen.png'
                                scpi.write(f'SAVE:IMAGE "{temp_path}"')
                                if str(scpi.query('*OPC?')).strip() != '1':
                                    raise RuntimeError("SAVE:IMAGE did not complete")
                                scpi.write(f'FILESYSTEM:READFILE "{temp_path}"')
                                data = _readfile_payload_via_visa_stream(scpi)
                                scpi.write(f'FILESYSTEM:DELETE "{temp_path}"')
                                scpi.query('*OPC?')
                        finally:
                            scpi.timeout = old_timeout
                            scpi.write_termination = old_write_term
                            scpi.read_termination = old_read_term
                    break
                except Exception as exc:
                    last_error = exc
                    if _is_socket_resource(visa):
                        _reset_socket_session(visa)
                    else:
                        _reset_scope_session(visa)
                        _reset_resource_manager()
                    if attempt >= _CAPTURE_RETRY_COUNT - 1:
                        raise
            if last_error and 'data' not in locals():
                raise last_error

            import base64

            result = {
                "ok": True,
                "scopeType": scope_type,
                "mimeType": "image/png",
                "sizeBytes": len(data),
                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "base64": base64.b64encode(data).decode("ascii"),
            }
            _recent_capture_results[visa] = (time.time(), result)
            _recent_capture_errors.pop(visa, None)
            return result
        except Exception as exc:
            _recent_capture_errors[visa] = (time.time(), str(exc))
            raise


def _get_recent_capture_result(visa: str, max_age_sec: float = _BUSY_CAPTURE_CACHE_MAX_AGE_SEC) -> dict | None:
    recent = _recent_capture_results.get(visa)
    if not recent:
        return None
    timestamp, result = recent
    if time.time() - timestamp > max_age_sec:
        return None
    reused = dict(result)
    reused["cached"] = True
    reused["busySkipped"] = True
    return reused


def _handle_device_clear(job: dict) -> dict:
    visa = job.get("visa")
    if not isinstance(visa, str) or not visa:
        raise RuntimeError("device_clear requires visa")

    if _is_socket_resource(visa):
        try:
            session = _get_socket_session(visa)
        except Exception:
            _reset_socket_session(visa)
            session = _get_socket_session(visa)
        session.clear()
        transport = "socket"
    else:
        try:
            session = _get_scope_session(visa)
        except Exception:
            _reset_scope_session(visa)
            _reset_resource_manager()
            session = _get_scope_session(visa)
        session.clear()
        transport = "visa"

    return {
        "cleared": visa,
        "transport": transport,
    }


def _handle_send_scpi(job: dict) -> dict:
    visa = job.get("visa")
    commands = job.get("commands")
    timeout_ms = int(job.get("timeout_ms", 3000) or 3000)
    verbose = job.get("verbose", False)
    if not isinstance(visa, str) or not visa:
        raise RuntimeError("send_scpi requires visa")
    if not isinstance(commands, list) or not all(isinstance(cmd, str) for cmd in commands):
        raise RuntimeError("send_scpi requires string commands")

    use_socket = _is_socket_resource(visa)

    scpi, close_scpi = _open_command_session(visa, timeout_ms, use_socket)

    if verbose:
        transport = "socket" if use_socket else "visa-fresh"
        _emit({"log": "scpi", "level": "info", "msg": f"[SCPI] Sending {len(commands)} command(s) to {visa} (timeout={timeout_ms}ms) [{transport}]"})

    started = time.time()
    responses = []
    session_reset = False
    had_timeout = False
    try:
        chunk_size = _SCPI_CHUNK_SIZE_SOCKET if use_socket else _SCPI_CHUNK_SIZE_VISA
        for index, cmd in enumerate(commands):
            if index > 0 and index % chunk_size == 0:
                time.sleep(_SCPI_CHUNK_PAUSE_SEC if use_socket else _SCPI_CHUNK_PAUSE_SEC / 2)
            cmd_started = time.time()
            ok = True
            error = None
            response = "OK"
            raw_result = None
            command_timeout_ms = _command_timeout_ms(cmd, timeout_ms)
            _set_session_timeout(scpi, command_timeout_ms, use_socket)

            if verbose:
                _emit({"log": "scpi", "level": "send", "msg": f"[SCPI TX] {cmd}"})

            try:
                if _requires_raw_read(cmd):
                    if use_socket:
                        remote_file = cmd.strip().lstrip(":")[len("FILESYSTEM:READFILE"):].strip()
                        remote_file = remote_file.lstrip("?").strip()
                        remote_file = remote_file.strip('"').strip("'")
                        raw_result = _raw_payload_to_result(scpi.read_file(remote_file))
                    else:
                        scpi.write(cmd)
                        raw_result = _raw_payload_to_result(_readfile_payload_via_visa_stream(scpi))
                    response = raw_result.pop("response", "")
                elif cmd.strip().endswith("?"):
                    response = str(scpi.query(cmd)).strip()
                else:
                    scpi.write(cmd)
            except Exception as exc:
                had_timeout = had_timeout or ('timed out' in str(exc).lower() or 'timeout' in str(exc).lower())
                if not session_reset:
                    session_reset = True
                    try:
                        if use_socket:
                            _reset_socket_session(visa)
                            scpi, close_scpi = _open_command_session(visa, command_timeout_ms, True)
                        else:
                            try:
                                scpi.close()
                            except Exception:
                                pass
                            _reset_resource_manager()
                            scpi, close_scpi = _open_command_session(visa, command_timeout_ms, False)
                        if _requires_raw_read(cmd):
                            if use_socket:
                                remote_file = cmd.strip().lstrip(":")[len("FILESYSTEM:READFILE"):].strip()
                                remote_file = remote_file.lstrip("?").strip()
                                remote_file = remote_file.strip('"').strip("'")
                                raw_result = _raw_payload_to_result(scpi.read_file(remote_file))
                            else:
                                scpi.write(cmd)
                                raw_result = _raw_payload_to_result(_readfile_payload_via_visa_stream(scpi))
                            response = raw_result.pop("response", "")
                        elif cmd.strip().endswith("?"):
                            response = str(scpi.query(cmd)).strip()
                        else:
                            scpi.write(cmd)
                    except Exception as retry_exc:
                        had_timeout = had_timeout or ('timed out' in str(retry_exc).lower() or 'timeout' in str(retry_exc).lower())
                        ok = False
                        response = ""
                        error = f"Retry failed: {retry_exc}"
                else:
                    ok = False
                    response = ""
                    error = str(exc)
            elapsed_ms = round((time.time() - cmd_started) * 1000, 1)
            settle_seconds = _command_settle_seconds(cmd)
            if settle_seconds > 0:
                time.sleep(settle_seconds)

            if verbose:
                if ok:
                    _emit({"log": "scpi", "level": "recv", "msg": f"[SCPI RX] {cmd} -> {response} ({elapsed_ms}ms)"})
                else:
                    _emit({"log": "scpi", "level": "error", "msg": f"[SCPI ERR] {cmd} -> {error} ({elapsed_ms}ms)"})

            response_item = {
                "command": cmd,
                "response": response,
                "ok": ok,
                "error": error,
                "timeMs": elapsed_ms,
            }
            if ok and raw_result:
                response_item.update(raw_result)
            responses.append(response_item)
    finally:
        if close_scpi:
            try:
                scpi.close()
            except Exception:
                pass

    total_ms = round((time.time() - started) * 1000, 1)

    if verbose:
        ok_count = sum(1 for r in responses if r["ok"])
        _emit({"log": "scpi", "level": "info", "msg": f"[SCPI] Done: {ok_count}/{len(responses)} OK in {total_ms}ms"})
    _record_scpi_activity(
        visa,
        command_count=len(commands),
        total_ms=total_ms,
        had_timeout=had_timeout,
        used_socket=use_socket,
    )

    return {
        "ok": all(item["ok"] for item in responses),
        "responses": responses,
        "totalTimeMs": total_ms,
    }

def _run_python_job(job_id: str, code: str, visa: str | None):
    ns: dict = {"__name__": "__main__"}
    if visa:
        ns["_SCOPE_VISA"] = visa
    result_holder = {"data": None}

    def _teka_set_result(data):
        result_holder["data"] = data

    ns["teka_set_result"] = _teka_set_result

    class _StreamCapture(io.TextIOBase):
        def __init__(self, stream_name: str):
            super().__init__()
            self._name = stream_name
            self._buf = ""

        def write(self, data: str) -> int:
            self._buf += data
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                _emit({"id": job_id, "stream": self._name, "line": line})
            return len(data)

        def flush(self):
            if self._buf:
                _emit({"id": job_id, "stream": self._name, "line": self._buf})
                self._buf = ""

    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = _StreamCapture("stdout")
    sys.stderr = _StreamCapture("stderr")

    ok = False
    error = None
    try:
        exec(compile(code, "<flow>", "exec"), ns)  # noqa: S102
        ok = True
    except SystemExit as exc:
        ok = exc.code == 0 or exc.code is None
        if not ok:
            error = f"SystemExit({exc.code})"
    except Exception:
        error = traceback.format_exc()
        sys.stderr.write(error)
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        sys.stdout = old_out
        sys.stderr = old_err

    _emit(
        {
            "id": job_id,
            "done": True,
            "ok": ok,
            "exit_code": 0 if ok else 1,
            "error": error,
            "result_data": result_holder["data"],
        }
    )


def _run_job(job: dict):
    job_id = job.get("id", "?")
    action = job.get("action", "run_python")
    code = job.get("code", "")
    visa = job.get("visa")
    keep_alive = bool(job.get("keep_alive", False))

    try:
        if action == "disconnect":
            if visa:
                if _is_socket_resource(visa):
                    _reset_socket_session(visa)
                else:
                    _reset_scope_session(visa)
            _emit({"id": job_id, "done": True, "ok": True, "exit_code": 0, "error": None, "result_data": {"disconnected": visa}})
            return
        if action == "capture_screenshot":
            lock = _visa_lock_for(visa)
            if not lock.acquire(blocking=False):
                cached = _get_recent_capture_result(visa)
                if cached is not None:
                    _emit({"id": job_id, "done": True, "ok": True, "exit_code": 0, "error": None, "result_data": cached})
                    return
                _emit(
                    {
                        "id": job_id,
                        "done": True,
                        "ok": False,
                        "exit_code": 1,
                        "error": "capture_screenshot skipped because instrument is busy with another action",
                        "result_data": None,
                    }
                )
                return
            try:
                result = _handle_capture_screenshot(job)
            finally:
                lock.release()
            _emit({"id": job_id, "done": True, "ok": True, "exit_code": 0, "error": None, "result_data": result})
            if not keep_alive and visa:
                if _is_socket_resource(visa):
                    _reset_socket_session(visa)
                else:
                    _reset_scope_session(visa)
            return
        if action == "device_clear":
            with _visa_lock_for(visa):
                result = _handle_device_clear(job)
            _emit({"id": job_id, "done": True, "ok": True, "exit_code": 0, "error": None, "result_data": result})
            if not keep_alive and visa:
                if _is_socket_resource(visa):
                    _reset_socket_session(visa)
                else:
                    _reset_scope_session(visa)
            return
        if action == "send_scpi":
            # Per-VISA lock prevents race with concurrent capture_screenshot on same instrument
            with _visa_lock_for(visa):
                result = _handle_send_scpi(job)
            _emit({"id": job_id, "done": True, "ok": bool(result.get("ok", False)), "exit_code": 0, "error": None, "result_data": result})
            if not keep_alive and visa:
                if _is_socket_resource(visa):
                    _reset_socket_session(visa)
                else:
                    _reset_scope_session(visa)
            return
        _run_python_job(job_id, code, visa)
    except Exception:
        _emit(
            {
                "id": job_id,
                "done": True,
                "ok": False,
                "exit_code": 1,
                "error": traceback.format_exc(),
                "result_data": None,
            }
        )
        if visa:
            if _is_socket_resource(visa):
                _reset_socket_session(visa)
            else:
                _reset_scope_session(visa)
                _reset_resource_manager()


def main():
    _emit({"ready": True})

    if sys.stdin is None:
        _emit({"error": "Worker mode requires stdin input"})
        return

    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            job = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if job.get("ping"):
            _emit({"pong": True})
            continue
        threading.Thread(target=_run_job, args=(job,), daemon=True).start()


if __name__ == "__main__":
    try:
        main()
    finally:
        _close_all_sessions()
