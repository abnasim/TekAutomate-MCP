"""
================================================================================
TEKTRONIX SCREENSHOT CAPTURE - COMPLETE REFERENCE
================================================================================

Author: Abdul (Tektronix AE)
Date: January 2026

This document provides VERIFIED WORKING code for capturing screenshots from
Tektronix oscilloscopes across different series.

TESTED SCOPES:
- MSO68B FW 2.20.8 ✓
- MSO73304DX FW 10.14.1 ✓
- TekscopeSW FW 2.16.9 ✓

================================================================================
SCOPE FAMILY COMMAND SUMMARY
================================================================================

┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
│ Feature                 │ MSO 4/5/6 Series        │ MSO/DPO 70000 Series    │
│                         │ (MSO44/54/58/64/68B)    │ (MSO73304DX, etc)       │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Trigger Screenshot      │ SAVE:IMAGe "path.png"   │ EXPort:FILEName "path"  │
│                         │                         │ EXPort START            │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Set Format              │ Extension in filename   │ EXPort:FORMat PNG       │
│                         │ (.png, .bmp, .jpg)      │                         │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Set View                │ SAVE:IMAGe:VIEWTYpe     │ EXPort:VIEW FULLSCREEN  │
│                         │ FULLScreen              │                         │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Set Colors              │ SAVE:IMAGe:COMPosition  │ EXPort:PALEtte COLOR    │
│                         │ NORMal                  │                         │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Transfer File           │ FILESystem:READFile     │ FILESystem:READFile     │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Binary Format           │ Raw PNG bytes           │ Raw PNG bytes           │
│                         │ (no IEEE header)        │ (no IEEE header)        │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Working Directory       │ C:/Users/Public/        │ C:/TekScope             │
│                         │ Tektronix/TekScope      │                         │
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ Tested Firmware         │ FV:2.20.8 (MSO68B)      │ FV:10.14.1 (MSO73304DX) │
│                         │ FV:2.16.9 (TekscopeSW)  │                         │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘

================================================================================
MSO 4/5/6 SERIES - VERIFIED WORKING COMMANDS
================================================================================

Tested on: MSO68B FW 2.20.8, TekscopeSW FW 2.16.9

WORKING COMMANDS:
-----------------
✓ SAVE:IMAGe "C:/Temp/file.png"     -> Saves screenshot (format from extension)
✓ SAVE:IMAGe:COMPosition?           -> Returns NORMAL or INVERTED
✓ SAVE:IMAGe:COMPosition NORMal     -> Set normal colors
✓ SAVE:IMAGe:COMPosition INVErted   -> Set inverted colors
✓ SAVE:IMAGe:VIEWTYpe?              -> Returns FULLSCREEN
✓ SAVE:IMAGe:VIEWTYpe FULLScreen    -> Set full screen capture
✓ FILESystem:CWD?                   -> Returns current directory
✓ FILESystem:READFile "path"        -> Transfer file (returns raw binary)
✓ FILESystem:DELEte "path"          -> Delete file
✓ *OPC?                             -> Returns 1 when SAVE:IMAGe completes

NOT WORKING (Command not found):
--------------------------------
✗ SAVE:IMAGe:FILEFormat?            -> Use extension in filename instead
✗ SAVE:IMAGe:FILEFormat PNG         -> Use extension in filename instead
✗ SAVE:IMAGe:INKSaver?              -> Not supported
✗ SAVE:IMAGe:INKSaver OFF           -> Not supported
✗ SAVE:IMAGe:LAYout?                -> Not supported
✗ EXPort commands                   -> Use SAVE:IMAGe instead
✗ HARDCopy commands                 -> Use SAVE:IMAGe instead

SCREENSHOT FLOW (MSO 4/5/6):
----------------------------
1. SAVE:IMAGe:VIEWTYpe FULLScreen       (optional - set view)
2. SAVE:IMAGe:COMPosition NORMal        (optional - set colors)
3. SAVE:IMAGe "C:/Temp/screenshot.png"  (trigger - format from extension!)
4. *OPC?                                 (wait for completion)
5. FILESystem:READFile "C:/Temp/screenshot.png"  (transfer)
6. FILESystem:DELEte "C:/Temp/screenshot.png"    (cleanup)

================================================================================
MSO/DPO 70000 SERIES - VERIFIED WORKING COMMANDS  
================================================================================

Tested on: MSO73304DX FW 10.14.1

WORKING COMMANDS:
-----------------
✓ EXPort?                           -> Returns all settings
✓ EXPort:FILEName "path"            -> Set output path
✓ EXPort:FILEName?                  -> Query output path
✓ EXPort:FORMat PNG                 -> Set format (PNG/BMP/TIFF/JPEG)
✓ EXPort:FORMat?                    -> Query format
✓ EXPort:VIEW FULLSCREEN            -> Set view mode
✓ EXPort:VIEW?                      -> Query view mode
✓ EXPort:PALEtte COLOR              -> Set palette (COLOR/BLACKWHITE)
✓ EXPort:PALEtte?                   -> Query palette
✓ EXPort START                      -> Trigger screenshot!
✓ HARDCopy START                    -> Alternative trigger
✓ FILESystem:CWD?                   -> Returns "C:/TekScope"
✓ FILESystem:READFile "path"        -> Transfer file (raw binary)
✓ FILESystem:DELEte "path"          -> Delete file
✓ *OPC?                             -> Returns 1 when complete

NOT WORKING:
------------
✗ SAVE:IMAGe "path"                 -> Use EXPort instead
✗ SAVE:IMAGe:FILEFormat             -> Use EXPort:FORMat instead
✗ HARDCopy:DATA?                    -> Not supported
✗ EXPort (no parameter)             -> Must use "EXPort START"
✗ EXPort:STARt                      -> Case sensitive! Use "START"

SCREENSHOT FLOW (MSO/DPO 70000):
--------------------------------
1. EXPort:FILEName "C:/TekScope/screenshot.png"   (set path)
2. EXPort:FORMat PNG                              (set format)
3. EXPort:VIEW FULLSCREEN                         (set view)
4. EXPort:PALEtte COLOR                           (set colors)
5. EXPort START                                   (trigger!)
6. *OPC?                                          (wait for completion)
7. FILESystem:READFile "C:/TekScope/screenshot.png"  (transfer)
8. FILESystem:DELEte "C:/TekScope/screenshot.png"    (cleanup)

================================================================================
BINARY DATA TRANSFER NOTES
================================================================================

CRITICAL: Both scope families return RAW BINARY data from FILESystem:READFile
- NO IEEE 488.2 block header (#<n><length><data>)
- Just pure image bytes (PNG/BMP/JPEG)
- PNG files start with magic bytes: 89 50 4E 47 0D 0A 1A 0A

PyVISA BINARY READ METHOD:
--------------------------
The standard scope.read_raw() may timeout because it waits for termination.
Use visalib.read() directly with status code checking:

    image_data = bytearray()
    scope.timeout = 5000  # 5 second chunks
    
    while True:
        try:
            chunk, status = scope.visalib.read(scope.session, 65536)
            if chunk:
                image_data.extend(bytes(chunk))
            
            # Check if transfer complete
            if status != pyvisa.constants.StatusCode.success_max_count_read:
                break
        except pyvisa.errors.VisaIOError:
            break

RAW SOCKET BINARY READ METHOD:
------------------------------
Read in chunks with timeout to detect end of transfer:

    sock.settimeout(5)  # 5 second chunks
    data = bytearray()
    
    while True:
        try:
            chunk = sock.recv(65536)
            if chunk:
                data.extend(chunk)
            else:
                break
        except socket.timeout:
            if len(data) > 0:
                break  # Got data, transfer complete

================================================================================
UNIFIED PYTHON IMPLEMENTATION
================================================================================
"""

import socket
import time
from datetime import datetime


def detect_scope_series(idn_string):
    """
    Detect scope series from *IDN? response.
    
    Args:
        idn_string: Response from *IDN? query
        
    Returns:
        'mso456' - MSO 4/5/6 series (use SAVE:IMAGe)
        'mso70k' - MSO/DPO 70000 series (use EXPort START)
        'unknown' - Unknown scope (try mso456 method)
    
    Examples:
        >>> detect_scope_series("TEKTRONIX,MSO68B,B012682,CF:91.1CT FV:2.20.8")
        'mso456'
        
        >>> detect_scope_series("TEKTRONIX,MSO73304DX,PQ00022,CF:91.1CT FV:10.14.1")
        'mso70k'
    """
    idn_upper = idn_string.upper()
    parts = idn_upper.split(',')
    
    if len(parts) < 2:
        return 'unknown'
    
    model = parts[1].strip()
    
    # MSO70000 / DPO70000 series: MSO7xxxx, DPO7xxxx
    # Examples: MSO70404C, MSO72004C, MSO73304DX, DPO70404C
    if model.startswith('MSO7') or model.startswith('DPO7'):
        return 'mso70k'
    
    # MSO 4/5/6 series: MSO44, MSO54, MSO58, MSO64, MSO68, etc.
    # Also includes B variants: MSO44B, MSO58B, MSO68B
    # Also TekscopeSW (software simulator)
    if (model.startswith('MSO4') or model.startswith('MSO5') or 
        model.startswith('MSO6') or 'TEKSCOPESW' in idn_upper):
        return 'mso456'
    
    return 'unknown'


def capture_screenshot(host, port=4000, filename=None, format="PNG"):
    """
    Universal screenshot capture for all Tektronix oscilloscopes.
    
    Automatically detects scope series and uses appropriate commands:
    - MSO 4/5/6 Series: Uses SAVE:IMAGe "path"
    - MSO/DPO 70000 Series: Uses EXPort START
    
    Args:
        host: IP address of scope (e.g., "192.168.1.10")
        port: Socket port (default 4000)
        filename: Local output filename (auto-generated if None)
        format: Image format - PNG, BMP, JPEG (or JPG)
    
    Returns:
        str: Path to saved screenshot, or None on failure
    
    Tested on:
        - MSO68B FW 2.20.8 ✓
        - MSO73304DX FW 10.14.1 ✓
        - TekscopeSW FW 2.16.9 ✓
    
    Example:
        >>> capture_screenshot("192.168.1.10")
        'scope_screenshot_20260128_161234.png'
        
        >>> capture_screenshot("192.168.1.10", filename="my_capture.png")
        'my_capture.png'
        
        >>> capture_screenshot("127.0.0.1", format="BMP")
        'scope_screenshot_20260128_161234.bmp'
    """
    print(f"\n{'='*60}")
    print(f"Tektronix Screenshot Capture")
    print(f"{'='*60}")
    print(f"[INFO] Connecting to {host}:{port}...")
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(30)
    
    try:
        sock.connect((host, port))
        print(f"[INFO] Connected!")
        
        # === HELPER FUNCTIONS ===
        def send(cmd):
            """Send SCPI command with newline termination"""
            sock.sendall((cmd + "\n").encode())
            time.sleep(0.05)
        
        def recv_line(timeout=5):
            """Read text response until newline"""
            sock.settimeout(timeout)
            data = b""
            try:
                while True:
                    b = sock.recv(1)
                    if not b or b == b'\n':
                        break
                    data += b
            except socket.timeout:
                pass
            return data.decode().strip()
        
        def query(cmd):
            """Send command and read response"""
            send(cmd)
            return recv_line()
        
        def recv_binary(timeout=60):
            """Read binary data until timeout (scope sends raw bytes)"""
            sock.settimeout(5)  # 5 second chunks
            data = bytearray()
            start = time.time()
            
            while time.time() - start < timeout:
                try:
                    chunk = sock.recv(65536)
                    if chunk:
                        data.extend(chunk)
                        print(f"[INFO] +{len(chunk):,} bytes (total: {len(data):,})")
                    else:
                        break
                except socket.timeout:
                    if len(data) > 0:
                        print(f"[INFO] Transfer complete")
                        break
            
            return bytes(data)
        
        def check_error():
            """Check for SCPI errors, return error string or None"""
            esr = query("*ESR?")
            if esr and esr != "0":
                err = query("ALLEV?")
                return err
            return None
        
        # === IDENTIFY SCOPE ===
        idn = query("*IDN?")
        print(f"[INFO] Scope: {idn}")
        
        series = detect_scope_series(idn)
        print(f"[INFO] Detected series: {series}")
        
        send("*CLS")
        time.sleep(0.1)
        
        # === GENERATE PATHS ===
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = format.lower()
        if ext == "jpeg":
            ext = "jpg"
        
        if filename is None:
            filename = f"scope_screenshot_{timestamp}.{ext}"
        
        # Set remote path based on series
        if series == 'mso70k':
            remote_path = f"C:/TekScope/screenshot_{timestamp}.{ext}"
        else:
            remote_path = f"C:/Temp/screenshot_{timestamp}.{ext}"
        
        print(f"[INFO] Remote path: {remote_path}")
        print(f"[INFO] Local file: {filename}")
        
        # === CAPTURE SCREENSHOT ===
        if series == 'mso70k':
            # ===== MSO/DPO 70000 SERIES =====
            print(f"\n[INFO] Using MSO70K method (EXPort START)")
            
            # Configure export settings
            send(f'EXPort:FILEName "{remote_path}"')
            send(f"EXPort:FORMat {format.upper()}")
            send("EXPort:VIEW FULLSCREEN")
            send("EXPort:PALEtte COLOR")
            time.sleep(0.1)
            
            # Verify filename was set
            fn = query("EXPort:FILEName?")
            print(f"[INFO] EXPort:FILEName? = {fn}")
            
            # Trigger the export
            print("[INFO] TX: EXPort START")
            send("EXPort START")
            
            # Wait for completion
            opc = query("*OPC?")
            print(f"[INFO] *OPC? = {opc}")
            
        else:
            # ===== MSO 4/5/6 SERIES (and unknown) =====
            print(f"\n[INFO] Using MSO456 method (SAVE:IMAGe)")
            
            # Configure (optional, ignore errors for unsupported commands)
            send("SAVE:IMAGe:VIEWTYpe FULLScreen")
            send("SAVE:IMAGe:COMPosition NORMal")
            time.sleep(0.1)
            
            # Clear any config errors (some commands may not exist)
            send("*CLS")
            time.sleep(0.1)
            
            # Trigger save (format determined by file extension!)
            print(f'[INFO] TX: SAVE:IMAGe "{remote_path}"')
            send(f'SAVE:IMAGe "{remote_path}"')
            
            # Wait for completion
            opc = query("*OPC?")
            print(f"[INFO] *OPC? = {opc}")
        
        # === CHECK FOR ERRORS ===
        err = check_error()
        if err:
            print(f"[ERROR] {err}")
            return None
        
        print("[INFO] ✓ Screenshot saved on scope!")
        
        # === TRANSFER FILE ===
        print(f"\n[INFO] Transferring file...")
        time.sleep(1)  # Wait for file to be fully written
        
        send(f'FILESystem:READFile "{remote_path}"')
        
        image_data = recv_binary(timeout=60)
        
        if not image_data:
            print("[ERROR] No data received!")
            err = check_error()
            if err:
                print(f"[ERROR] {err}")
            return None
        
        print(f"[INFO] Received {len(image_data):,} bytes total")
        
        # === PROCESS DATA ===
        # Check for IEEE 488.2 header (unlikely but handle just in case)
        if image_data[:1] == b'#':
            try:
                num_digits = int(image_data[1:2].decode())
                data_len = int(image_data[2:2+num_digits].decode())
                image_data = image_data[2+num_digits:2+num_digits+data_len]
                print(f"[INFO] Stripped IEEE header")
            except:
                pass
        
        # Find PNG start if needed
        png_magic = b'\x89PNG\r\n\x1a\n'
        if format.upper() == "PNG":
            if image_data[:8] == png_magic:
                print("[INFO] ✓ Valid PNG header!")
            else:
                idx = image_data.find(png_magic)
                if idx > 0:
                    print(f"[INFO] PNG found at offset {idx}, trimming")
                    image_data = image_data[idx:]
                elif idx < 0:
                    print("[WARN] PNG header not found!")
        
        # Strip trailing newline if present
        if image_data.endswith(b'\n'):
            image_data = image_data[:-1]
        
        # === SAVE LOCAL FILE ===
        with open(filename, 'wb') as f:
            f.write(image_data)
        
        # === CLEANUP REMOTE FILE ===
        print("[INFO] Cleaning up remote file...")
        send(f'FILESystem:DELEte "{remote_path}"')
        
        print(f"\n{'='*50}")
        print(f"✓ SUCCESS!")
        print(f"  File: {filename}")
        print(f"  Size: {len(image_data):,} bytes")
        print(f"{'='*50}")
        
        return filename
        
    except socket.timeout:
        print(f"[ERROR] Connection timeout")
        return None
    except ConnectionRefusedError:
        print(f"[ERROR] Connection refused - check scope IP and port")
        return None
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}")
        return None
    finally:
        sock.close()


def capture_screenshot_pyvisa(resource_string, filename=None, format="PNG"):
    """
    PyVISA version of screenshot capture.
    
    Uses visalib.read() for reliable binary transfer (avoids timeout issues
    with read_raw() when no termination character is present).
    
    Args:
        resource_string: VISA resource string
            Examples:
            - "TCPIP0::192.168.1.10::4000::SOCKET"
            - "TCPIP0::127.0.0.1::4000::SOCKET"
        filename: Local output filename (auto-generated if None)
        format: Image format (PNG, BMP, JPEG)
    
    Returns:
        str: Path to saved screenshot, or None on failure
    
    Example:
        >>> capture_screenshot_pyvisa("TCPIP0::192.168.1.10::4000::SOCKET")
        'scope_screenshot_20260128_161234.png'
    """
    import pyvisa
    
    print(f"\n{'='*60}")
    print(f"Tektronix Screenshot Capture (PyVISA)")
    print(f"{'='*60}")
    
    rm = pyvisa.ResourceManager()
    
    try:
        scope = rm.open_resource(resource_string)
        scope.timeout = 60000  # 60 seconds
        scope.read_termination = '\n'
        scope.write_termination = '\n'
        
        print(f"[INFO] Connected to {resource_string}")
        
        # === IDENTIFY ===
        idn = scope.query("*IDN?")
        print(f"[INFO] Scope: {idn.strip()}")
        
        series = detect_scope_series(idn)
        print(f"[INFO] Series: {series}")
        
        scope.write("*CLS")
        time.sleep(0.1)
        
        # === GENERATE PATHS ===
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = format.lower()
        if ext == "jpeg":
            ext = "jpg"
        
        if filename is None:
            filename = f"scope_screenshot_{timestamp}.{ext}"
        
        if series == 'mso70k':
            remote_path = f"C:/TekScope/screenshot_{timestamp}.{ext}"
        else:
            remote_path = f"C:/Temp/screenshot_{timestamp}.{ext}"
        
        print(f"[INFO] Remote: {remote_path}")
        print(f"[INFO] Local: {filename}")
        
        # === CAPTURE ===
        if series == 'mso70k':
            print("[INFO] Using EXPort START method")
            scope.write(f'EXPort:FILEName "{remote_path}"')
            scope.write(f"EXPort:FORMat {format.upper()}")
            scope.write("EXPort:VIEW FULLSCREEN")
            scope.write("EXPort:PALEtte COLOR")
            time.sleep(0.1)
            
            scope.write("EXPort START")
        else:
            print("[INFO] Using SAVE:IMAGe method")
            scope.write("SAVE:IMAGe:VIEWTYpe FULLScreen")
            scope.write("SAVE:IMAGe:COMPosition NORMal")
            scope.write("*CLS")
            time.sleep(0.1)
            
            scope.write(f'SAVE:IMAGe "{remote_path}"')
        
        # Wait for completion
        opc = scope.query("*OPC?")
        print(f"[INFO] *OPC? = {opc.strip()}")
        
        # Check errors
        esr = scope.query("*ESR?")
        if esr.strip() != "0":
            err = scope.query("ALLEV?")
            print(f"[ERROR] {err.strip()}")
            return None
        
        print("[INFO] ✓ Screenshot saved on scope!")
        time.sleep(1)
        
        # === TRANSFER ===
        print("[INFO] Transferring file...")
        scope.write(f'FILESystem:READFile "{remote_path}"')
        
        # Use visalib.read() for reliable binary transfer
        # This avoids timeout issues with read_raw()
        image_data = bytearray()
        scope.timeout = 5000  # 5 second timeout per chunk
        
        while True:
            try:
                chunk, status = scope.visalib.read(scope.session, 65536)
                if chunk:
                    image_data.extend(bytes(chunk))
                    print(f"[INFO] +{len(chunk):,} bytes (total: {len(image_data):,})")
                
                # Check if transfer complete
                # success_max_count_read means more data available
                if status != pyvisa.constants.StatusCode.success_max_count_read:
                    print(f"[INFO] Transfer complete")
                    break
            except pyvisa.errors.VisaIOError:
                if len(image_data) > 0:
                    print(f"[INFO] Transfer complete (timeout)")
                    break
                raise
        
        if not image_data:
            print("[ERROR] No data received!")
            return None
        
        image_data = bytes(image_data)
        print(f"[INFO] Received {len(image_data):,} bytes total")
        
        # Validate PNG
        png_magic = b'\x89PNG\r\n\x1a\n'
        if format.upper() == "PNG":
            if image_data[:8] == png_magic:
                print("[INFO] ✓ Valid PNG header!")
            else:
                idx = image_data.find(png_magic)
                if idx > 0:
                    print(f"[INFO] PNG at offset {idx}, trimming")
                    image_data = image_data[idx:]
        
        # Strip trailing newline
        if image_data.endswith(b'\n'):
            image_data = image_data[:-1]
        
        # Save
        with open(filename, 'wb') as f:
            f.write(image_data)
        
        # Cleanup
        scope.timeout = 5000
        scope.write(f'FILESystem:DELEte "{remote_path}"')
        
        print(f"\n{'='*50}")
        print(f"✓ SUCCESS!")
        print(f"  File: {filename}")
        print(f"  Size: {len(image_data):,} bytes")
        print(f"{'='*50}")
        
        return filename
        
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}")
        return None
    finally:
        try:
            scope.close()
        except:
            pass
        try:
            rm.close()
        except:
            pass


# =============================================================================
# TEKAUTOMATE INTEGRATION CLASS
# =============================================================================

class TekScreenshotCapture:
    """
    Screenshot capture class for TekAutomate integration.
    
    Supports:
        - MSO 4/5/6 Series (MSO44, MSO54, MSO58, MSO64, MSO68, and B variants)
        - MSO/DPO 70000 Series (MSO70404, MSO72004, MSO73304, DPO variants)
        - TekscopeSW (software simulator)
    
    Usage:
        # Simple capture
        capture = TekScreenshotCapture("192.168.1.10")
        filepath = capture.capture()
        
        # With options
        filepath = capture.capture(
            filename="my_screenshot.png",
            format="PNG"
        )
        
        # Get scope info
        print(capture.idn)
        print(capture.series)
    """
    
    def __init__(self, host, port=4000):
        """
        Initialize screenshot capture.
        
        Args:
            host: IP address of oscilloscope
            port: Socket port (default 4000)
        """
        self.host = host
        self.port = port
        self.series = None
        self.idn = None
        self._detect_scope()
    
    def _detect_scope(self):
        """Connect briefly to detect scope type"""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            sock.connect((self.host, self.port))
            
            sock.sendall(b"*IDN?\n")
            time.sleep(0.1)
            
            data = b""
            sock.settimeout(2)
            try:
                while True:
                    b = sock.recv(1)
                    if not b or b == b'\n':
                        break
                    data += b
            except socket.timeout:
                pass
            
            self.idn = data.decode().strip()
            self.series = detect_scope_series(self.idn)
            sock.close()
            
        except Exception as e:
            print(f"[WARN] Could not detect scope: {e}")
            self.idn = None
            self.series = 'unknown'
    
    def capture(self, filename=None, format="PNG"):
        """
        Capture screenshot from oscilloscope.
        
        Args:
            filename: Output filename (auto-generated if None)
            format: Image format - PNG, BMP, JPEG
        
        Returns:
            str: Path to saved file, or None on failure
        """
        return capture_screenshot(
            host=self.host,
            port=self.port,
            filename=filename,
            format=format
        )
    
    def capture_pyvisa(self, filename=None, format="PNG"):
        """
        Capture screenshot using PyVISA (alternative method).
        
        Args:
            filename: Output filename (auto-generated if None)
            format: Image format - PNG, BMP, JPEG
        
        Returns:
            str: Path to saved file, or None on failure
        """
        resource = f"TCPIP0::{self.host}::{self.port}::SOCKET"
        return capture_screenshot_pyvisa(
            resource_string=resource,
            filename=filename,
            format=format
        )


# =============================================================================
# QUICK REFERENCE FUNCTIONS FOR TEKAUTOMATE
# =============================================================================

def get_screenshot_commands(series):
    """
    Get the appropriate screenshot commands for a scope series.
    
    Args:
        series: 'mso456' or 'mso70k'
    
    Returns:
        dict: Command templates for screenshot capture
    """
    if series == 'mso70k':
        return {
            'set_filename': 'EXPort:FILEName "{path}"',
            'set_format': 'EXPort:FORMat {format}',
            'set_view': 'EXPort:VIEW FULLSCREEN',
            'set_palette': 'EXPort:PALEtte COLOR',
            'trigger': 'EXPort START',
            'wait': '*OPC?',
            'transfer': 'FILESystem:READFile "{path}"',
            'delete': 'FILESystem:DELEte "{path}"',
            'default_path': 'C:/TekScope',
        }
    else:  # mso456 or unknown
        return {
            'set_filename': None,  # Path is in SAVE:IMAGe command
            'set_format': None,  # Format determined by extension
            'set_view': 'SAVE:IMAGe:VIEWTYpe FULLScreen',
            'set_palette': 'SAVE:IMAGe:COMPosition NORMal',
            'trigger': 'SAVE:IMAGe "{path}"',
            'wait': '*OPC?',
            'transfer': 'FILESystem:READFile "{path}"',
            'delete': 'FILESystem:DELEte "{path}"',
            'default_path': 'C:/Temp',
        }


# =============================================================================
# COMMAND LINE INTERFACE
# =============================================================================

if __name__ == "__main__":
    import sys
    
    print("="*60)
    print("Tektronix Screenshot Capture Tool")
    print("="*60)
    print()
    print("Usage: python tek_screenshot_capture.py [host] [port]")
    print()
    print("Examples:")
    print("  python tek_screenshot_capture.py 192.168.1.10")
    print("  python tek_screenshot_capture.py 192.168.1.10 4000")
    print("  python tek_screenshot_capture.py 127.0.0.1")
    print()
    
    # Default to MSO6B scope address
    HOST = "192.168.1.10"
    PORT = 4000
    
    if len(sys.argv) > 1:
        HOST = sys.argv[1]
    if len(sys.argv) > 2:
        PORT = int(sys.argv[2])
    
    result = capture_screenshot(HOST, PORT)
    
    if result:
        print(f"\nScreenshot saved to: {result}")
    else:
        print("\nScreenshot capture failed")
