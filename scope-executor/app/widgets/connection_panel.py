"""
Connection panel – clean, structured, full-width card.
Tkinter port of the original PySide6 version.
"""
import socket
import tkinter as tk
from tkinter import ttk
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
        self._clients: dict[str, tuple[ttk.Frame, datetime]] = {}
        self._qr_photo = None  # prevent GC
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

        # ── QR CARD ───────────────────────────────────────────────────
        qr_frame = ttk.LabelFrame(self, text="QR CODE")
        qr_frame.pack(fill=tk.X, pady=(0, 8))

        self._qr_lbl = ttk.Label(qr_frame, text="", anchor=tk.CENTER)
        self._qr_lbl.pack(fill=tk.X, padx=8, pady=4)

        self._url_lbl = ttk.Label(qr_frame, text="", wraplength=180, anchor=tk.CENTER)
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

    def _url(self):
        return f"tekautomate://connect?v=1&host={self.get_host()}&port={self.get_port()}"

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
