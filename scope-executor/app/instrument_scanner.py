"""
VISA instrument discovery. Runs pyvisa.ResourceManager().list_resources()
in a background thread and optionally queries *IDN? for identification.
"""

import json
import os
import threading
from dataclasses import dataclass, field

from app.tk_utils import TkSignal

_PINNED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pinned_instruments.json")
_SCAN_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scan_cache.json")


def _load_pinned_resources() -> list[str]:
    try:
        with open(_PINNED_FILE, "r") as f:
            data = json.load(f)
        return [str(r) for r in data if r]
    except Exception:
        return []


def _save_pinned_resources(resources: list[str]):
    try:
        with open(_PINNED_FILE, "w") as f:
            json.dump(resources, f, indent=2)
    except Exception:
        pass


def load_scan_cache() -> list[dict]:
    """Load the last successful scan result from disk. Returns list of instrument dicts."""
    try:
        with open(_SCAN_CACHE_FILE, "r") as f:
            data = json.load(f)
        return [d for d in data if isinstance(d, dict) and d.get("resource")]
    except Exception:
        return []


def save_scan_cache(instruments: list["InstrumentInfo"]):
    """Persist the current scan results to disk for instant load on next startup."""
    try:
        data = [
            {
                "resource": i.resource,
                "identity": i.identity,
                "manufacturer": i.manufacturer,
                "model": i.model,
                "serial": i.serial,
                "firmware": i.firmware,
                "reachable": i.reachable,
                "conn_type": i.conn_type,
            }
            for i in instruments
        ]
        with open(_SCAN_CACHE_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass


def pin_resource(resource: str):
    """Add a VISA resource string to the persistent pinned list."""
    existing = _load_pinned_resources()
    if resource not in existing:
        existing.append(resource)
        _save_pinned_resources(existing)


def unpin_resource(resource: str):
    """Remove a VISA resource string from the persistent pinned list."""
    existing = _load_pinned_resources()
    if resource in existing:
        existing.remove(resource)
        _save_pinned_resources(existing)


def ip_to_visa_resources(host: str) -> list[str]:
    """Build VISA resource strings for a given host IP or host:port string.

    Accepts:
      "192.168.1.138"       → [TCPIP::192.168.1.138::INSTR, TCPIP::192.168.1.138::4000::SOCKET]
      "192.168.1.138:4000"  → [TCPIP::192.168.1.138::4000::SOCKET]  (port given → socket only)
      "192.168.1.138:0"     → [TCPIP::192.168.1.138::INSTR]          (port 0 → INSTR only)
    """
    host = host.strip()
    # Detect host:port format (exclude IPv6 which has colons too, but those aren't common here)
    port: str | None = None
    if ":" in host and not host.startswith("TCPIP"):
        parts = host.rsplit(":", 1)
        if parts[1].isdigit():
            host, port = parts[0].strip(), parts[1].strip()

    if port is not None:
        port_int = int(port)
        if port_int == 0:
            return [f"TCPIP::{host}::INSTR"]
        return [f"TCPIP::{host}::{port_int}::SOCKET"]

    return [
        f"TCPIP::{host}::INSTR",
        f"TCPIP::{host}::4000::SOCKET",
    ]


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

        # Add any user-pinned IPs from config
        for res in _load_pinned_resources():
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

            is_socket_res = "SOCKET" in key

            info = InstrumentInfo(
                resource=res,
                conn_type=_parse_conn_type(res),
            )

            if self._query_idn:
                idn = None
                # For SOCKET resources use raw TCP (SocketInstr) — pyvisa SOCKET
                # open_resource often fails for Tek scopes on port 4000
                if is_socket_res:
                    try:
                        from app.socket_instr import SocketInstr
                        parts = res.split("::")
                        s_host = parts[1] if len(parts) > 1 else "127.0.0.1"
                        s_port = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 4000
                        sock = SocketInstr(s_host, s_port, timeout=self._timeout_ms / 1000.0)
                        idn = sock.query("*IDN?").strip()
                        sock.close()
                    except Exception:
                        pass
                    # Fallback: try pyvisa anyway
                    if not idn or not _is_valid_idn(idn):
                        try:
                            inst = rm.open_resource(res, timeout=self._timeout_ms)
                            idn = inst.query("*IDN?").strip()
                            inst.close()
                        except Exception:
                            pass
                else:
                    try:
                        inst = rm.open_resource(res, timeout=self._timeout_ms)
                        idn = inst.query("*IDN?").strip()
                        inst.close()
                    except Exception:
                        pass

                if not idn or not _is_valid_idn(idn):
                    continue  # Not a real instrument (HTTP server, router, etc.)
                info.identity = idn
                info.manufacturer, info.model, info.serial, info.firmware = _parse_idn(idn)
                info.reachable = True
            else:
                info.reachable = True

            # Dedup by serial number — same scope via different addresses.
            # IMPORTANT: INSTR and SOCKET are different connection types — always show both.
            # Only dedup within the same type (INSTR vs INSTR, SOCKET vs SOCKET).
            if info.serial:
                # Build a per-type dedup key so INSTR and SOCKET are tracked separately
                type_key = (info.serial, "socket" if is_socket_res else "instr")
                existing = seen_serials.get(type_key)
                if existing:
                    # Prefer LAN IP over localhost variant of the same type
                    existing_is_localhost = any(x in existing.upper() for x in ("127.0.0.1", "LOCALHOST"))
                    new_is_localhost = any(x in res.upper() for x in ("127.0.0.1", "LOCALHOST"))
                    if not (existing_is_localhost and not new_is_localhost):
                        continue
                seen_serials[type_key] = res

            self.instrument_found.emit(info)
            count += 1

            # For each reachable TCPIP INSTR host, also probe socket port.
            # INSTR and SOCKET are different connection types — show both.
            if info.reachable and res.upper().startswith("TCPIP") and not is_socket_res:
                host = _extract_host(res)
                if host and host not in socket_hosts_probed:
                    socket_hosts_probed.add(host)
                    sock_res = f"TCPIP::{host}::4000::SOCKET"
                    if sock_res not in resources:
                        sock_info = InstrumentInfo(resource=sock_res, conn_type="tcpip")
                        sock_idn = None
                        # Try raw TCP first (most reliable for Tek scopes)
                        try:
                            from app.socket_instr import SocketInstr
                            sock = SocketInstr(host, 4000, timeout=self._timeout_ms / 1000.0)
                            sock_idn = sock.query("*IDN?").strip()
                            sock.close()
                        except Exception:
                            pass
                        # Fallback to pyvisa
                        if not sock_idn or not _is_valid_idn(sock_idn):
                            try:
                                inst = rm.open_resource(sock_res, timeout=self._timeout_ms)
                                sock_idn = inst.query("*IDN?").strip()
                                inst.close()
                            except Exception:
                                pass
                        if sock_idn and _is_valid_idn(sock_idn):
                            sock_info.identity = sock_idn
                            sock_info.manufacturer, sock_info.model, sock_info.serial, sock_info.firmware = _parse_idn(sock_idn)
                            sock_info.reachable = True
                            self.instrument_found.emit(sock_info)
                            count += 1

        self.scan_finished.emit(count)
