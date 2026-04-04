"""
Activity log panel – true terminal look, header with inline Clear.
Three verbosity modes: Summary (default), Verbose, Debug (numpad 5595).
"""
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
MAGENTA  = "#FF79C6"
ORANGE   = "#FFB86C"

# Verbosity modes
MODE_SUMMARY = 0  # Sent/Received only
MODE_VERBOSE = 1  # + STEP/RESP/OK/ERR details
MODE_DEBUG   = 2  # Full raw output (barebone)

MODE_LABELS = {
    MODE_SUMMARY: "Summary",
    MODE_VERBOSE: "Verbose",
    MODE_DEBUG: "Debug",
}


class LogPanel(ttk.Frame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.clear_buffer_requested = None
        self._mode = MODE_SUMMARY
        self._debug_code = ""  # tracks numpad input for 5595
        self._build()

    def _build(self):
        # ── Header: title left, buttons right ────────────────────────
        hdr = ttk.Frame(self)
        hdr.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(hdr, text="Activity Log", font=("Segoe UI", 16, "bold")).pack(side=tk.LEFT)

        self._mode_btn = ttk.Button(hdr, text="Summary", command=self._cycle_mode)
        self._mode_btn.pack(side=tk.RIGHT, padx=(0, 8))

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

        # Smooth scrolling via mousewheel
        self._log.bind("<MouseWheel>", self._on_mousewheel)
        self._log.bind("<Button-4>", lambda e: self._log.yview_scroll(-3, "units"))
        self._log.bind("<Button-5>", lambda e: self._log.yview_scroll(3, "units"))

        # Listen for debug code (numpad 5595)
        self._log.bind("<Key>", self._on_key)

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
        self._log.tag_configure("step", foreground=MAGENTA)
        self._log.tag_configure("resp", foreground=ORANGE)
        self._log.tag_configure("sent", foreground=CYAN)
        self._log.tag_configure("received", foreground=GREEN)

    def _on_mousewheel(self, event):
        """Smooth scrolling — scroll 3 units per tick."""
        self._log.yview_scroll(-1 * (event.delta // 40), "units")
        return "break"

    def _on_key(self, event):
        """Listen for numpad 5595 to toggle debug mode."""
        if event.char and event.char.isdigit():
            self._debug_code += event.char
            if len(self._debug_code) > 4:
                self._debug_code = self._debug_code[-4:]
            if self._debug_code == "5595":
                self._debug_code = ""
                if self._mode == MODE_DEBUG:
                    self._mode = MODE_SUMMARY
                else:
                    self._mode = MODE_DEBUG
                self._mode_btn.configure(text=MODE_LABELS[self._mode])
                self.log(f"Debug mode {'enabled' if self._mode == MODE_DEBUG else 'disabled'}.", "dim")
        else:
            self._debug_code = ""

    def log(self, message: str, level: str = "info"):
        tag = level if level in ("info", "success", "warning", "error",
                                  "request", "dim", "sent", "received") else "info"
        ts = datetime.now().strftime("%H:%M:%S")
        self._log.configure(state=tk.NORMAL)
        self._log.insert(tk.END, ts, "ts")
        self._log.insert(tk.END, " ")
        self._log.insert(tk.END, message + "\n", tag)
        self._log.configure(state=tk.DISABLED)
        self._log.see(tk.END)

    def log_raw(self, stream: str, line: str):
        """Stream a live stdout/stderr line from the running script."""
        text = line or ""

        # Debug mode: show everything raw
        if self._mode == MODE_DEBUG:
            tag = "stdout" if stream == "stdout" else "stderr"
            self._log.configure(state=tk.NORMAL)
            self._log.insert(tk.END, text + "\n", tag)
            self._log.configure(state=tk.DISABLED)
            self._log.see(tk.END)
            return

        # Verbose mode: show colored STEP/RESP/OK/ERR
        if self._mode == MODE_VERBOSE:
            tag = "stdout" if stream == "stdout" else "stderr"
            prefix = "  > " if stream == "stdout" else "  ! "
            if "[STEP]" in text:
                tag = "step"
            elif "[RESP]" in text:
                tag = "resp"
            elif "[OK]" in text:
                tag = "success"
            elif "[ERR]" in text or "[ERROR]" in text:
                tag = "error"
            self._log.configure(state=tk.NORMAL)
            self._log.insert(tk.END, prefix, "prefix")
            self._log.insert(tk.END, text + "\n", tag)
            self._log.configure(state=tk.DISABLED)
            self._log.see(tk.END)
            return

        # Summary mode: skip raw output entirely
        return

    def log_request(self, method: str, path: str, status: int, detail: str):
        """Log HTTP requests — format depends on mode."""
        if self._mode == MODE_DEBUG:
            # Debug: full raw POST line
            level = "request" if status < 400 else "error"
            self.log(f"{method} {path} \u2192 {status}  {detail}", level)
            return

        # Summary & Verbose: clean Sent/Received format
        if status >= 400:
            self.log(f"ERROR  {detail}", "error")
            return

        # Parse detail to extract action and key info
        detail_lower = detail.lower()
        if "action=send_scpi" in detail_lower:
            self.log(f"Sent SCPI  {detail.split('visa=')[-1] if 'visa=' in detail else detail}", "sent")
        elif "action=capture_screenshot" in detail_lower:
            size = ""
            if "size=" in detail:
                size = f" ({detail.split('size=')[-1].split(' ')[0]})"
            self.log(f"Received screenshot{size}", "received")
        elif "action=run_python" in detail_lower:
            self.log("Sent Python script", "sent")
        elif "action=disconnect" in detail_lower:
            self.log("Disconnected", "dim")
        elif "action=device_clear" in detail_lower:
            self.log("Sent device clear", "sent")
        else:
            self.log(f"Sent {detail}", "sent")

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

    def _cycle_mode(self):
        """Cycle between Summary and Verbose. Debug only via numpad 5595."""
        if self._mode == MODE_SUMMARY:
            self._mode = MODE_VERBOSE
        elif self._mode == MODE_VERBOSE:
            self._mode = MODE_SUMMARY
        else:  # debug → back to summary
            self._mode = MODE_SUMMARY
        self._mode_btn.configure(text=MODE_LABELS[self._mode])
        self.log(f"Log mode: {MODE_LABELS[self._mode]}", "dim")
