"""
Instrument panel – scan button at top, full-width instrument cards.
Tkinter port of the original PySide6 version.
"""
import tkinter as tk
from tkinter import ttk

from app.instrument_scanner import InstrumentInfo
from app.tk_utils import TkSignal

BG       = "#121212"
CARD     = "#1E1E1E"
CARD2    = "#252525"
INPUT    = "#2A2A2A"
BORDER   = "#3A3A3A"
BLUE     = "#00A3E0"
GREEN    = "#3DBE6A"
RED      = "#E05555"
WHITE    = "#FFFFFF"
MUTED    = "#777777"
DIM      = "#444444"

CONN_ICONS = {"tcpip": "\u2295", "usb": "\u229F", "gpib": "\u229E",
              "serial": "\u22A0", "unknown": "\u25CB"}


class InstrumentPanel(ttk.Frame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.scan_requested = TkSignal()
        self.clear_requested = TkSignal()
        self._instruments: list[InstrumentInfo] = []
        self._clear_buttons: dict[str, ttk.Button] = {}
        self._build()

    def _build(self):
        # ── Header row: title + count + scan button ───────────────────
        hdr = ttk.Frame(self)
        hdr.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(hdr, text="Instruments", font=("Segoe UI", 16, "bold")).pack(side=tk.LEFT)

        self._count = ttk.Label(hdr, text="(0)")
        self._count.pack(side=tk.LEFT, padx=(6, 0))

        self._scan_btn = ttk.Button(hdr, text="Scan", command=self._on_scan)
        self._scan_btn.pack(side=tk.RIGHT)

        # ── Scrollable cards area ─────────────────────────────────────
        container = ttk.Frame(self)
        container.pack(fill=tk.BOTH, expand=True)

        _bg = ttk.Style().lookup("TFrame", "background") or BG
        self._canvas = tk.Canvas(container, highlightthickness=0, bg=_bg)
        self._scrollbar = ttk.Scrollbar(container, orient=tk.VERTICAL,
                                         command=self._canvas.yview)
        self._inner = ttk.Frame(self._canvas)

        self._inner.bind("<Configure>",
                         lambda e: self._canvas.configure(scrollregion=self._canvas.bbox("all")))
        self._canvas_window = self._canvas.create_window((0, 0), window=self._inner,
                                                          anchor=tk.NW)
        self._canvas.configure(yscrollcommand=self._scrollbar.set)

        self._canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self._scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Make inner frame expand to canvas width
        self._canvas.bind("<Configure>", self._on_canvas_configure)

        # Mouse wheel scrolling
        self._canvas.bind_all("<MouseWheel>",
                              lambda e: self._canvas.yview_scroll(-1 * (e.delta // 120), "units"))

        # ── Status label ──────────────────────────────────────────────
        self._status = ttk.Label(self, text="")
        self._status.pack(fill=tk.X, pady=(4, 0))

    def _on_canvas_configure(self, event):
        self._canvas.itemconfigure(self._canvas_window, width=event.width)

    def _on_scan(self):
        self._scan_btn.configure(state=tk.DISABLED, text="Scanning\u2026")
        self._status.configure(text="")
        self.scan_requested.emit()

    def clear(self):
        self._instruments.clear()
        self._clear_buttons.clear()
        for widget in self._inner.winfo_children():
            widget.destroy()
        self._count.configure(text="(0)")

    def add_instrument(self, info: InstrumentInfo):
        self._instruments.append(info)

        card = ttk.Frame(self._inner, relief=tk.RIDGE, borderwidth=1)
        card.pack(fill=tk.X, padx=4, pady=4)

        # Top row: icon + resource string + pip
        top = ttk.Frame(card)
        top.pack(fill=tk.X, padx=8, pady=(6, 2))

        icon_text = CONN_ICONS.get(info.conn_type, "\u25CB")
        ttk.Label(top, text=icon_text, foreground=BLUE).pack(side=tk.LEFT, padx=(0, 6))

        ttk.Label(top, text=info.resource, font=("Consolas", 10)).pack(side=tk.LEFT, fill=tk.X, expand=True)

        pip_color = GREEN if info.reachable else DIM
        _bg = ttk.Style().lookup("TFrame", "background") or BG
        pip = tk.Canvas(top, width=8, height=8, highlightthickness=0, bg=_bg)
        pip.create_oval(0, 0, 8, 8, fill=pip_color, outline="")
        pip.pack(side=tk.RIGHT)

        # Identity row + actions
        info_row = ttk.Frame(card)
        info_row.pack(fill=tk.X, padx=8, pady=(0, 6))

        if info.model:
            id_text = f"{info.manufacturer} {info.model}"
            if info.serial:
                id_text += f"  \u00b7  S/N {info.serial}"
        elif info.identity:
            id_text = info.identity
        else:
            id_text = "Unknown"

        ttk.Label(info_row, text=id_text).pack(side=tk.LEFT, fill=tk.X, expand=True)

        clear_btn = ttk.Button(
            info_row,
            text="Clear Buffer",
            command=lambda resource=info.resource, label=info.display_name: self.clear_requested.emit(resource, label),
        )
        clear_btn.pack(side=tk.RIGHT, padx=(8, 0))
        self._clear_buttons[info.resource] = clear_btn

        self._count.configure(text=f"({len(self._instruments)})")

    def set_clear_busy(self, resource: str, busy: bool):
        btn = self._clear_buttons.get(resource)
        if not btn:
            return
        btn.configure(
            state=tk.DISABLED if busy else tk.NORMAL,
            text="Clearing..." if busy else "Clear Buffer",
        )

    def on_scan_finished(self, count: int):
        self._scan_btn.configure(state=tk.NORMAL, text="Scan")
        self._status.configure(
            text=f"Found {count} instrument{'s' if count != 1 else ''}")

    def on_scan_error(self, msg: str):
        self._scan_btn.configure(state=tk.NORMAL, text="Scan")
        self._status.configure(text=msg)
