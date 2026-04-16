"""
System tray icon with status, context menu, and minimize-to-tray behaviour.
Uses pystray (pure Python) instead of Qt's QSystemTrayIcon.
"""

import os
import threading

from app.tk_utils import TkSignal

GREEN  = "#00c853"
ACCENT = "#FFD700"
RED    = "#ff4444"
DIM    = "#666666"


def _make_dot_image(color: str, size: int = 64):
    """Create a colored dot icon as a PIL Image."""
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Parse hex color
        c = color.lstrip("#")
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        draw.ellipse([4, 4, size - 4, size - 4], fill=(r, g, b, 255))
        return img
    except ImportError:
        return None


class SystemTray:
    show_requested = None
    scan_requested = None
    quit_requested = None

    def __init__(self, parent=None):
        self.show_requested = TkSignal()
        self.scan_requested = TkSignal()
        self.quit_requested = TkSignal()

        self._icon = None
        self._thread = None
        self._logo_image = None
        self._status = "starting"

        # Load logo
        logo_path = os.path.join(os.path.dirname(__file__), "assets", "logo.ico")
        if not os.path.isfile(logo_path):
            logo_path = os.path.join(os.path.dirname(__file__), "assets", "logo.png")

        try:
            from PIL import Image
            if os.path.isfile(logo_path):
                self._logo_image = Image.open(logo_path)
                # Ensure it's a reasonable size for tray
                self._logo_image = self._logo_image.resize((64, 64))
            else:
                self._logo_image = _make_dot_image(ACCENT)
        except ImportError:
            self._logo_image = None

    def show(self):
        """Show the system tray icon."""
        if self._logo_image is None:
            return  # Can't show tray without PIL

        try:
            import pystray
        except ImportError:
            print("[tray] pystray not installed, skipping system tray", flush=True)
            return

        menu = pystray.Menu(
            pystray.MenuItem("Show", self._on_show, default=True),
            pystray.MenuItem("Scan Instruments", self._on_scan),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._on_quit),
        )

        self._icon = pystray.Icon(
            "tek_automate",
            self._logo_image,
            "Tek Automate Executor - starting...",
            menu,
        )

        # Run pystray in a background thread
        self._thread = threading.Thread(target=self._icon.run, daemon=True)
        self._thread.start()

    def hide(self):
        if self._icon:
            try:
                self._icon.stop()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            try:
                self._thread.join(timeout=2.0)
            except Exception:
                pass
        self._thread = None

    def set_status(self, status: str, host: str = "", port: int = 0):
        self._status = status
        if self._icon:
            tip = "Tek Automate Executor"
            if host and port:
                tip += f" - {host}:{port}"
            tip += f" [{status}]"
            self._icon.title = tip

            # Update icon based on status
            if status == "ready" and self._logo_image:
                self._icon.icon = self._logo_image
            else:
                colors = {"busy": ACCENT, "error": RED}
                dot = _make_dot_image(colors.get(status, DIM))
                if dot:
                    self._icon.icon = dot

    def _on_show(self, icon=None, item=None):
        self.show_requested.emit()

    def _on_scan(self, icon=None, item=None):
        self.scan_requested.emit()

    def _on_quit(self, icon=None, item=None):
        self.quit_requested.emit()
