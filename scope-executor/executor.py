#!/usr/bin/env python3
"""
Tek Automate Executor – Tkinter + TKinterModernThemes entry point.
No PySide6/PyQt dependency. Pure Tkinter with sun-valley dark theme.
"""
import os
import sys
import ctypes

APP_USER_MODEL_ID = "TekAutomate.Executor"

# ── IMPORTANT: Check for --worker BEFORE any imports that might create parsers ──
if "--worker" in sys.argv:
    # Worker mode: run the persistent worker loop (no GUI)
    # Import worker directly to avoid any GUI/TkinterModernThemes initialization
    _HERE = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, _HERE)
    from app.worker import main as worker_main
    worker_main()
    sys.exit(0)

# ── path setup ────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)


def _log(msg: str):
    if sys.stdout:
        print(msg, flush=True)


def _set_dark_title_bar(root):
    """Tell Windows to use dark title bar chrome."""
    try:
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
        DWMWA_USE_IMMERSIVE_DARK_MODE = 20
        ctypes.windll.dwmapi.DwmSetWindowAttribute(
            hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE,
            ctypes.byref(ctypes.c_int(1)), ctypes.sizeof(ctypes.c_int))
    except Exception:
        pass


def _set_windows_app_id():
    """Use a stable AppUserModelID so Windows groups and icons stay consistent."""
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_USER_MODEL_ID)
    except Exception:
        pass


def main():
    if sys.stdout:
        sys.stdout.reconfigure(line_buffering=True)

    _set_windows_app_id()

    import TKinterModernThemes as TKMT
    from app.tk_utils import set_tk_root
    from app.main_window import MainWindow

    _log("[executor] Creating themed app (sun-valley dark)...")

    class App(TKMT.ThemedTKinterFrame):
        def __init__(self):
            super().__init__("Tek Automate Executor", "sun-valley", "dark",
                             usecommandlineargs=False, useconfigfile=False)

            # Register root for thread-safe signals
            set_tk_root(self.root)

            # Dark title bar on Windows
            self.root.update()
            _set_dark_title_bar(self.root)
            self.root.update_idletasks()

            self.root.geometry("960x560")
            self.root.minsize(720, 420)

            # Set icon (after TKMT init so it doesn't get overwritten)
            assets = os.path.join(os.path.dirname(__file__), "app", "assets")
            ico = os.path.join(assets, "logo.ico")
            png = os.path.join(assets, "logo.png")
            try:
                from PIL import Image, ImageTk
                # Use .ico or .png — iconphoto sets BOTH title bar and taskbar
                icon_path = ico if os.path.isfile(ico) else png
                if os.path.isfile(icon_path):
                    img = Image.open(icon_path)
                    # Multiple sizes for Windows taskbar + title bar
                    self._icon_photos = [
                        ImageTk.PhotoImage(img.resize((s, s)))
                        for s in (16, 32, 48, 64, 128, 256)
                        if s <= max(img.size)
                    ]
                    if self._icon_photos:
                        self.root.iconphoto(True, *self._icon_photos)
                        if os.path.isfile(ico):
                            try:
                                self.root.iconbitmap(default=ico)
                            except Exception:
                                pass
                        _log(f"[executor] Icon set from {icon_path}")
            except Exception as e:
                _log(f"[executor] Icon error: {e}")
                if os.path.isfile(ico):
                    try:
                        self.root.iconbitmap(default=ico)
                    except Exception:
                        pass

            _log("[executor] Creating MainWindow...")
            self._window = MainWindow(self.root, self.master)

            _log("[executor] Window visible. Starting event loop.")
            self.run()

    App()


if __name__ == "__main__":
    main()
