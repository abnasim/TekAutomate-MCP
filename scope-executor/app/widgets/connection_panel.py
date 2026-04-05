"""
Connection panel – clean, structured, full-width card.
Tkinter port of the original PySide6 version.
"""
import socket
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime

from app.tk_utils import TkSignal

BG       = "#121212"
CARD     = "#1E1E1E"
INPUT    = "#2A2A2A"
BORDER   = "#3A3A3A"
ACCENT   = "#FFD700"
BLUE     = "#00A3E0"
GREEN    = "#3DBE6A"
RED      = "#E05555"
WHITE    = "#FFFFFF"
MUTED    = "#777777"
DIM      = "#444444"
DEFAULT_MCP_URL = "https://tekautomate-mcp-production.up.railway.app/mcp"


def _local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0); s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]; s.close(); return ip
    except Exception:
        return "192.168.1.10"


class ConnectionPanel(ttk.Frame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.host_changed = TkSignal()
        self.port_changed = TkSignal()
        self.live_token_generate_requested = TkSignal()
        self.live_token_revoke_requested = TkSignal()
        self.vnc_test_requested = TkSignal()
        self._clients: dict[str, tuple[ttk.Frame, datetime]] = {}
        self._qr_photo = None  # prevent GC
        self._qr_visible = False
        self._active_token = ""
        self._active_mcp_link = ""
        self._build()

    def _build(self):
        # ── SERVER CARD ───────────────────────────────────────────────
        server_frame = ttk.LabelFrame(self, text="SERVER ADDRESS")
        server_frame.pack(fill=tk.X, pady=(0, 8))

        # Address row: [host input] : [port input]
        addr_row = ttk.Frame(server_frame)
        addr_row.pack(fill=tk.X, padx=8, pady=4)

        self._host_var = tk.StringVar(value=_local_ip())
        self.host_input = ttk.Entry(addr_row, textvariable=self._host_var, width=15)
        self.host_input.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self._host_var.trace_add("write", lambda *_: self.host_changed.emit(self._host_var.get()))

        ttk.Label(addr_row, text=" : ").pack(side=tk.LEFT)

        self._port_var = tk.StringVar(value="8765")
        self.port_input = ttk.Entry(addr_row, textvariable=self._port_var, width=6)
        self.port_input.pack(side=tk.LEFT)
        self._port_var.trace_add("write", lambda *_: self._port_changed())

        # Status row
        status_row = ttk.Frame(server_frame)
        status_row.pack(fill=tk.X, padx=8, pady=4)

        self._pip_canvas = tk.Canvas(status_row, width=10, height=10,
                                      highlightthickness=0, bg=self._get_bg())
        self._pip_canvas.pack(side=tk.LEFT, padx=(0, 6))
        self._pip_id = self._pip_canvas.create_oval(1, 1, 9, 9, fill=DIM, outline="")

        self._status_lbl = ttk.Label(status_row, text="Starting...")
        self._status_lbl.pack(side=tk.LEFT)

        token_frame = ttk.LabelFrame(self, text="LIVE TOKEN")

        token_controls = ttk.Frame(token_frame)
        token_controls.pack(fill=tk.X, padx=8, pady=(4, 2))

        self._token_duration_var = tk.StringVar(value="1 hr")
        self._token_duration_combo = ttk.Combobox(
            token_controls,
            textvariable=self._token_duration_var,
            state="readonly",
            values=["1 hr", "1 day", "1 week", "1 month", "1 year"],
            width=10,
        )
        self._token_duration_combo.pack(side=tk.LEFT, fill=tk.X, expand=True)

        ttk.Button(token_controls, text="Generate", command=self._generate_token).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(token_controls, text="Revoke", command=self._revoke_token).pack(side=tk.LEFT, padx=(6, 0))

        self._token_var = tk.StringVar(value="No active token")
        token_row = ttk.Frame(token_frame)
        token_row.pack(fill=tk.X, padx=8, pady=(2, 2))
        self._token_entry = ttk.Entry(token_row, textvariable=self._token_var)
        self._token_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(token_row, text="Copy", command=self._copy_token).pack(side=tk.LEFT, padx=(6, 0))

        self._mcp_link_var = tk.StringVar(value="No active MCP link")
        mcp_row = ttk.Frame(token_frame)
        mcp_row.pack(fill=tk.X, padx=8, pady=(0, 2))
        self._mcp_link_entry = ttk.Entry(mcp_row, textvariable=self._mcp_link_var)
        self._mcp_link_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(mcp_row, text="Copy MCP Link", command=self._copy_mcp_link).pack(side=tk.LEFT, padx=(6, 0))

        self._token_status_var = tk.StringVar(value="Generate a token to allow remote live control.")
        ttk.Label(
            token_frame,
            textvariable=self._token_status_var,
            wraplength=190,
            anchor=tk.W,
            justify=tk.LEFT,
        ).pack(fill=tk.X, padx=8, pady=(0, 6))

        vnc_frame = ttk.LabelFrame(self, text="VNC STATUS")
        vnc_frame.pack(fill=tk.X, pady=(0, 8))

        self._vnc_state_var = tk.StringVar(value="Idle")
        ttk.Label(vnc_frame, textvariable=self._vnc_state_var).pack(fill=tk.X, padx=8, pady=(4, 2))

        self._vnc_detail_var = tk.StringVar(value="No VNC probe or session yet.")
        ttk.Label(
            vnc_frame,
            textvariable=self._vnc_detail_var,
            wraplength=190,
            anchor=tk.W,
            justify=tk.LEFT,
        ).pack(fill=tk.X, padx=8, pady=(0, 6))

        vnc_actions = ttk.Frame(vnc_frame)
        vnc_actions.pack(fill=tk.X, padx=8, pady=(0, 4))
        ttk.Button(vnc_actions, text="Test VNC", command=self._request_vnc_test).pack(side=tk.LEFT)

        self._vnc_test_var = tk.StringVar(value="")
        ttk.Label(
            vnc_frame,
            textvariable=self._vnc_test_var,
            wraplength=190,
            anchor=tk.W,
            justify=tk.LEFT,
        ).pack(fill=tk.X, padx=8, pady=(0, 6))

        # ── QR TOGGLE BUTTON ──────────────────────────────────────────
        self._qr_toggle_btn = ttk.Button(self, text="Show QR Code", command=self._toggle_qr)
        self._qr_toggle_btn.pack(fill=tk.X, pady=(0, 8))

        # ── QR CARD (hidden by default) ──────────────────────────────
        self._qr_frame = ttk.LabelFrame(self, text="QR CODE")
        # Not packed initially — hidden

        self._qr_lbl = ttk.Label(self._qr_frame, text="", anchor=tk.CENTER)
        self._qr_lbl.pack(fill=tk.X, padx=8, pady=4)

        self._url_lbl = ttk.Label(self._qr_frame, text="", wraplength=180, anchor=tk.CENTER)
        self._url_lbl.pack(fill=tk.X, padx=8, pady=(0, 4))

        # ── CONNECTED CLIENTS CARD ────────────────────────────────────
        clients_frame = ttk.LabelFrame(self, text="CONNECTED CLIENTS")
        clients_frame.pack(fill=tk.X, pady=(0, 8))
        self._clients_container = clients_frame

        self._no_clients = ttk.Label(clients_frame, text="No clients yet")
        self._no_clients.pack(padx=8, pady=4)

        self._refresh_qr()
        self._host_var.trace_add("write", lambda *_: self._refresh_qr())
        self._port_var.trace_add("write", lambda *_: self._refresh_qr())

    def _get_bg(self):
        """Get background color from current ttk theme."""
        try:
            return ttk.Style().lookup("TFrame", "background") or BG
        except Exception:
            return BG

    def _toggle_qr(self):
        if self._qr_visible:
            self._qr_frame.pack_forget()
            self._qr_toggle_btn.configure(text="Show QR Code")
            self._qr_visible = False
        else:
            self._qr_frame.pack(fill=tk.X, pady=(0, 8), before=self._clients_container.master if hasattr(self._clients_container, 'master') else None)
            self._qr_toggle_btn.configure(text="Hide QR Code")
            self._qr_visible = True
            self._refresh_qr()

    def _port_changed(self):
        try:
            p = int(self._port_var.get())
            if 1 <= p <= 65535:
                self.port_changed.emit(p)
        except ValueError:
            pass

    def get_host(self): return self._host_var.get().strip() or "localhost"
    def get_port(self):
        try: return int(self._port_var.get().strip())
        except ValueError: return 8765
    def get_timeout(self) -> int:
        return 30

    def get_selected_token_duration_minutes(self) -> int:
        label = self._token_duration_var.get().strip().lower()
        mapping = {
            "1 hr": 60,
            "1 day": 1440,
            "1 week": 10080,
            "1 month": 43200,
            "1 year": 525600,
        }
        return mapping.get(label, 60)

    def _url(self):
        return f"tekautomate://connect?v=1&host={self.get_host()}&port={self.get_port()}"

    def _mcp_link(self, token: str | None = None) -> str:
        live_token = (token or self._active_token or "").strip()
        if not live_token:
            return ""
        return f"{DEFAULT_MCP_URL}?token={live_token}"

    def _refresh_qr(self):
        url = self._url()
        self._url_lbl.configure(text=url)
        try:
            import qrcode
            from PIL import Image as PI, ImageTk
            qr = qrcode.QRCode(version=1, box_size=4, border=2)
            qr.add_data(url); qr.make(fit=True)
            img = qr.make_image(fill_color="#FFFFFF", back_color="#2A2A2A")
            img = img.resize((154, 154), PI.Resampling.LANCZOS)
            self._qr_photo = ImageTk.PhotoImage(img)
            self._qr_lbl.configure(image=self._qr_photo, text="")
        except ImportError:
            self._qr_lbl.configure(text="pip install qrcode Pillow", image="")

    def set_status(self, status: str):
        c = {"ready": GREEN, "busy": ACCENT, "error": RED}.get(status, DIM)
        t = {"ready": "Ready", "busy": "Running...", "error": "Error",
             "starting": "Starting..."}.get(status, status)
        self._pip_canvas.itemconfigure(self._pip_id, fill=c)
        self._status_lbl.configure(text=t)

    def set_live_token_status(self, status: dict | None, token: str | None = None):
        status = status or {}
        active = bool(status.get("active"))
        if token:
            self._active_token = token
            self._token_var.set(token)
        elif active:
            self._token_var.set(str(status.get("tokenPreview") or "Token active"))
        else:
            self._active_token = ""
            self._token_var.set("No active token")

        link = self._mcp_link(token=token if token else None) if active else ""
        self._active_mcp_link = link
        self._mcp_link_var.set(link or "No active MCP link")

        remaining = int(status.get("remainingSec") or 0)
        if active:
            minutes, seconds = divmod(remaining, 60)
            hours, minutes = divmod(minutes, 60)
            ttl = f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"
            self._token_status_var.set(f"Active live token. Expires in {ttl}. Paste the MCP link into Claude or paste the token into TekAutomate Live mode.")
        else:
            self._token_status_var.set("Generate a token to allow remote live control.")

    def set_vnc_status(self, summary: dict | None):
        summary = summary or {}
        sessions = summary.get("sessions") or []
        latest_probe = summary.get("latestProbe") or {}

        if sessions:
            session = sessions[0]
            target = session.get("target") or {}
            listen = session.get("listen") or {}
            self._vnc_state_var.set("Running")
            self._vnc_detail_var.set(
                f"Live VNC proxy active.\n"
                f"Target: {target.get('host', '-')}:{target.get('port', '-')}\n"
                f"Bridge: {listen.get('host', '-')}:{listen.get('port', '-')}"
            )
            return

        if latest_probe:
            target = latest_probe.get("target") or {}
            if latest_probe.get("available"):
                self._vnc_state_var.set("Available")
                self._vnc_detail_var.set(
                    f"VNC reachable at {target.get('host', '-')}:{target.get('port', '-')}\n"
                    f"Checked {int(latest_probe.get('ageSec') or 0)}s ago."
                )
            else:
                error = str(latest_probe.get("error") or "Connection failed.")
                self._vnc_state_var.set("Unavailable")
                self._vnc_detail_var.set(
                    f"VNC not reachable at {target.get('host', '-')}:{target.get('port', '-')}\n"
                    f"{error}"
                )
            return

        self._vnc_state_var.set("Idle")
        self._vnc_detail_var.set("No VNC probe or session yet.")

    def set_vnc_test_result(self, message: str):
        self._vnc_test_var.set(str(message or ""))

    def on_client_seen(self, ip: str):
        now = datetime.now()
        if ip in self._clients:
            frame, _ = self._clients[ip]
            for child in frame.winfo_children():
                if getattr(child, "_is_timestamp", False):
                    child.configure(text=now.strftime("%H:%M:%S"))
            self._clients[ip] = (frame, now)
            return

        self._no_clients.pack_forget()

        row = ttk.Frame(self._clients_container)
        row.pack(fill=tk.X, padx=8, pady=2)

        # Green pip
        pip = tk.Canvas(row, width=8, height=8, highlightthickness=0,
                        bg=self._get_bg())
        pip.create_oval(0, 0, 7, 7, fill=GREEN, outline="")
        pip.pack(side=tk.LEFT, padx=(0, 6))

        ttk.Label(row, text=ip).pack(side=tk.LEFT)

        ts = ttk.Label(row, text=now.strftime("%H:%M:%S"))
        ts._is_timestamp = True
        ts.pack(side=tk.RIGHT)

        self._clients[ip] = (row, now)

    def _generate_token(self):
        self.live_token_generate_requested.emit(self.get_selected_token_duration_minutes())

    def _revoke_token(self):
        self.live_token_revoke_requested.emit()

    def _copy_token(self):
        token = self._active_token or self._token_var.get().strip()
        if not token or token == "No active token":
            messagebox.showinfo("Live Token", "Generate a token first.")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(token)
            self.update_idletasks()
        except Exception:
            messagebox.showerror("Live Token", "Failed to copy token to clipboard.")

    def _copy_mcp_link(self):
        link = self._active_mcp_link or self._mcp_link_var.get().strip()
        if not link or link == "No active MCP link":
            messagebox.showinfo("MCP Link", "Generate a token first.")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(link)
            self.update_idletasks()
        except Exception:
            messagebox.showerror("MCP Link", "Failed to copy MCP link to clipboard.")

    def _request_vnc_test(self):
        self.vnc_test_requested.emit()
