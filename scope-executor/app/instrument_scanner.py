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


def _is_valid_idn(idn: str) -> bool:
    """Check if *IDN? response looks like a real instrument (not HTTP/garbage)."""
    if not idn or len(idn) < 5:
        return False
    # Real IDN has comma-separated fields: MANUFACTURER,MODEL,SERIAL,FIRMWARE
    if idn.count(",") < 2:
        return False
    # Reject HTTP responses
    if "HTTP/" in idn or "<!DOCTYPE" in idn or "<html" in idn.lower():
        return False
    return True


def _extract_host(resource: str) -> str:
    """Extract host from VISA resource string."""
    parts = resource.split("::")
    return parts[1] if len(parts) > 1 else ""


class InstrumentScanThread(threading.Thread):
    def __init__(self, query_idn: bool = True, timeout_ms: int = 5000):
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
        try:
            import pyvisa_py  # noqa: F401
        except ImportError:
            pass

        # Use pyvisa with default backend (NI-VISA/TekVISA if installed, fallback to @py)
        rm = None
        all_resources: list[str] = []
        try:
            try:
                rm = pyvisa.ResourceManager()
            except Exception:
                rm = pyvisa.ResourceManager("@py")
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

        # Filter out serial ports
        resources = [r for r in all_resources if not r.upper().startswith("ASRL")]

        # Add localhost fallbacks if not already discovered
        fallback_resources = [
            "TCPIP::127.0.0.1::INSTR",
            "TCPIP::localhost::INSTR",
        ]
        for res in fallback_resources:
            if res not in resources:
                resources.append(res)

        # ── Dedup by (host, serial) to avoid showing same scope multiple times ──
        # TekVISA often returns the same scope via 127.0.0.1, localhost, and LAN IP
        count = 0
        seen_serials: dict[str, str] = {}  # serial → first resource shown
        seen_hosts: set[str] = set()
        socket_hosts_probed: set[str] = set()

        for res in resources:
            # Skip exact duplicates
            key = res.upper()
            if key.startswith("TCPIP"):
                host = _extract_host(res)
                host_key = host.upper()
                # Normalize localhost variants
                if host_key in ("127.0.0.1", "LOCALHOST", "0.0.0.0"):
                    host_key = "LOCALHOST"
            else:
                host_key = key

            info = InstrumentInfo(
                resource=res,
                conn_type=_parse_conn_type(res),
            )

            if self._query_idn:
                try:
                    inst = rm.open_resource(res, timeout=self._timeout_ms)
                    idn = inst.query("*IDN?").strip()
                    inst.close()
                    if not _is_valid_idn(idn):
                        continue  # Not a real instrument (HTTP server, router, etc.)
                    info.identity = idn
                    info.manufacturer, info.model, info.serial, info.firmware = _parse_idn(idn)
                    info.reachable = True
                except Exception:
                    continue  # Unreachable — skip entirely
            else:
                info.reachable = True

            # Dedup by serial number — same scope via different addresses
            if info.serial:
                existing = seen_serials.get(info.serial)
                if existing:
                    # Prefer INSTR over SOCKET, prefer LAN IP over localhost
                    existing_is_socket = "SOCKET" in existing.upper()
                    new_is_socket = "SOCKET" in res.upper()
                    existing_is_localhost = any(x in existing.upper() for x in ("127.0.0.1", "LOCALHOST"))
                    new_is_localhost = any(x in res.upper() for x in ("127.0.0.1", "LOCALHOST"))
                    # Skip if this is a worse variant of an already-shown instrument
                    if not (existing_is_localhost and not new_is_localhost):
                        continue
                seen_serials[info.serial] = res

            self.instrument_found.emit(info)
            count += 1

            # For each reachable TCPIP INSTR host, also probe socket port
            if info.reachable and res.upper().startswith("TCPIP") and "SOCKET" not in res.upper():
                host = _extract_host(res)
                if host and host not in socket_hosts_probed:
                    socket_hosts_probed.add(host)
                    sock_res = f"TCPIP::{host}::4000::SOCKET"
                    if sock_res not in resources:
                        sock_info = InstrumentInfo(
                            resource=sock_res,
                            conn_type="tcpip",
                        )
                        try:
                            inst = rm.open_resource(sock_res, timeout=self._timeout_ms)
                            idn = inst.query("*IDN?").strip()
                            inst.close()
                            if _is_valid_idn(idn):
                                sock_info.identity = idn
                                sock_info.manufacturer, sock_info.model, sock_info.serial, sock_info.firmware = _parse_idn(idn)
                                sock_info.reachable = True
                                # Only show socket if different serial (shouldn't happen, but safety check)
                                if sock_info.serial and sock_info.serial not in seen_serials:
                                    seen_serials[sock_info.serial] = sock_res
                                    self.instrument_found.emit(sock_info)
                                    count += 1
                        except Exception:
                            pass

        self.scan_finished.emit(count)
