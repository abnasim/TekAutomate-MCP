"""
VISA instrument discovery. Runs pyvisa.ResourceManager().list_resources()
in a background thread and optionally queries *IDN? for identification.
"""

import threading
from dataclasses import dataclass, field

from app.tk_utils import TkSignal


@dataclass
class InstrumentInfo:
    resource: str = ""
    identity: str = ""        # raw *IDN? response
    manufacturer: str = ""
    model: str = ""
    serial: str = ""
    firmware: str = ""
    reachable: bool = False
    conn_type: str = "unknown"  # tcpip | usb | gpib | serial

    @property
    def display_name(self) -> str:
        if self.model:
            return f"{self.manufacturer} {self.model}".strip()
        return self.resource


def _parse_conn_type(resource: str) -> str:
    r = resource.upper()
    if r.startswith("TCPIP"):
        return "tcpip"
    if r.startswith("USB"):
        return "usb"
    if r.startswith("GPIB"):
        return "gpib"
    if r.startswith("ASRL"):
        return "serial"
    return "unknown"


def _parse_idn(idn: str) -> tuple[str, str, str, str]:
    parts = [p.strip() for p in idn.split(",")]
    while len(parts) < 4:
        parts.append("")
    return parts[0], parts[1], parts[2], parts[3]


class InstrumentScanThread(threading.Thread):
    def __init__(self, query_idn: bool = True, timeout_ms: int = 3000):
        super().__init__(daemon=True)
        self._query_idn = query_idn
        self._timeout_ms = timeout_ms

        # Signals (thread-safe via TkSignal)
        self.scan_started = TkSignal()
        self.instrument_found = TkSignal()  # InstrumentInfo
        self.scan_finished = TkSignal()     # total count
        self.scan_error = TkSignal()        # error string

    def run(self):
        self.scan_started.emit()
        try:
            import pyvisa
        except ImportError as e:
            self.scan_error.emit(f"PyVISA not installed: {e}")
            self.scan_finished.emit(0)
            return

        # Pre-import pyvisa-py so it registers even in frozen EXE
        # (PyInstaller breaks entry_points discovery)
        try:
            import pyvisa_py  # noqa: F401
        except ImportError:
            pass

        # Use pyvisa with default backend (NI-VISA if installed, otherwise system default)
        rm = None
        all_resources: list[str] = []
        try:
            rm = pyvisa.ResourceManager()
            for query in ("?*::INSTR", "?*::SOCKET"):
                try:
                    all_resources.extend(rm.list_resources(query))
                except Exception:
                    pass
            if not all_resources:
                try:
                    all_resources = list(rm.list_resources("?*"))
                except Exception:
                    pass
        except Exception as e:
            self.scan_error.emit(f"VISA backend error: {e}")
            self.scan_finished.emit(0)
            return

        resources = [r for r in all_resources if not r.upper().startswith("ASRL")]

        # Deduplicate: same host+type seen via multiple network interfaces.
        seen: set[str] = set()
        unique: list[str] = []
        for res in resources:
            key = res.upper()
            if key.startswith("TCPIP"):
                parts = key.split("::")
                host = parts[1] if len(parts) > 1 else ""
                suffix = parts[-1] if len(parts) > 2 else "INSTR"
                dedup_key = f"{host}::{suffix}"
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
            elif key in seen:
                continue
            else:
                seen.add(key)
            unique.append(res)

        count = 0
        socket_hosts_probed: set[str] = set()

        for res in unique:
            info = InstrumentInfo(
                resource=res,
                conn_type=_parse_conn_type(res),
            )
            if self._query_idn:
                try:
                    inst = rm.open_resource(res, timeout=self._timeout_ms)
                    idn = inst.query("*IDN?").strip()
                    inst.close()
                    info.identity = idn
                    info.manufacturer, info.model, info.serial, info.firmware = _parse_idn(idn)
                    info.reachable = True
                except Exception:
                    info.reachable = False
            else:
                info.reachable = True

            self.instrument_found.emit(info)
            count += 1

            # For each reachable TCPIP INSTR host, probe socket ports too
            if info.reachable and res.upper().startswith("TCPIP"):
                parts = res.split("::")
                host = parts[1] if len(parts) > 1 else ""
                if host and host not in socket_hosts_probed:
                    socket_hosts_probed.add(host)
                    for port in (4000, 5025):
                        sock_res = f"TCPIP::{host}::{port}::SOCKET"
                        sock_info = InstrumentInfo(
                            resource=sock_res,
                            conn_type="tcpip",
                        )
                        try:
                            inst = rm.open_resource(sock_res, timeout=self._timeout_ms)
                            idn = inst.query("*IDN?").strip()
                            inst.close()
                            sock_info.identity = idn
                            sock_info.manufacturer, sock_info.model, sock_info.serial, sock_info.firmware = _parse_idn(idn)
                            sock_info.reachable = True
                        except Exception:
                            sock_info.reachable = False
                        if sock_info.reachable:
                            self.instrument_found.emit(sock_info)
                            count += 1

        self.scan_finished.emit(count)
