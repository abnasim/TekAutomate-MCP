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

_real_stdout = sys.stdout

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
_capture_locks: dict[str, threading.Lock] = {}
_recent_capture_results: dict[str, tuple[float, dict]] = {}
_recent_capture_errors: dict[str, tuple[float, str]] = {}


def _emit(obj: dict):
    _real_stdout.write(json.dumps(obj) + "\n")
    _real_stdout.flush()


def _resource_manager_instance():
    global _resource_manager
    if _resource_manager is None:
        if pyvisa is None:
            raise RuntimeError("pyvisa is not available in worker")
        _resource_manager = pyvisa.ResourceManager()
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


def _get_scope_session(visa: str):
    with _session_lock:
        session = _scope_sessions.get(visa)
        if session is not None:
            try:
                _ = session.session
                return session
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


def _close_all_sessions():
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


def _handle_capture_screenshot(job: dict) -> dict:
    visa = job.get("visa")
    scope_type = job.get("scope_type") or "modern"
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
            try:
                scpi = _get_scope_session(visa)
            except Exception:
                _reset_scope_session(visa)
                _reset_resource_manager()
                scpi = _get_scope_session(visa)

            scpi.timeout = 30000
            scpi.write_termination = "\n"
            scpi.read_termination = None

            if scope_type == "legacy":
                scpi.write('HARDCOPY:PORT FILE')
                scpi.write('HARDCOPY:FORMAT PNG')
                scpi.write('HARDCOPY:FILENAME "C:/TekScope/Temp/screenshot.png"')
                scpi.write('HARDCOPY START')
                time.sleep(1.0)
                scpi.write('FILESYSTEM:READFILE "C:/TekScope/Temp/screenshot.png"')
                data = scpi.read_raw()
                scpi.write('FILESYSTEM:DELETE "C:/TekScope/Temp/screenshot.png"')
            else:
                scpi.write('SAVE:IMAGE "C:/Temp/screenshot.png"')
                time.sleep(1.0)
                scpi.write('FILESYSTEM:READFILE "C:/Temp/screenshot.png"')
                data = scpi.read_raw()
                scpi.write('FILESYSTEM:DELETE "C:/Temp/screenshot.png"')

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


def _handle_send_scpi(job: dict) -> dict:
    visa = job.get("visa")
    commands = job.get("commands")
    timeout_ms = int(job.get("timeout_ms", 5000) or 5000)
    verbose = job.get("verbose", False)
    if not isinstance(visa, str) or not visa:
        raise RuntimeError("send_scpi requires visa")
    if not isinstance(commands, list) or not all(isinstance(cmd, str) for cmd in commands):
        raise RuntimeError("send_scpi requires string commands")

    scpi = _get_scope_session(visa)
    scpi.timeout = timeout_ms
    scpi.write_termination = "\n"
    scpi.read_termination = "\n"

    if verbose:
        _emit({"log": "scpi", "level": "info", "msg": f"[SCPI] Sending {len(commands)} command(s) to {visa} (timeout={timeout_ms}ms)"})

    started = time.time()
    responses = []
    session_reset = False
    for cmd in commands:
        cmd_started = time.time()
        ok = True
        error = None
        response = "OK"

        if verbose:
            _emit({"log": "scpi", "level": "send", "msg": f"[SCPI TX] {cmd}"})

        try:
            if cmd.strip().endswith("?"):
                response = str(scpi.query(cmd)).strip()
            else:
                scpi.write(cmd)
        except Exception as exc:
            if not session_reset:
                session_reset = True
                try:
                    _reset_scope_session(visa)
                    _reset_resource_manager()
                    scpi = _get_scope_session(visa)
                    scpi.timeout = timeout_ms
                    scpi.write_termination = "\n"
                    scpi.read_termination = "\n"
                    if cmd.strip().endswith("?"):
                        response = str(scpi.query(cmd)).strip()
                    else:
                        scpi.write(cmd)
                except Exception as retry_exc:
                    ok = False
                    response = ""
                    error = f"Retry failed: {retry_exc}"
            else:
                ok = False
                response = ""
                error = str(exc)
        elapsed_ms = round((time.time() - cmd_started) * 1000, 1)

        if verbose:
            if ok:
                _emit({"log": "scpi", "level": "recv", "msg": f"[SCPI RX] {cmd} → {response} ({elapsed_ms}ms)"})
            else:
                _emit({"log": "scpi", "level": "error", "msg": f"[SCPI ERR] {cmd} → {error} ({elapsed_ms}ms)"})

        responses.append(
            {
                "command": cmd,
                "response": response,
                "ok": ok,
                "error": error,
                "timeMs": elapsed_ms,
            }
        )

    total_ms = round((time.time() - started) * 1000, 1)

    if verbose:
        ok_count = sum(1 for r in responses if r["ok"])
        _emit({"log": "scpi", "level": "info", "msg": f"[SCPI] Done: {ok_count}/{len(responses)} OK in {total_ms}ms"})

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
                _reset_scope_session(visa)
            _emit({"id": job_id, "done": True, "ok": True, "exit_code": 0, "error": None, "result_data": {"disconnected": visa}})
            return
        if action == "capture_screenshot":
            result = _handle_capture_screenshot(job)
            _emit({"id": job_id, "done": True, "ok": True, "exit_code": 0, "error": None, "result_data": result})
            if not keep_alive and visa:
                _reset_scope_session(visa)
            return
        if action == "send_scpi":
            result = _handle_send_scpi(job)
            _emit({"id": job_id, "done": True, "ok": bool(result.get("ok", False)), "exit_code": 0, "error": None, "result_data": result})
            if not keep_alive and visa:
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
