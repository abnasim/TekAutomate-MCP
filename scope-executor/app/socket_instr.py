"""
Robust Socket methods for Tektronix instrument communication.
Handles binary waveform transfers and screenshot fetching over raw TCP sockets.

Based on socket_instr by Steve Guerrero (Tektronix).
Tested on MDO3000/4000C and 2/3/4/5(B)/6(B) series platform scopes.

PyVISA's socket backend cannot reliably handle binary block transfers
(screenshots, curve data). This module uses raw sockets for those cases.
"""

import re
import socket
import sys


class SocketInstr:
    """Raw TCP socket connection to a Tektronix instrument."""

    def __init__(self, host: str, port: int = 4000, timeout: float = 20):
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            self.socket.connect((host, port))
            self.socket.setblocking(False)
            self.socket.settimeout(timeout)
        except socket.error as msg:
            raise RuntimeError(f"Could not connect to {host}:{port}: {msg}")

    def set_timeout(self, timeout: float):
        """Update socket timeout (seconds)."""
        self.socket.settimeout(timeout)

    def close(self):
        try:
            self.socket.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        self.socket.close()

    def read(self) -> str:
        """Read ASCII response until newline."""
        try:
            resp = self.socket.recv(1048576)
            while resp[-1:] != b'\n':
                resp += self.socket.recv(1048576)
            return resp.decode('latin_1').strip()
        except socket.error as msg:
            raise RuntimeError(f"Socket recv failed: {msg}")

    def write(self, scpi: str):
        """Send SCPI command string."""
        try:
            self.socket.sendall(f'{scpi}\n'.encode('latin_1'))
        except socket.error as msg:
            raise RuntimeError(f"Socket send failed: {msg}")

    def query(self, scpi: str) -> str:
        """Write command and read ASCII response."""
        self.write(scpi)
        return self.read()

    def read_bytes(self, n_bytes: int) -> bytearray:
        """Read exact number of raw bytes."""
        raw_data = bytearray(n_bytes)
        mv = memoryview(raw_data)
        try:
            while n_bytes:
                c = self.socket.recv_into(mv, n_bytes)
                mv = mv[c:]
                n_bytes -= c
        except socket.error as msg:
            raise RuntimeError(f"Socket recv_bytes failed: {msg}")
        return raw_data

    def clear(self):
        """Device clear (supported instruments)."""
        self.write('!d')

    # ── Binary waveform transfer ──────────────────────────────────

    def read_bin_wave(self) -> bytes:
        """Read IEEE 488.2 binary block waveform data.

        Parses the #N<digits><data> header to determine byte count,
        then reads the exact number of data bytes.
        """
        # First 18 bytes contain the full binary block header in any case (tested to 1 Gpts)
        bin_header = self.read_bytes(18)
        byte_len = int(bin_header.decode('latin_1').strip()[1], base=16)
        num_bytes = int(bin_header.decode('latin_1').strip()[2:byte_len + 2])
        rem = bin_header[byte_len + 2:]

        wave_data = rem + self.read_bytes(num_bytes - len(rem) + 1)  # +1 for linefeed
        return bytes(wave_data[:-1])  # strip trailing linefeed

    # ── Screenshot fetch ──────────────────────────────────────────

    def dir_info(self) -> list:
        """Parse filesystem directory listing."""
        r = self.query('filesystem:ldir?')
        a = re.findall(r'[^,;"]+', r)
        return [a[i:i + 5] for i in range(0, len(a), 5)]

    def get_file_size(self, filename: str) -> int:
        """Get file size from scope filesystem."""
        r = self.dir_info()
        a = [i for i, x in enumerate(r) if x[0] == filename]
        if len(a) == 0:
            p = self.query('filesystem:cwd?')
            raise RuntimeError(f'File "{filename}" not found on scope (path: {p})')
        return int(r[a[0]][2])

    def fetch_screen(self, temp_file: str = "temp.png") -> bytes:
        """Save screenshot on scope, fetch it, then delete. Robust for 2/3/4/5(B)/6(B) series."""
        self.write(f'save:image "{temp_file}"')
        self.query('*opc?')
        size = self.get_file_size(temp_file)
        cmd = f'filesystem:readfile "{temp_file}"\n'
        self.socket.send(cmd.encode('latin_1'))
        self.socket.send(b'!r\n')  # Flag for scope read to buffer
        dat = self.read_bytes(size)
        r = self.socket.recv(512)
        if r != b'\n':
            raise RuntimeError('File bytes request did not end with linefeed — file likely corrupted')
        self.write(f'filesystem:delete "{temp_file}"')
        self.query('*opc?')
        return bytes(dat)
