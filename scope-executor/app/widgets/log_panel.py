"""
Activity log panel with three verbosity modes.
"""
import re
import tkinter as tk
from datetime import datetime
from tkinter import ttk

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

TERMINAL = "#0D0D0D"
GREEN = "#3DBE6A"
YELLOW = "#FFD700"
RED = "#E05555"
WHITE = "#FFFFFF"
MUTED = "#777777"
DIM = "#444444"
CYAN = "#00D4FF"
MAGENTA = "#FF79C6"
ORANGE = "#FFB86C"

MODE_SUMMARY = 0
MODE_VERBOSE = 1
MODE_DEBUG = 2

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
        self._debug_code = ""
        self._build()

    def _build(self):
        hdr = ttk.Frame(self)
        hdr.pack(fill=tk.X, pady=(0, 8))

        ttk.Label(hdr, text="Activity Log", font=("Segoe UI", 16, "bold")).pack(side=tk.LEFT)

        self._mode_btn = ttk.Button(hdr, text="Summary", command=self._cycle_mode)
        self._mode_btn.pack(side=tk.RIGHT, padx=(0, 8))

        self._clear_buffer_btn = ttk.Button(hdr, text="Clear Buffer", command=self._on_clear_buffer)
        self._clear_buffer_btn.pack(side=tk.RIGHT, padx=(0, 8))

        ttk.Button(hdr, text="Clear", command=self.clear).pack(side=tk.RIGHT)

        text_frame = ttk.Frame(self)
        text_frame.pack(fill=tk.BOTH, expand=True)

        self._log = tk.Text(
            text_frame,
            wrap=tk.WORD,
            font=("Consolas", 10),
            bg=TERMINAL,
            fg=MUTED,
            insertbackground=WHITE,
            relief=tk.FLAT,
            borderwidth=0,
            padx=14,
            pady=14,
            state=tk.DISABLED,
        )
        scrollbar = ttk.Scrollbar(text_frame, orient=tk.VERTICAL, command=self._log.yview)
        self._log.configure(yscrollcommand=scrollbar.set)

        self._log.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self._log.bind("<MouseWheel>", self._on_mousewheel)
        self._log.bind("<Button-4>", lambda e: self._log.yview_scroll(-3, "units"))
        self._log.bind("<Button-5>", lambda e: self._log.yview_scroll(3, "units"))
        self._log.bind("<Key>", self._on_key)

        self._log.tag_configure("ts", foreground=DIM)
        self._log.tag_configure("info", foreground=WHITE)
        self._log.tag_configure("success", foreground=GREEN)
        self._log.tag_configure("warning", foreground=YELLOW)
        self._log.tag_configure("error", foreground=RED)
        self._log.tag_configure("request", foreground=CYAN)
        self._log.tag_configure("dim", foreground=DIM)
        self._log.tag_configure("stdout", foreground=MUTED)
        self._log.tag_configure("stderr", foreground=YELLOW)
        self._log.tag_configure("step", foreground=MAGENTA)
        self._log.tag_configure("resp", foreground=ORANGE)
        self._log.tag_configure("sent", foreground=CYAN)
        self._log.tag_configure("received", foreground=GREEN)

    def _on_mousewheel(self, event):
        self._log.yview_scroll(-1 * (event.delta // 40), "units")
        return "break"

    def _on_key(self, event):
        if event.char and event.char.isdigit():
            self._debug_code += event.char
            if len(self._debug_code) > 4:
                self._debug_code = self._debug_code[-4:]
            if self._debug_code == "5595":
                self._debug_code = ""
                self._mode = MODE_SUMMARY if self._mode == MODE_DEBUG else MODE_DEBUG
                self._mode_btn.configure(text=MODE_LABELS[self._mode])
                self.log(f"Debug mode {'enabled' if self._mode == MODE_DEBUG else 'disabled'}.", "dim")
        else:
            self._debug_code = ""

    def log(self, message: str, level: str = "info"):
        tag = level if level in ("info", "success", "warning", "error", "request", "dim", "sent", "received") else "info"
        ts = datetime.now().strftime("%H:%M:%S")
        self._log.configure(state=tk.NORMAL)
        self._log.insert(tk.END, ts, "ts")
        self._log.insert(tk.END, " ")
        self._log.insert(tk.END, message + "\n", tag)
        self._log.configure(state=tk.DISABLED)
        self._log.see(tk.END)

    def log_raw(self, stream: str, line: str):
        text = _ANSI_RE.sub("", line or "").rstrip()

        if self._mode == MODE_DEBUG:
            tag = "stdout" if stream == "stdout" else "stderr"
            self._log.configure(state=tk.NORMAL)
            self._log.insert(tk.END, text + "\n", tag)
            self._log.configure(state=tk.DISABLED)
            self._log.see(tk.END)
            return

        if self._mode == MODE_VERBOSE:
            if not text:
                return
            tag = "stdout" if stream == "stdout" else "stderr"
            display = text

            if "->" in text and "=" in text:
                parts = text.split("=", 1)
                cmd = parts[0].replace("->", "").strip()
                resp = parts[1].strip() if len(parts) > 1 else ""
                self._log.configure(state=tk.NORMAL)
                self._log.insert(tk.END, f"  -> {cmd}", "step")
                if resp:
                    self._log.insert(tk.END, f"  =  {resp}", "resp")
                self._log.insert(tk.END, "\n")
                self._log.configure(state=tk.DISABLED)
                self._log.see(tk.END)
                return
            elif "â†’" in text and "=" in text:
                parts = text.split("=", 1)
                cmd = parts[0].replace("â†’", "").strip()
                resp = parts[1].strip() if len(parts) > 1 else ""
                self._log.configure(state=tk.NORMAL)
                self._log.insert(tk.END, f"  -> {cmd}", "step")
                if resp:
                    self._log.insert(tk.END, f"  =  {resp}", "resp")
                self._log.insert(tk.END, "\n")
                self._log.configure(state=tk.DISABLED)
                self._log.see(tk.END)
                return
            elif ("->" in text or "â†’" in text) and "[OK]" in text:
                cmd = text.split("->")[-1] if "->" in text else text.split("â†’")[-1]
                display = f"  -> {cmd.replace('[OK]', '').strip()}  OK"
                tag = "success"
            elif "[STEP]" in text:
                display = text.replace("[STEP]", ">").strip()
                tag = "step"
            elif "[RESP]" in text:
                display = text.replace("[RESP]", "<").strip()
                tag = "resp"
            elif "[OK]" in text:
                tag = "success"
            elif "[ERR]" in text or "[ERROR]" in text:
                tag = "error"

            self._log.configure(state=tk.NORMAL)
            self._log.insert(tk.END, display + "\n", tag)
            self._log.configure(state=tk.DISABLED)
            self._log.see(tk.END)

    def log_request(self, method: str, path: str, status: int, detail: str):
        if self._mode == MODE_DEBUG:
            level = "request" if status < 400 else "error"
            self.log(f"{method} {path} -> {status}  {detail}", level)
            return

        text = _ANSI_RE.sub("", detail or "").strip()
        detail_lower = text.lower()

        if method == "GET" and path == "/vnc/status" and "running=" in detail_lower:
            return

        if status >= 400:
            self.log(f"ERROR  {text}", "error")
            return

        if (
            "action=send_scpi" in detail_lower
            or "[req] send_scpi" in detail_lower
            or detail_lower.startswith("send_scpi visa=")
        ):
            suffix = text.split("visa=", 1)[-1] if "visa=" in text else text
            self.log(f"Sent SCPI  {suffix}", "sent")
        elif (
            "action=capture_screenshot" in detail_lower
            or "[req] capture_screenshot" in detail_lower
            or detail_lower.startswith("capture_screenshot visa=")
        ):
            size = ""
            if "size=" in text:
                size = f" ({text.split('size=')[-1].split(' ')[0]})"
            self.log(f"Received screenshot{size}", "received")
        elif "action=run_python" in detail_lower or "[req] run_python" in detail_lower:
            self.log("Sent Python script", "sent")
        elif "action=disconnect" in detail_lower or "[req] disconnect" in detail_lower:
            self.log("Disconnected", "dim")
        elif "action=device_clear" in detail_lower or "[req] device_clear" in detail_lower:
            self.log("Sent device clear", "sent")
        else:
            self.log(f"Sent {text}", "sent")

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
        if self._mode == MODE_SUMMARY:
            self._mode = MODE_VERBOSE
        elif self._mode == MODE_VERBOSE:
            self._mode = MODE_SUMMARY
        else:
            self._mode = MODE_SUMMARY
        self._mode_btn.configure(text=MODE_LABELS[self._mode])
        self.log(f"Log mode: {MODE_LABELS[self._mode]}", "dim")
