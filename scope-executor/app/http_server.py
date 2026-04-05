"""
HTTP server for the Tek Automate executor.

Endpoints:
- GET /health
- GET /stream
- GET /scan
- GET /vnc/probe
- GET /vnc/status
- POST /run
- POST /vnc/start
- POST /vnc/stop
"""

import json
import queue
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

from app.code_runner import run_executor_action, run_python_code
from app.live_token_manager import LiveTokenManager
from app.tk_utils import TkSignal
from app.vnc_proxy import VncProxyManager

PROTOCOL_VERSION = 1
_HIDDEN_STREAM_PREFIXES = ("__TEKA_LIVE_CAPTURE__", "__TEKA_CAPTURE__")
_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()


def _sse_subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue()
    with _sse_lock:
        _sse_clients.append(q)
    return q


def _sse_unsubscribe(q: queue.Queue):
    with _sse_lock:
        try:
            _sse_clients.remove(q)
        except ValueError:
            pass


def _sse_broadcast(event: str, data: str):
    msg = f"event: {event}\ndata: {data}\n\n"
    with _sse_lock:
        dead = []
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_clients.remove(q)


class _QuickHTTPServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()

    def get_request(self):
        conn, addr = super().get_request()
        try:
            conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass
        return conn, addr


class _Handler(BaseHTTPRequestHandler):
    server_thread: "HTTPServerThread | None" = None
    protocol_version = "HTTP/1.1"

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _client_ip(self) -> str:
        return self.client_address[0] if self.client_address else ""

    def _is_local_request(self) -> bool:
        ip = self._client_ip()
        return ip in {"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"}

    def _require_localhost(self) -> bool:
        if self._is_local_request():
            return True
        self._json_response(403, {"ok": False, "error": "Token management is only available from the local executor UI host."})
        self._emit("AUTH", self.path, 403, "token route requires localhost")
        return False

    def _json_response(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        self.close_connection = True

    def _parse_int_param(self, raw_value, *, default: int, name: str) -> int:
        if raw_value is None:
            return int(default)
        text = str(raw_value).strip()
        if not text:
            return int(default)
        try:
            return int(text)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid {name}: {text}") from exc

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path in ("/", "/health"):
            self._json_response(200, {"status": "ok", "protocol_version": PROTOCOL_VERSION})
            self._emit("GET", path, 200, "health check")
            return
        if path == "/token/status":
            if not self._require_localhost():
                return
            self._json_response(200, {"ok": True, **(self.server_thread.get_live_token_status() if self.server_thread else {})})
            self._emit("GET", "/token/status", 200, "token status")
            return
        if path == "/stream":
            self._handle_sse()
            return
        if path == "/scan":
            self._handle_scan()
            return
        if path == "/vnc/probe":
            target_host = (query.get("target_host") or [""])[0]
            try:
                target_port = self._parse_int_param((query.get("target_port") or ["5900"])[0], default=5900, name="target_port")
                result = self.server_thread.vnc_probe(target_host, target_port) if self.server_thread else {"ok": False, "error": "Server unavailable"}
                code = 200 if result.get("ok") else 400
                self._json_response(code, result)
                self._emit("GET", "/vnc/probe", code, f"target={target_host}:{target_port} available={result.get('available')}")
            except ValueError as exc:
                self._json_response(400, {"ok": False, "error": str(exc)})
                self._emit("GET", "/vnc/probe", 400, str(exc))
            except Exception as exc:
                self._json_response(500, {"ok": False, "error": str(exc)})
                self._emit("GET", "/vnc/probe", 500, str(exc))
            return
        if path == "/vnc/status":
            target_host = (query.get("target_host") or [""])[0] or None
            try:
                target_port = self._parse_int_param((query.get("target_port") or ["5900"])[0], default=5900, name="target_port")
                result = self.server_thread.vnc_status(target_host, target_port) if self.server_thread else {"ok": False, "error": "Server unavailable"}
                code = 200 if result.get("ok") else 400
                self._json_response(code, result)
                self._emit("GET", "/vnc/status", code, f"target={target_host or '*'}:{target_port} running={result.get('running')}")
            except ValueError as exc:
                self._json_response(400, {"ok": False, "error": str(exc)})
                self._emit("GET", "/vnc/status", 400, str(exc))
            except Exception as exc:
                self._json_response(500, {"ok": False, "error": str(exc)})
                self._emit("GET", "/vnc/status", 500, str(exc))
            return
        self.send_response(404)
        self.end_headers()

    def _handle_scan(self):
        """Scan for VISA instruments and return results as JSON."""
        self._emit("GET", "/scan", 200, "Scanning for VISA instruments...")
        try:
            from app.instrument_scanner import InstrumentScanThread, InstrumentInfo
            instruments: list[dict] = []
            scan_done = threading.Event()
            scan_error_msg = [None]

            scanner = InstrumentScanThread(query_idn=True, timeout_ms=3000)
            scanner.instrument_found.connect(lambda info: instruments.append({
                "resource": info.resource,
                "identity": info.identity,
                "manufacturer": info.manufacturer,
                "model": info.model,
                "serial": info.serial,
                "firmware": info.firmware,
                "reachable": info.reachable,
                "connType": info.conn_type,
            }))
            scanner.scan_error.connect(lambda err: scan_error_msg.__setitem__(0, err))
            scanner.scan_finished.connect(lambda _count: scan_done.set())
            scanner.start()
            scan_done.wait(timeout=30)

            if scan_error_msg[0]:
                self._json_response(200, {"ok": False, "error": scan_error_msg[0], "instruments": []})
                self._emit("GET", "/scan", 200, f"Scan error: {scan_error_msg[0]}")
            else:
                self._json_response(200, {"ok": True, "instruments": instruments, "count": len(instruments)})
                self._emit("GET", "/scan", 200, f"Scan complete: {len(instruments)} instrument(s) found")
        except Exception as exc:
            self._json_response(500, {"ok": False, "error": str(exc), "instruments": []})
            self._emit("GET", "/scan", 500, f"Scan failed: {exc}")

    def _handle_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self._cors_headers()
        self.end_headers()

        try:
            self.wfile.write(b"event: connected\ndata: {}\n\n")
            self.wfile.flush()
        except Exception:
            return

        q = _sse_subscribe()
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(msg.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    try:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                    except Exception:
                        break
                except Exception:
                    break
        finally:
            _sse_unsubscribe(q)

    def do_POST(self):
        t0 = time.time()
        if self.path == "/token/generate":
            self._handle_token_generate()
            return
        if self.path == "/token/revoke":
            self._handle_token_revoke()
            return
        if self.path == "/vnc/start":
            self._handle_vnc_start()
            return
        if self.path == "/vnc/stop":
            self._handle_vnc_stop()
            return
        if self.path != "/run":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0 or content_length > 10 * 1024 * 1024:
            self._json_response(400, {"ok": False, "error": "Invalid Content-Length"})
            self._emit("POST", "/run", 400, "bad content-length")
            return

        body = self.rfile.read(content_length)
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._json_response(400, {"ok": False, "error": "Invalid JSON"})
            self._emit("POST", "/run", 400, "invalid JSON")
            return

        action = data.get("action")
        action_label = str(action or "unknown")
        if data.get("protocol_version") != PROTOCOL_VERSION or action not in {"run_python", "capture_screenshot", "send_scpi", "disconnect", "device_clear"}:
            self._json_response(400, {"ok": False, "error": "Bad request"})
            self._emit("POST", "/run", 400, f"bad protocol action={action_label}")
            return

        srv = self.server_thread
        timeout_sec = min(int(data.get("timeout_sec", 30) or 30), 3600)
        ui_timeout = srv.get_timeout() if srv else 30
        timeout_sec = min(timeout_sec, ui_timeout)
        scope_visa = data.get("scope_visa") if isinstance(data.get("scope_visa"), str) else None
        # scope_visa is required for send_scpi, capture_screenshot, disconnect
        # but NOT for run_python (which handles its own connection in generated code)
        if not scope_visa and action in {"send_scpi", "capture_screenshot", "disconnect", "device_clear"}:
            self._json_response(400, {"ok": False, "error": "Missing scope_visa"})
            self._emit("POST", "/run", 400, f"missing scope_visa action={action_label}")
            return

        code = ""
        scope_type = "modern"
        commands = None
        timeout_ms = 3000

        if action == "run_python":
            code = data.get("code")
            if not code or not isinstance(code, str):
                self._json_response(400, {"ok": False, "error": "Missing or invalid code"})
                self._emit("POST", "/run", 400, "missing code action=run_python")
                return
        elif action == "capture_screenshot":
            scope_type = data.get("scope_type") if isinstance(data.get("scope_type"), str) else "modern"
            if scope_type not in {"modern", "legacy", "export"}:
                scope_type = "modern"
        elif action == "send_scpi":
            commands = data.get("commands")
            timeout_ms = int(data.get("timeout_ms", 3000) or 3000)
            if not isinstance(commands, list) or not commands or not all(isinstance(cmd, str) for cmd in commands):
                self._json_response(400, {"ok": False, "error": "Missing or invalid commands"})
                self._emit("POST", "/run", 400, f"missing commands action={action_label} payload_keys={','.join(sorted(data.keys()))}")
                return
            if len(commands) > 50:
                self._json_response(400, {"ok": False, "error": "Maximum 50 commands per request"})
                self._emit("POST", "/run", 400, f"too many commands action={action_label} count={len(commands)}")
                return
            # Job-level timeout: enough for all commands at their per-command timeout, plus buffer
            min_needed = max(int((timeout_ms / 1000.0) * len(commands)) + 5, 10)
            timeout_sec = min(max(timeout_sec, min_needed), ui_timeout)
            # Verbose mode: log request details
            output_mode = data.get("outputMode") or data.get("output_mode") or "clean"
            if output_mode == "verbose":
                cmd_preview = "; ".join(commands[:5])
                if len(commands) > 5:
                    cmd_preview += f" ... (+{len(commands) - 5} more)"
                self._emit("POST", "/run", 0, f"\033[34m[REQ]\033[0m send_scpi visa={scope_visa} cmds={len(commands)} timeout={timeout_ms}ms [{cmd_preview}]")
        # disconnect/device_clear: no commands needed, just scope_visa (already validated above)

        self._emit_status("busy")
        _sse_broadcast("status", json.dumps({"status": "running"}))

        result = {"ok": False, "error": "Internal error", "stdout": "", "stderr": "", "exit_code": -1}
        try:
            def _on_line(stream: str, line: str):
                if isinstance(line, str) and line.startswith(_HIDDEN_STREAM_PREFIXES):
                    return
                _sse_broadcast("line", json.dumps({"stream": stream, "line": line}))
                if srv:
                    srv.script_line.emit(stream, line)

            keep_alive = bool(data.get("keep_alive", False) or data.get("liveMode", False))

            if action == "disconnect":
                result = run_executor_action("disconnect", {}, timeout_sec, scope_visa, on_line=_on_line)
            elif action == "device_clear":
                result = run_executor_action("device_clear", {"keep_alive": keep_alive}, timeout_sec, scope_visa, on_line=_on_line)
            elif action == "run_python":
                result = run_python_code(code, timeout_sec, scope_visa, on_line=_on_line)
            elif action == "capture_screenshot":
                result = run_executor_action("capture_screenshot", {"scope_type": scope_type, "keep_alive": keep_alive}, timeout_sec, scope_visa, on_line=_on_line)
            else:
                verbose = (data.get("outputMode") or data.get("output_mode") or "clean") == "verbose"
                result = run_executor_action("send_scpi", {"commands": commands, "timeout_ms": timeout_ms, "keep_alive": keep_alive, "verbose": verbose}, timeout_sec, scope_visa, on_line=_on_line)
                if not isinstance(result, dict):
                    result = {
                        "ok": False,
                        "error": f"Executor returned invalid send_scpi result: {type(result).__name__}",
                        "stdout": "",
                        "stderr": "",
                        "exit_code": -1,
                        "result_data": {},
                    }
                # Broadcast per-command results with color-coded verbose logging
                result_data = result.get("result_data")
                if not isinstance(result_data, dict):
                    result_data = {}
                scpi_responses = result.get("responses") or result_data.get("responses") or []
                for item in scpi_responses:
                    cmd = item.get("command", "")
                    resp = item.get("response", "")
                    ok = item.get("ok", True)
                    ms = item.get("timeMs", 0)
                    if cmd.strip().endswith("?"):
                        line = f"\033[32m  → {cmd}\033[0m  =  \033[33m{resp}\033[0m  ({ms}ms)"
                    else:
                        if ok:
                            line = f"\033[32m  → {cmd}\033[0m  [OK]  ({ms}ms)"
                        else:
                            line = f"\033[31m  → {cmd}  [ERR: {item.get('error', '?')}]\033[0m  ({ms}ms)"
                    _on_line("stdout", line)

            elapsed = time.time() - t0
            response_body = {
                **result,
                "action": action,
                "duration_sec": round(elapsed, 3),
                "protocol_version": PROTOCOL_VERSION,
                "scope_visa": scope_visa,
            }
            if action in {"capture_screenshot", "send_scpi"}:
                payload = result.get("result_data")
                if isinstance(payload, dict):
                    response_body.update(payload)
            self._json_response(
                200,
                response_body,
            )

            if result.get("ok"):
                if action == "send_scpi":
                    cmd_count = len(commands or [])
                    self._emit("POST", "/run", 200, f"OK ({elapsed:.1f}s) action=send_scpi visa={scope_visa} cmds={cmd_count}")
                elif action == "capture_screenshot":
                    size_bytes = None
                    result_data = result.get("result_data")
                    if isinstance(result_data, dict):
                        size_bytes = result_data.get("sizeBytes")
                    size_text = f" size={size_bytes}B" if isinstance(size_bytes, int) else ""
                    self._emit("POST", "/run", 200, f"OK ({elapsed:.1f}s) action=capture_screenshot visa={scope_visa} scope={scope_type}{size_text}")
                elif action == "disconnect":
                    self._emit("POST", "/run", 200, f"OK ({elapsed:.1f}s) action=disconnect visa={scope_visa}")
                elif action == "device_clear":
                    self._emit("POST", "/run", 200, f"OK ({elapsed:.1f}s) action=device_clear visa={scope_visa}")
                else:
                    self._emit("POST", "/run", 200, f"OK ({elapsed:.1f}s) action=run_python visa={scope_visa or '-'}")
            else:
                err_msg = result.get("error") or "unknown error"
                stderr_full = (result.get("stderr") or "").strip()
                if action == "send_scpi":
                    preview = "; ".join((commands or [])[:2])
                    self._emit("POST", "/run", 200, f"ERROR: {err_msg} action=send_scpi visa={scope_visa} [{preview}]")
                elif action == "capture_screenshot":
                    self._emit("POST", "/run", 200, f"ERROR: {err_msg} action=capture_screenshot visa={scope_visa} scope={scope_type}")
                else:
                    self._emit("POST", "/run", 200, f"ERROR: {err_msg} action={action_label} visa={scope_visa or '-'}")
                if stderr_full and srv:
                    for line in stderr_full.splitlines():
                        srv.script_line.emit("stderr", line)
        except Exception as exc:
            exc_str = str(exc)
            if "10053" not in exc_str and "10054" not in exc_str and "Broken pipe" not in exc_str:
                try:
                    self._json_response(500, {"ok": False, "error": exc_str, "stdout": "", "stderr": "", "exit_code": -1})
                except Exception:
                    pass
                elapsed = time.time() - t0
                self._emit("POST", "/run", 500, f"EXCEPTION: {exc} ({elapsed:.1f}s)")
        finally:
            _sse_broadcast("status", json.dumps({"status": "ready"}))
            self._emit_status("ready")

    def _emit(self, method: str, path: str, status: int, detail: str):
        if self.server_thread:
            self.server_thread.request_logged.emit(method, path, status, detail)
            client_ip = self.client_address[0] if self.client_address else ""
            if client_ip:
                self.server_thread.client_seen.emit(client_ip)

    def _emit_status(self, status: str):
        if self.server_thread:
            self.server_thread.server_status_changed.emit(status)

    def log_message(self, *args):
        pass

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0 or content_length > 1024 * 1024:
            raise ValueError("Invalid Content-Length")
        body = self.rfile.read(content_length)
        return json.loads(body.decode("utf-8"))

    def _handle_token_generate(self):
        if not self._require_localhost():
            return
        try:
            data = self._read_json_body()
        except ValueError as exc:
            self._json_response(400, {"ok": False, "error": str(exc)})
            self._emit("POST", "/token/generate", 400, str(exc))
            return
        except json.JSONDecodeError:
            self._json_response(400, {"ok": False, "error": "Invalid JSON"})
            self._emit("POST", "/token/generate", 400, "invalid JSON")
            return
        duration_minutes = data.get("durationMinutes", 30)
        try:
            token, status = self.server_thread.generate_live_token(int(duration_minutes))
        except Exception as exc:
            self._json_response(500, {"ok": False, "error": str(exc)})
            self._emit("POST", "/token/generate", 500, str(exc))
            return
        self._json_response(200, {"ok": True, "token": token, **status})
        self._emit("POST", "/token/generate", 200, f"generated live token ({status.get('durationMinutes')} min)")

    def _handle_token_revoke(self):
        if not self._require_localhost():
            return
        status = self.server_thread.revoke_live_token() if self.server_thread else {}
        self._json_response(200, {"ok": True, **status})
        self._emit("POST", "/token/revoke", 200, "revoked live token")

    def _handle_vnc_start(self):
        try:
            data = self._read_json_body()
        except ValueError as exc:
            self._json_response(400, {"ok": False, "error": str(exc)})
            self._emit("POST", "/vnc/start", 400, str(exc))
            return
        except json.JSONDecodeError:
            self._json_response(400, {"ok": False, "error": "Invalid JSON"})
            self._emit("POST", "/vnc/start", 400, "invalid JSON")
            return
        target_host = str(data.get("target_host") or "").strip()
        try:
            target_port = self._parse_int_param(data.get("target_port"), default=5900, name="target_port")
            listen_port = self._parse_int_param(data.get("listen_port"), default=6080, name="listen_port")
            result = self.server_thread.vnc_start(target_host, target_port, listen_port) if self.server_thread else {"ok": False, "error": "Server unavailable"}
            code = 200 if result.get("ok") else 400
            self._json_response(code, result)
            self._emit("POST", "/vnc/start", code, f"target={target_host}:{target_port} ws={result.get('ws_url') or '-'}")
        except ValueError as exc:
            self._json_response(400, {"ok": False, "error": str(exc)})
            self._emit("POST", "/vnc/start", 400, str(exc))
        except Exception as exc:
            self._json_response(500, {"ok": False, "error": str(exc)})
            self._emit("POST", "/vnc/start", 500, str(exc))

    def _handle_vnc_stop(self):
        session_id = None
        force = False
        try:
            if int(self.headers.get("Content-Length", "0") or "0") > 0:
                data = self._read_json_body()
                session_id = data.get("session_id")
                force = bool(data.get("force"))
        except ValueError as exc:
            self._json_response(400, {"ok": False, "error": str(exc)})
            self._emit("POST", "/vnc/stop", 400, str(exc))
            return
        except json.JSONDecodeError:
            self._json_response(400, {"ok": False, "error": "Invalid JSON"})
            self._emit("POST", "/vnc/stop", 400, "invalid JSON")
            return
        result = self.server_thread.vnc_stop(session_id, force=force) if self.server_thread else {"ok": False, "error": "Server unavailable"}
        code = 200 if result.get("ok") else 400
        self._json_response(code, result)
        self._emit("POST", "/vnc/stop", code, f"stopped={result.get('stopped')} force={force} ignored={result.get('ignored')}")


class HTTPServerThread(threading.Thread):
    def __init__(self, host: str, port: int):
        super().__init__(daemon=True)
        self._host = host
        self._port = port
        self._server: HTTPServer | None = None
        self._prepare_error: str | None = None
        self.get_timeout = lambda: 30
        self._live_token_manager = LiveTokenManager()
        self._vnc_proxy_manager = VncProxyManager(
            listen_host="127.0.0.1",
            bind_host="0.0.0.0",
            live_token_status_provider=self.get_live_token_status,
            log_callback=lambda message: self.request_logged.emit("VNC", "/vnc/bridge", 200, message),
        )

        self.server_started = TkSignal()
        self.server_error = TkSignal()
        self.server_status_changed = TkSignal()
        self.request_logged = TkSignal()
        self.client_seen = TkSignal()
        self.script_line = TkSignal()
        self.live_token_changed = TkSignal()

    def prepare(self) -> bool:
        if self._server is not None:
            return True
        try:
            _Handler.server_thread = self
            self._server = _QuickHTTPServer(("0.0.0.0", self._port), _Handler)
            self._prepare_error = None
            return True
        except Exception as exc:
            self._prepare_error = str(exc)
            self._server = None
            return False

    def run(self):
        try:
            if self._server is None and not self.prepare():
                raise RuntimeError(self._prepare_error or "Failed to prepare HTTP server")
            self.server_started.emit(self._host, self._port)
            self.server_status_changed.emit("ready")
            self._server.serve_forever()
        except Exception as exc:
            self.server_error.emit(str(exc))
            self.server_status_changed.emit("error")

    def stop(self):
        self._vnc_proxy_manager.shutdown()
        if self._server:
            try:
                self._server.shutdown()
            except Exception:
                pass
            try:
                self._server.server_close()
            except Exception:
                pass
        if self.is_alive():
            try:
                self.join(timeout=2.0)
            except Exception:
                pass

    def get_live_token_status(self):
        return self._live_token_manager.status()

    def generate_live_token(self, duration_minutes: int):
        token, status = self._live_token_manager.generate(duration_minutes)
        self.live_token_changed.emit(status)
        return token, status

    def revoke_live_token(self):
        status = self._live_token_manager.revoke()
        self.live_token_changed.emit(status)
        return status

    def validate_live_token(self, token: str | None):
        return self._live_token_manager.validate(token)

    def vnc_probe(self, target_host: str, target_port: int = 5900):
        return self._vnc_proxy_manager.probe(target_host, target_port)

    def vnc_test_target(self, target_host: str, target_port: int = 5900):
        return self._vnc_proxy_manager.test_target(target_host, target_port)

    def vnc_start(self, target_host: str, target_port: int = 5900, listen_port: int = 6080):
        return self._vnc_proxy_manager.start(target_host, target_port, listen_port)

    def vnc_stop(self, session_id: str | None = None, force: bool = False):
        return self._vnc_proxy_manager.stop(session_id, force=force)

    def vnc_status(self, target_host: str | None = None, target_port: int = 5900):
        return self._vnc_proxy_manager.status(target_host, target_port)

    def vnc_summary(self):
        return self._vnc_proxy_manager.summary()
