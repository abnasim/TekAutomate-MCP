"""
Main window – three-column layout, consistent padding, strict alignment.
Columns: Connection (fixed 220px) | Instruments (flex) | Activity Log (flex)
Tkinter port of the original PySide6 version.
"""
import os
import tkinter as tk
from tkinter import ttk
import threading
import urllib.request
import json
import re

from app.code_runner import run_executor_action
from app.http_server import HTTPServerThread
from app.instrument_scanner import InstrumentScanThread
from app.system_tray import SystemTray
from app.widgets.connection_panel import ConnectionPanel
from app.widgets.instrument_panel import InstrumentPanel
from app.widgets.log_panel import LogPanel
from app.widgets.plugin_bar import PluginBar


class MainWindow:
    def __init__(self, root: tk.Tk, master: ttk.Frame):
        self.root = root
        self.master = master  # TKMT themed frame — build widgets here

        self._really_quit = False
        self._scan_thread: InstrumentScanThread | None = None
        self._server: HTTPServerThread | None = None
        self._server_ready = False
        self._startup_probe_attempts = 0
        self._last_vnc_summary: dict = {}
        self._selected_vnc_target_label: str | None = None

        self._build()
        self._init_tray()
        self._start_server()

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build(self):
        # ── Three resizable panes ──────────────────────────────────────
        paned = ttk.PanedWindow(self.master, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True, padx=8, pady=(12, 0))

        # Left: Connection
        self.conn_panel = ConnectionPanel(paned)
        self.conn_panel.vnc_test_requested.connect(self._test_vnc_target)
        self.conn_panel.vnc_target_changed.connect(self._on_vnc_target_changed)
        paned.add(self.conn_panel, weight=1)

        # Centre: Instruments
        self.instr_panel = InstrumentPanel(paned)
        self.instr_panel.scan_requested.connect(self._run_scan)
        self.instr_panel.clear_requested.connect(self._clear_instrument_buffer)
        self.instr_panel.add_ip_requested.connect(self._add_ip_instrument)
        paned.add(self.instr_panel, weight=2)

        # Right: Activity Log
        self.log_panel = LogPanel(paned)
        self.log_panel.clear_buffer_requested = self._clear_visible_instrument_buffers
        paned.add(self.log_panel, weight=3)

        # ── Plugin bar ────────────────────────────────────────────────
        self.plugin_bar = PluginBar(self.master)
        self.plugin_bar.pack(fill=tk.X, side=tk.BOTTOM)

        # ── Status bar ────────────────────────────────────────────────
        self._status_var = tk.StringVar(value="All modules loaded")
        status_bar = ttk.Label(self.master, textvariable=self._status_var,
                                relief=tk.FLAT, anchor=tk.W)
        status_bar.pack(fill=tk.X, side=tk.BOTTOM)

    def _init_tray(self):
        self.tray = SystemTray()
        self.tray.show_requested.connect(self._show_window)
        self.tray.scan_requested.connect(self._run_scan)
        self.tray.quit_requested.connect(self._quit)
        self.tray.show()

    def _start_server(self):
        host = self.conn_panel.get_host()
        port = self.conn_panel.get_port()
        self._server_ready = False
        self.conn_panel.set_status("starting")
        self._server = HTTPServerThread(host, port)
        self._server.get_timeout = self.conn_panel.get_timeout
        self._server.server_started.connect(self._on_started)
        self._server.server_error.connect(self._on_error)
        self._server.server_status_changed.connect(self._on_status)
        self._server.request_logged.connect(self._on_request)
        self._server.client_seen.connect(self.conn_panel.on_client_seen)
        self._server.script_line.connect(self._on_script_line)
        if not self._server.prepare():
            self._on_error(self._server._prepare_error or "Failed to prepare server")
            return
        self._server.start()
        self._startup_probe_attempts = 0
        self.root.after(500, self._verify_server_started)
        self.root.after(1000, self._poll_vnc_status)

    def _on_started(self, host, port):
        self._server_ready = True
        self._status_var.set(f"Server running on 0.0.0.0:{port}")
        self.conn_panel.set_status("ready")
        self.tray.set_status("ready", host, port)
        self.log_panel.log(f"Server started on {host}:{port}", "success")
        # Show last known instruments immediately without blocking startup
        self.root.after(100, self._load_cached_instruments)

    def _on_error(self, msg):
        self._server_ready = False
        self._status_var.set(f"Server error: {msg}")
        self.conn_panel.set_status("error")
        self.tray.set_status("error")
        self.log_panel.log(f"Server error: {msg}", "error")

    def _on_status(self, status):
        self.conn_panel.set_status(status)
        self.tray.set_status(status, self.conn_panel.get_host(), self.conn_panel.get_port())

    def _poll_vnc_status(self):
        if self._really_quit:
            return
        try:
            summary = self._server.vnc_summary() if self._server else {}
            self._last_vnc_summary = summary or {}
            self.conn_panel.set_vnc_status(summary)
        except Exception:
            self._last_vnc_summary = {}
            self.conn_panel.set_vnc_status({"ok": False})
        finally:
            self.root.after(2000, self._poll_vnc_status)

    def _on_request(self, method, path, status, detail):
        self.log_panel.log_request(method, path, status, detail)

    def _on_script_line(self, stream: str, line: str):
        self.log_panel.log_raw(stream, line)

    def _verify_server_started(self):
        if self._server_ready or self._really_quit or not self._server:
            return
        self._startup_probe_attempts += 1
        host = self.conn_panel.get_host() or "127.0.0.1"
        port = self.conn_panel.get_port()
        url = f"http://127.0.0.1:{port}/health"
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                if payload.get("status") == "ok":
                    self._on_started(host, port)
                    return
        except Exception:
            pass

        if self._startup_probe_attempts >= 20:
            if not self._server_ready:
                self._on_error("Server did not become healthy within 10 seconds")
            return
        self.root.after(500, self._verify_server_started)

    def _load_cached_instruments(self):
        """Show last scan results immediately on startup (non-blocking)."""
        from app.instrument_scanner import load_scan_cache, InstrumentInfo
        cached = load_scan_cache()
        if not cached:
            return
        for d in cached:
            info = InstrumentInfo(
                resource=d.get("resource", ""),
                identity=d.get("identity", ""),
                manufacturer=d.get("manufacturer", ""),
                model=d.get("model", ""),
                serial=d.get("serial", ""),
                firmware=d.get("firmware", ""),
                reachable=d.get("reachable", True),
                conn_type=d.get("conn_type", "tcpip"),
            )
            self.instr_panel.add_instrument(info)
        self.instr_panel._status.configure(text=f"Cached: {len(cached)} instrument(s) — press Scan to refresh")
        self._refresh_vnc_targets()

    def _run_scan(self):
        if self._scan_thread and self._scan_thread.is_alive():
            return
        self.instr_panel.clear()
        self.log_panel.log("Scanning for VISA instruments...", "dim")
        self._found_in_scan: list = []
        self._scan_thread = InstrumentScanThread(query_idn=True, timeout_ms=3000)

        def _on_found(info):
            self._found_in_scan.append(info)
            self.instr_panel.add_instrument(info)
            self._refresh_vnc_targets()

        def _on_finished(n):
            from app.instrument_scanner import save_scan_cache
            save_scan_cache(self._found_in_scan)
            self.instr_panel.on_scan_finished(n)
            self.log_panel.log(f"Scan complete: {n} instrument(s) found", "success")
            self._refresh_vnc_targets()

        self._scan_thread.instrument_found.connect(_on_found)
        self._scan_thread.scan_finished.connect(_on_finished)
        self._scan_thread.scan_error.connect(self.instr_panel.on_scan_error)
        self._scan_thread.scan_error.connect(
            lambda m: self.log_panel.log(f"Scan error: {m}", "error"))
        self._scan_thread.start()

    def _add_ip_instrument(self, ip: str):
        """Probe a user-supplied IP or host:port, add to panel and pin it."""
        from app.instrument_scanner import (
            InstrumentInfo, ip_to_visa_resources, pin_resource,
            _parse_idn, _is_valid_idn,
        )
        import pyvisa

        def _query_idn_visa(res: str, rm) -> str | None:
            """Query *IDN? via PyVISA (INSTR resources)."""
            try:
                inst = rm.open_resource(res, timeout=4000)
                idn = inst.query("*IDN?").strip()
                inst.close()
                return idn if _is_valid_idn(idn) else None
            except Exception:
                return None

        def _query_idn_socket(res: str) -> str | None:
            """Query *IDN? via raw SocketInstr (SOCKET resources)."""
            try:
                from app.socket_instr import SocketInstr
            except ModuleNotFoundError:
                try:
                    from socket_instr import SocketInstr
                except ModuleNotFoundError:
                    return None
            try:
                parts = res.split("::")
                host = parts[1] if len(parts) > 1 else "127.0.0.1"
                port = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 4000
                sock = SocketInstr(host, port, timeout=4)
                idn = sock.query("*IDN?").strip()
                sock.close()
                return idn if _is_valid_idn(idn) else None
            except Exception:
                return None

        def _probe():
            resources = ip_to_visa_resources(ip)
            found_any = False
            try:
                try:
                    rm = pyvisa.ResourceManager()
                except Exception:
                    rm = pyvisa.ResourceManager("@py")

                newly_found: list[InstrumentInfo] = []
                for res in resources:
                    is_socket = "SOCKET" in res.upper()
                    idn = _query_idn_socket(res) if is_socket else _query_idn_visa(res, rm)
                    if not idn:
                        continue
                    mfr, model, serial, fw = _parse_idn(idn)
                    conn_type = "socket" if is_socket else "tcpip"
                    info = InstrumentInfo(
                        resource=res, identity=idn,
                        manufacturer=mfr, model=model,
                        serial=serial, firmware=fw,
                        reachable=True,
                        conn_type=conn_type,
                    )
                    pin_resource(res)
                    newly_found.append(info)
                    self.root.after(0, lambda i=info: (
                        self.instr_panel.add_instrument(i),
                        self._refresh_vnc_targets(),
                    ))
                    found_any = True
                    # Don't break — add all responding resources (INSTR + SOCKET both useful)

                # Merge newly found instruments into the scan cache so MCP's /scan
                # picks them up immediately without needing a full rescan.
                if newly_found:
                    from app.instrument_scanner import load_scan_cache, save_scan_cache
                    cached = load_scan_cache()
                    cached_resources = {d["resource"] for d in cached}
                    merged = list(cached)
                    for i in newly_found:
                        if i.resource not in cached_resources:
                            merged.append(i)
                    save_scan_cache(merged)

            except Exception as e:
                self.root.after(0, lambda: self.instr_panel.on_add_ip_done(ip, False, f"Error: {e}"))
                return

            if found_any:
                self.root.after(0, lambda: self.instr_panel.on_add_ip_done(ip, True, f"Added {ip}"))
                self.root.after(0, lambda: self.log_panel.log(f"Added instrument at {ip}", "success"))
            else:
                self.root.after(0, lambda: self.instr_panel.on_add_ip_done(ip, False, f"No instrument found at {ip}"))
                self.root.after(0, lambda: self.log_panel.log(f"No instrument responded at {ip}", "error"))

        threading.Thread(target=_probe, daemon=True).start()

    def _clear_instrument_buffer(self, resource: str, label: str):
        self.instr_panel.set_clear_busy(resource, True)
        self.log_panel.log(f"Clearing transport buffers for {label}...", "dim")

        def _job():
            result = run_executor_action(
                "device_clear",
                {"keep_alive": True},
                timeout_sec=10,
                scope_visa=resource,
            )
            self.root.after(0, lambda: self._finish_clear_instrument_buffer(resource, label, result))

        threading.Thread(target=_job, daemon=True).start()

    def _finish_clear_instrument_buffer(self, resource: str, label: str, result: dict):
        self.instr_panel.set_clear_busy(resource, False)
        if result.get("ok"):
            self.log_panel.log(f"Buffer clear complete for {label}", "success")
            return
        error = result.get("error") or "Unknown error"
        self.log_panel.log(f"Buffer clear failed for {label}: {error}", "error")

    def _clear_visible_instrument_buffers(self):
        instruments = [info for info in getattr(self.instr_panel, "_instruments", []) if getattr(info, "reachable", False)]
        if not instruments:
            self.log_panel.log("No reachable instruments to clear.", "warning")
            return

        self.log_panel.set_clear_buffer_busy(True)
        self.log_panel.log(f"Clearing transport buffers for {len(instruments)} instrument(s)...", "dim")

        def _job():
            results: list[tuple[str, str, dict]] = []
            for info in instruments:
                result = run_executor_action(
                    "device_clear",
                    {"keep_alive": True},
                    timeout_sec=10,
                    scope_visa=info.resource,
                )
                results.append((info.resource, info.display_name, result))
            self.root.after(0, lambda: self._finish_clear_visible_instrument_buffers(results))

        threading.Thread(target=_job, daemon=True).start()

    def _finish_clear_visible_instrument_buffers(self, results: list[tuple[str, str, dict]]):
        self.log_panel.set_clear_buffer_busy(False)
        for resource, label, result in results:
            if result.get("ok"):
                self.log_panel.log(f"Buffer clear complete for {label}", "success")
                continue
            error = result.get("error") or "Unknown error"
            self.log_panel.log(f"Buffer clear failed for {label}: {error}", "error")


    def _show_window(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def _infer_vnc_target(self) -> tuple[str | None, int]:
        selected_host, selected_port = self.conn_panel.get_selected_vnc_target()
        if selected_host:
            return selected_host, selected_port

        summary = self._last_vnc_summary or {}
        sessions = summary.get("sessions") or []
        if sessions:
            target = sessions[0].get("target") or {}
            host = str(target.get("host") or "").strip() or None
            port = int(target.get("port") or 5900)
            if host:
                return host, port

        latest_probe = summary.get("latestProbe") or {}
        target = latest_probe.get("target") or {}
        host = str(target.get("host") or "").strip() or None
        port = int(target.get("port") or 5900)
        if host:
            return host, port

        for info in getattr(self.instr_panel, "_instruments", []) or []:
            resource = str(getattr(info, "resource", "") or "")
            match = re.search(r"TCPIP\d*::([^:]+)::", resource, re.IGNORECASE)
            if match:
                return match.group(1).strip(), 5900
        return None, 5900

    def _refresh_vnc_targets(self):
        targets: list[tuple[str, str, int]] = []
        seen: set[str] = set()
        for info in getattr(self.instr_panel, "_instruments", []) or []:
            resource = str(getattr(info, "resource", "") or "")
            match = re.search(r"TCPIP\d*::([^:]+)::", resource, re.IGNORECASE)
            if not match:
                continue
            host = match.group(1).strip()
            if not host or host in seen:
                continue
            seen.add(host)
            label = f"{getattr(info, 'display_name', '') or resource} ({host})"
            targets.append((label, host, 5900))
        self.conn_panel.set_vnc_targets(targets, self._selected_vnc_target_label)

    def _on_vnc_target_changed(self, label: str):
        self._selected_vnc_target_label = str(label or "").strip() or None

    def _test_vnc_target(self):
        host, port = self._infer_vnc_target()
        if not host:
            message = "No VNC target available yet. Run Check first or scan for an instrument."
            self.conn_panel.set_vnc_test_result(message)
            self.log_panel.log(message, "warning")
            return

        self.conn_panel.set_vnc_test_result(f"Testing VNC handshake for {host}:{port}...")
        self.log_panel.log(f"Testing VNC handshake for {host}:{port}...", "dim")

        def _job():
            if not self._server:
                result = {"ok": False, "error": "Server unavailable"}
            else:
                result = self._server.vnc_test_target(host, port)
            self.root.after(0, lambda: self._finish_vnc_test(host, port, result))

        threading.Thread(target=_job, daemon=True).start()

    def _finish_vnc_test(self, host: str, port: int, result: dict):
        if result.get("ok") and result.get("reachable"):
            banner = str(result.get("rfbBanner") or "RFB banner received")
            message = f"VNC handshake OK for {host}:{port} ({banner})"
            self.conn_panel.set_vnc_test_result(message)
            self.log_panel.log(message, "success")
            return

        error = str(result.get("error") or "VNC handshake failed.")
        message = f"VNC handshake failed for {host}:{port}: {error}"
        self.conn_panel.set_vnc_test_result(message)
        self.log_panel.log(message, "error")

    def _quit(self):
        if self._really_quit:
            return
        self._really_quit = True
        threading.Timer(2.0, os._exit, args=(0,)).start()
        if self._server:
            self._server.stop()
        from app.code_runner import shutdown_worker
        shutdown_worker()
        self.tray.hide()
        try:
            self.root.quit()
        except Exception:
            pass
        try:
            self.root.destroy()
        except Exception:
            pass

    def _on_close(self):
        if not self._really_quit:
            self.root.withdraw()
        else:
            self._quit()
