"""
Plugin status bar – shows which packages are available in the .venv
(the environment that actually executes scope scripts).
Tkinter port of the original PySide6 version.
"""

import os
import sys
import subprocess
import tkinter as tk
from tkinter import ttk

# ── palette ──────────────────────────────────────────────────────────
SURFACE  = "#1E1E1E"
GREEN    = "#5a9a6a"
RED      = "#a05050"
WARN     = "#a08030"

PLUGINS = [
    ("pyvisa",     "pyvisa"),
    ("pyvisa-py",  "pyvisa_py"),
    ("tm_devices", "tm_devices"),
    ("tekhsi",     "tekhsi"),
    ("qrcode",     "qrcode"),
    ("Pillow",     "PIL"),
]


def _find_venv_python() -> str | None:
    """Same logic as code_runner — find the .venv python next to the EXE."""
    candidates = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.append(os.path.join(exe_dir, ".venv", "Scripts", "python.exe"))
        candidates.append(os.path.join(os.path.dirname(exe_dir), ".venv", "Scripts", "python.exe"))
        argv0_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
        candidates.append(os.path.join(argv0_dir, ".venv", "Scripts", "python.exe"))
        candidates.append(os.path.join(os.path.dirname(argv0_dir), ".venv", "Scripts", "python.exe"))
    else:
        src_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates.append(os.path.join(src_dir, ".venv", "Scripts", "python.exe"))
    candidates.append(os.path.join(os.getcwd(), ".venv", "Scripts", "python.exe"))

    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


def _check_plugins_direct() -> dict[str, bool]:
    """Check imports directly in the current process (frozen EXE mode)."""
    import importlib
    import traceback
    results = {}
    for _, import_name in PLUGINS:
        try:
            importlib.import_module(import_name)
            results[import_name] = True
        except Exception as e:
            results[import_name] = False
            # Log the error for debugging
            try:
                err_path = os.path.join(os.path.dirname(sys.executable), "plugin_errors.log")
                with open(err_path, "a") as f:
                    f.write(f"\n--- {import_name} ---\n")
                    traceback.print_exc(file=f)
            except Exception:
                pass
    return results


def _check_venv_plugins() -> dict[str, bool]:
    """
    Check all plugins. In frozen EXE mode, imports are checked directly
    (all modules are bundled). In source mode, uses .venv subprocess.
    """
    # Frozen EXE — all modules are bundled, check directly
    if getattr(sys, "frozen", False):
        return _check_plugins_direct()

    # Source mode — check via .venv subprocess
    venv_py = _find_venv_python()
    results = {import_name: False for _, import_name in PLUGINS}

    if not venv_py:
        return results

    script = (
        "import json; results = {}; "
        + "; ".join(
            f"exec(\"try:\\n import {imp}\\n results['{imp}']=True\\nexcept: results['{imp}']=False\")"
            for _, imp in PLUGINS
        )
        + "; print(json.dumps(results))"
    )

    try:
        out = subprocess.check_output(
            [venv_py, "-c", script],
            timeout=10, stderr=subprocess.DEVNULL, text=True
        ).strip()
        import json
        data = json.loads(out)
        for _, imp in PLUGINS:
            results[imp] = bool(data.get(imp, False))
    except Exception:
        pass

    return results


class PluginBar(ttk.Frame):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._labels: dict[str, ttk.Label] = {}
        self._frozen = getattr(sys, "frozen", False)
        self._venv_found = self._frozen or _find_venv_python() is not None

        if not self._venv_found:
            warn = ttk.Label(self, text="\u26a0 .venv not found \u2013 run run.bat first",
                             font=("Consolas", 8), foreground=WARN)
            warn.pack(side=tk.LEFT, padx=6)
        else:
            results = _check_venv_plugins()
            for display_name, import_name in PLUGINS:
                ok = results.get(import_name, False)
                tag = self._make_tag(display_name, ok)
                tag.pack(side=tk.LEFT, padx=6)
                self._labels[display_name] = tag

    def _make_tag(self, name: str, ok: bool) -> ttk.Label:
        color = GREEN if ok else RED
        icon = "\u2022" if ok else "\u2717"
        lbl = ttk.Label(self, text=f"{icon} {name}",
                         font=("Consolas", 8), foreground=color)
        return lbl
