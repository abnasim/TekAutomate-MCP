"""
Thread-safe signal system for Tkinter, replacing PySide6.QtCore.Signal.
Callbacks connected to a TkSignal are always invoked on the main thread.
"""
import threading

_tk_root = None


def set_tk_root(root):
    """Set the Tkinter root window for thread-safe callbacks."""
    global _tk_root
    _tk_root = root


def get_tk_root():
    return _tk_root


class TkSignal:
    """Drop-in replacement for PySide6 Signal.
    Callbacks are always invoked on the Tkinter main thread via root.after_idle()."""

    def __init__(self):
        self._callbacks = []

    def connect(self, callback):
        self._callbacks.append(callback)

    def disconnect(self, callback=None):
        if callback:
            try:
                self._callbacks.remove(callback)
            except ValueError:
                pass
        else:
            self._callbacks.clear()

    def emit(self, *args):
        root = _tk_root
        for cb in list(self._callbacks):
            if root:
                root.after_idle(_safe_call, cb, args)
            else:
                cb(*args)


def _safe_call(cb, args):
    try:
        cb(*args)
    except Exception as e:
        print(f"[tk_utils] Signal callback error: {e}", flush=True)
