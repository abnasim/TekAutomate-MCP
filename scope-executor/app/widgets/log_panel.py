"""
Activity log panel – true terminal look, header with inline Clear.
Tkinter port of the original PySide6 version.
"""
import html
import tkinter as tk
from tkinter import ttk
from datetime import datetime

TERMINAL = "#0D0D0D"
CARD     = "#1E1E1E"
BORDER   = "#3A3A3A"
BLUE     = "#00A3E0"
GREEN    = "#3DBE6A"
YELLOW   = "#FFD700"
RED      = "#E05555"
WHITE    = "#FFFFFF"
MUTED    = "#777777"
DIM      = "#444444"
CYAN     = "#00D4FF"


class LogPanel(ttk.Frame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.clear_buffer_requested = None
        self._verbose = False
        self._build()

    def _build(self):
        # ── Header: title left, Clear right ──────────────────────────
        hdr = ttk.Frame(self)
        hdr.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(hdr, text="Activity Log", font=("Segoe UI", 16, "bold")).pack(side=tk.LEFT)

        self._verbose_btn = ttk.Button(hdr, text="Verbose off", command=self.toggle_verbose)
        self._verbose_btn.pack(side=tk.RIGHT, padx=(0, 8))

        self._clear_buffer_btn = ttk.Button(hdr, text="Clear Buffer", command=self._on_clear_buffer)
        self._clear_buffer_btn.pack(side=tk.RIGHT, padx=(0, 8))

        clear_btn = ttk.Button(hdr, text="Clear", command=self.clear)
        clear_btn.pack(side=tk.RIGHT)

        # ── Terminal ──────────────────────────────────────────────────
        text_frame = ttk.Frame(self)
        text_frame.pack(fill=tk.BOTH, expand=True)

        self._log = tk.Text(text_frame, wrap=tk.WORD, font=("Consolas", 10),
                            bg=TERMINAL, fg=MUTED, insertbackground=WHITE,
                            relief=tk.FLAT, borderwidth=0, padx=14, pady=14,
                            state=tk.DISABLED)
        scrollbar = ttk.Scrollbar(text_frame, orient=tk.VERTICAL,
                                   command=self._log.yview)
        self._log.configure(yscrollcommand=scrollbar.set)

        self._log.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Configure color tags
        self._log.tag_configure("ts", foreground=DIM)
        self._log.tag_configure("info", foreground=WHITE)
        self._log.tag_configure("success", foreground=GREEN)
        self._log.tag_configure("warning", foreground=YELLOW)
        self._log.tag_configure("error", foreground=RED)
        self._log.tag_configure("request", foreground=CYAN)
        self._log.tag_configure("dim", foreground=DIM)
        self._log.tag_configure("stdout", foreground=MUTED)
        self._log.tag_configure("stderr", foreground=YELLOW)
        self._log.tag_configure("prefix", foreground=DIM)

    def log(self, message: str, level: str = "info"):
        tag = level if level in ("info", "success", "warning", "error",
                                  "request", "dim") else "info"
        ts = datetime.now().strftime("%H:%M:%S")
        self._log.configure(state=tk.NORMAL)
        self._log.insert(tk.END, ts, "ts")
        self._log.insert(tk.END, " ")
        self._log.insert(tk.END, message + "\n", tag)
        self._log.configure(state=tk.DISABLED)
        self._log.see(tk.END)

    def log_raw(self, stream: str, line: str):
        """Stream a live stdout/stderr line from the running script."""
        if not self._verbose:
            return
        tag = "stdout" if stream == "stdout" else "stderr"
        prefix = "  > " if stream == "stdout" else "  ! "
        self._log.configure(state=tk.NORMAL)
        self._log.insert(tk.END, prefix, "prefix")
        self._log.insert(tk.END, (line or "") + "\n", tag)
        self._log.configure(state=tk.DISABLED)
        self._log.see(tk.END)

    def log_request(self, method: str, path: str, status: int, detail: str):
        level = "request" if status < 400 else "error"
        self.log(f"{method} {path} \u2192 {status}  {detail}", level)

    def clear(self):
        self._log.configure(state=tk.NORMAL)
        self._log.delete("1.0", tk.END)
        self._log.configure(state=tk.DISABLED)

    def _on_clear_buffer(self):
        callback = self.clear_buffer_requested
        if callable(callback):
            callback()

    def set_clear_buffer_busy(self, busy: bool):
        self._clear_buffer_btn.configure(
            state=tk.DISABLED if busy else tk.NORMAL,
            text="Clearing..." if busy else "Clear Buffer",
        )

    def toggle_verbose(self):
        self._verbose = not self._verbose
        self._verbose_btn.configure(text="Verbose on" if self._verbose else "Verbose off")
        self.log(
            "Verbose logging enabled: stdout/stderr and detailed request info will be shown."
            if self._verbose
            else "Verbose logging disabled: showing summary request lines only.",
            "dim",
        )
