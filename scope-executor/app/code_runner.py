"""
Persistent-worker code runner.

Instead of spawning a fresh python.exe per request (8-12s startup per call),
we keep ONE worker process alive for the lifetime of the app. It pre-imports
pyvisa and tm_devices at startup, so every subsequent job runs in <1s.

The worker is auto-restarted if it crashes.
"""

import json
import os
import subprocess
import sys
import threading
import time
import uuid

DEFAULT_TIMEOUT = 30
TIMEOUT_TRANSCRIPT_TAIL = 20


def _find_venv_candidates() -> list[str]:
    dirs = []
    if getattr(sys, "frozen", False):
        dirs.append(os.path.dirname(os.path.abspath(sys.executable)))
        dirs.append(os.path.dirname(os.path.abspath(sys.argv[0])))
        for d in list(dirs):
            dirs.append(os.path.dirname(d))
    else:
        dirs.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    dirs.append(os.path.abspath(os.getcwd()))
    seen: set[str] = set()
    result = []
    for d in dirs:
        if d not in seen:
            seen.add(d)
            result.append(d)
    return result


def find_venv_python() -> str | None:
    for base in _find_venv_candidates():
        path = os.path.join(base, ".venv", "Scripts", "python.exe")
        if os.path.isfile(path):
            return path
    return None


def _worker_script_path() -> str:
    """Path to app/worker.py, works both frozen and from source."""
    if getattr(sys, "frozen", False):
        return os.path.join(sys._MEIPASS, "app", "worker.py")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.py")


def _build_worker_cmd() -> list[str] | None:
    """
    Build the command to launch the worker process.
    - Frozen EXE: re-launch ourselves with --worker (all deps are bundled)
    - Source mode: use .venv/Scripts/python.exe + worker.py
    """
    if getattr(sys, "frozen", False):
        return [sys.executable, "--worker"]

    venv_py = find_venv_python()
    if not venv_py:
        return None
    return [venv_py, "-u", _worker_script_path()]


def _transcript_payload(lines: list[tuple[str, str, float]]) -> list[dict[str, object]]:
    return [
        {"stream": stream, "line": line, "timestamp": ts}
        for stream, line, ts in lines
    ]


def _combined_output_from_lines(lines: list[tuple[str, str, float]]) -> str:
    return "\n".join(f"[{stream}] {line}" for stream, line, _ts in lines)


class _WorkerProcess:
    """Manages a single long-lived worker subprocess."""

    def __init__(self):
        self._lock = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._ready = threading.Event()
        self._pending: dict[str, dict] = {}
        self._reader_thread: threading.Thread | None = None

    def _start(self) -> bool:
        cmd = _build_worker_cmd()
        if not cmd:
            return False
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            self._ready.clear()
            self._reader_thread = threading.Thread(target=self._read_loop, daemon=True)
            self._reader_thread.start()
            return self._ready.wait(timeout=15)
        except Exception:
            return False

    def _read_loop(self):
        proc = self._proc
        try:
            for raw in proc.stdout:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if msg.get("ready"):
                    self._ready.set()
                    continue

                job_id = msg.get("id")
                if not job_id or job_id not in self._pending:
                    continue

                entry = self._pending[job_id]
                if "stream" in msg:
                    entry["lines"].append((msg["stream"], msg["line"], time.time()))
                    cb = entry.get("on_line")
                    if cb:
                        cb(msg["stream"], msg["line"])
                elif msg.get("done"):
                    entry["result"] = msg
                    entry["event"].set()
        except Exception:
            pass
        finally:
            self._ready.clear()
            for entry in list(self._pending.values()):
                if not entry["event"].is_set():
                    entry["result"] = {
                        "done": True,
                        "ok": False,
                        "exit_code": -1,
                        "error": "Worker process died unexpectedly",
                    }
                    entry["event"].set()

    def ensure_running(self) -> bool:
        with self._lock:
            if self._proc and self._proc.poll() is None:
                return True
            return self._start()

    def run_job(
        self,
        code: str,
        timeout_sec: int = DEFAULT_TIMEOUT,
        visa: str | None = None,
        on_line=None,
        action: str = "run_python",
        extra_payload: dict | None = None,
    ) -> dict:
        if not self.ensure_running():
            if getattr(sys, "frozen", False):
                stderr_text = f"Could not launch: {sys.executable} --worker"
                return {
                    "ok": False,
                    "error": "Worker process failed to start.",
                    "stdout": "",
                    "stderr": stderr_text,
                    "combined_output": f"[stderr] {stderr_text}",
                    "transcript": [{"stream": "stderr", "line": stderr_text, "timestamp": time.time()}],
                    "exit_code": -1,
                }

            tried = [os.path.join(d, ".venv", "Scripts", "python.exe") for d in _find_venv_candidates()]
            stderr_text = "Searched:\n" + "\n".join(f"  {path}" for path in tried)
            return {
                "ok": False,
                "error": "No .venv found. Run run.bat first.",
                "stdout": "",
                "stderr": stderr_text,
                "combined_output": f"[stderr] {stderr_text}",
                "transcript": [{"stream": "stderr", "line": stderr_text, "timestamp": time.time()}],
                "exit_code": -1,
            }

        job_id = str(uuid.uuid4())
        event = threading.Event()
        entry = {"event": event, "lines": [], "result": None, "on_line": on_line}
        self._pending[job_id] = entry

        job = {"id": job_id, "action": action, "code": code}
        if visa:
            job["visa"] = visa
        if extra_payload:
            job.update(extra_payload)

        try:
            self._proc.stdin.write(json.dumps(job) + "\n")
            self._proc.stdin.flush()
        except Exception as exc:
            del self._pending[job_id]
            error_text = str(exc)
            return {
                "ok": False,
                "error": error_text,
                "stdout": "",
                "stderr": "",
                "combined_output": f"[error] {error_text}",
                "transcript": [{"stream": "error", "line": error_text, "timestamp": time.time()}],
                "exit_code": -1,
            }

        fired = event.wait(timeout=timeout_sec)
        del self._pending[job_id]

        if not fired:
            transcript = _transcript_payload(entry["lines"])
            stdout = "\n".join(item["line"] for item in transcript if item["stream"] == "stdout")
            stderr_lines = [item["line"] for item in transcript if item["stream"] == "stderr"]
            stderr = "\n".join(stderr_lines)
            tail_lines = transcript[-TIMEOUT_TRANSCRIPT_TAIL:]
            tail_text = "\n".join(f"[{item['stream']}] {item['line']}" for item in tail_lines)
            error_text = f"Timeout after {timeout_sec}s - script did not complete"
            if tail_text:
                error_text += f"\nRecent output before timeout:\n{tail_text}"
            return {
                "ok": False,
                "error": error_text,
                "stdout": stdout,
                "stderr": stderr,
                "combined_output": _combined_output_from_lines(entry["lines"]) or f"[error] {error_text}",
                "transcript": transcript + [{"stream": "error", "line": error_text, "timestamp": time.time()}],
                "exit_code": -1,
            }

        result = entry["result"] or {}
        transcript = _transcript_payload(entry["lines"])
        stdout = "\n".join(item["line"] for item in transcript if item["stream"] == "stdout")
        stderr = "\n".join(item["line"] for item in transcript if item["stream"] == "stderr")
        error_text = result.get("error")
        if error_text and not any(item["stream"] == "error" for item in transcript):
            transcript.append({"stream": "error", "line": str(error_text), "timestamp": time.time()})
        combined_output = _combined_output_from_lines(entry["lines"])
        return {
            "ok": result.get("ok", False),
            "stdout": stdout,
            "stderr": stderr,
            "error": error_text,
            "combined_output": combined_output,
            "transcript": transcript,
            "exit_code": result.get("exit_code", -1),
            "result_data": result.get("result_data"),
        }

    def stop(self):
        with self._lock:
            if self._proc:
                try:
                    self._proc.stdin.close()
                    self._proc.terminate()
                except Exception:
                    pass
                self._proc = None


_worker = _WorkerProcess()


def run_python_code(
    code: str,
    timeout_sec: int = DEFAULT_TIMEOUT,
    scope_visa: str | None = None,
    on_line=None,
) -> dict:
    return _worker.run_job(code, timeout_sec, scope_visa, on_line)


def run_executor_action(
    action: str,
    payload: dict,
    timeout_sec: int = DEFAULT_TIMEOUT,
    scope_visa: str | None = None,
    on_line=None,
) -> dict:
    return _worker.run_job("", timeout_sec, scope_visa, on_line, action=action, extra_payload=payload)


def is_busy() -> bool:
    return bool(_worker._pending)


def shutdown_worker():
    _worker.stop()
