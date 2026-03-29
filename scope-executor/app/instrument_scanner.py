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
            # Try default backend (NI-VISA) first, fall back to pyvisa-py
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

        resources = [r for r in all_resources if not r.upper().startswith("ASRL")]

        # TekScopePC/local VISA endpoints may be directly reachable even when
        # list_resources() returns nothing. Probe a few common fallbacks too.
        fallback_resources = [
            "TCPIP::127.0.0.1::INSTR",
            "TCPIP::localhost::INSTR",
            "TCPIP::127.0.0.1::4000::SOCKET",
            "TCPIP::127.0.0.1::5025::SOCKET",
        ]

        # Scan the local subnet for instruments on the LAN.
        # Uses fast TCP port 4000 probe (SCPI raw socket, ~100ms timeout)
        # to find reachable hosts before trying slow VISA open.
        try:
            import socket as _socket
            local_ip = _socket.gethostbyname(_socket.gethostname())
            if local_ip and not local_ip.startswith("127."):
                subnet = ".".join(local_ip.split(".")[:3])
                lan_hosts: list[str] = []

                def _probe_tcp(ip: str, port: int = 4000, timeout: float = 0.15) -> bool:
                    try:
                        s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
                        s.settimeout(timeout)
                        s.connect((ip, port))
                        s.close()
                        return True
                    except Exception:
                        return False

                # Parallel fast probe — check port 4000 (SCPI socket) on all /24 IPs
                import concurrent.futures
                def _check_ip(octet: int) -> str | None:
                    ip = f"{subnet}.{octet}"
                    if ip == local_ip:
                        return None
                    # Only probe port 4000 (SCPI raw socket) — port 80 catches routers/gateways
                    if _probe_tcp(ip, 4000):
                        return ip
                    return None

                with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
                    for result in pool.map(_check_ip, range(1, 255)):
                        if result:
                            lan_hosts.append(result)

                for host in lan_hosts:
                    candidate = f"TCPIP::{host}::INSTR"
                    if candidate not in resources and candidate not in fallback_resources:
                        fallback_resources.append(candidate)
        except Exception:
            pass

        for res in fallback_resources:
            if res not in resources:
                resources.append(res)

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
                # LAN instruments may need longer timeout for first connection
                is_lan = res.upper().startswith("TCPIP") and "127.0.0.1" not in res and "LOCALHOST" not in res.upper()
                probe_timeout = max(self._timeout_ms, 5000) if is_lan else self._timeout_ms
                try:
                    inst = rm.open_resource(res, timeout=probe_timeout)
                    idn = inst.query("*IDN?").strip()
                    inst.close()
                    info.identity = idn
                    info.manufacturer, info.model, info.serial, info.firmware = _parse_idn(idn)
                    info.reachable = True
                except Exception:
                    info.reachable = False
            else:
                info.reachable = True

            # Only show instruments that actually responded
            if not info.reachable:
                continue

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
