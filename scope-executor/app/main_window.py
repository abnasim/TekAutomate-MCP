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

        self._build()
        self._init_tray()
        self._start_server()

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build(self):
        # ── Three columns ─────────────────────────────────────────────
        main = ttk.Frame(self.master)
        main.pack(fill=tk.BOTH, expand=True, padx=20, pady=(16, 0))

        main.grid_columnconfigure(0, weight=0, minsize=220)
        main.grid_columnconfigure(1, weight=2)
        main.grid_columnconfigure(2, weight=2)
        main.grid_rowconfigure(0, weight=1)

        # Left: Connection – fixed width
        self.conn_panel = ConnectionPanel(main)
        self.conn_panel.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        # Centre: Instruments
        self.instr_panel = InstrumentPanel(main)
        self.instr_panel.scan_requested.connect(self._run_scan)
        self.instr_panel.grid(row=0, column=1, sticky="nsew", padx=(0, 10))

        # Right: Activity Log
        self.log_panel = LogPanel(main)
        self.log_panel.grid(row=0, column=2, sticky="nsew")

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

    def _on_started(self, host, port):
        self._server_ready = True
        self._status_var.set(f"Server running on 0.0.0.0:{port}")
        self.conn_panel.set_status("ready")
        self.tray.set_status("ready", host, port)
        self.log_panel.log(f"Server started on {host}:{port}", "success")

    def _on_error(self, msg):
        self._server_ready = False
        self._status_var.set(f"Server error: {msg}")
        self.conn_panel.set_status("error")
        self.tray.set_status("error")
        self.log_panel.log(f"Server error: {msg}", "error")

    def _on_status(self, status):
        self.conn_panel.set_status(status)
        self.tray.set_status(status, self.conn_panel.get_host(), self.conn_panel.get_port())

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

    def _run_scan(self):
        if self._scan_thread and self._scan_thread.is_alive():
            return
        self.instr_panel.clear()
        self.log_panel.log("Scanning for VISA instruments...", "dim")
        self._scan_thread = InstrumentScanThread(query_idn=True, timeout_ms=3000)
        self._scan_thread.instrument_found.connect(self.instr_panel.add_instrument)
        self._scan_thread.scan_finished.connect(self.instr_panel.on_scan_finished)
        self._scan_thread.scan_finished.connect(
            lambda n: self.log_panel.log(f"Scan complete: {n} instrument(s) found", "success"))
        self._scan_thread.scan_error.connect(self.instr_panel.on_scan_error)
        self._scan_thread.scan_error.connect(
            lambda m: self.log_panel.log(f"Scan error: {m}", "error"))
        self._scan_thread.start()

    def _show_window(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

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
