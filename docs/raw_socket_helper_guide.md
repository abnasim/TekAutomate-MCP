# Raw Socket Helper Utilities for Advanced Scope Operations

## Overview

The **Raw Socket Helper** utilities provide high-performance, low-level communication with Tektronix oscilloscopes when PyVISA limitations prevent certain operations. These Python modules enable:

- **Fast waveform data acquisition** via raw socket connections
- **Screenshot capture** using optimized binary transfer
- **Direct control** over socket communication for advanced use cases

## When to Use Raw Sockets vs PyVISA

### Use Raw Sockets When:
- Fetching screenshots with `FILESystem:READFile` (PyVISA times out)
- Transferring large waveform data (100M+ samples)
- Maximum throughput is critical
- Working with `CURVe?` queries for binary waveform data

### Use PyVISA When:
- Standard SCPI commands (write/query)
- Session management and device discovery
- Cross-platform compatibility is essential
- Simple automation workflows

## Helper Files Included

The `helper/` folder contains three Python modules:

### 1. `socket_instr.py` - Core Socket Communication
Base class for socket-based instrument communication with methods mimicking PyVISA:

```python
from socket_instr import SocketInstr

# Connect to scope via raw socket
scope = SocketInstr(host='192.168.1.100', port=4000, timeout=10)

# Standard commands work like PyVISA
idn = scope.query('*IDN?')
scope.write('ACQuire:STATE ON')

# Binary data transfer
waveform_data = scope.read_bytes(5000000)  # Read 5MB waveform

scope.close()
```

**Key Features:**
- Non-blocking socket communication
- Timeout-based EOF detection (timeout = end of transfer)
- Binary and ASCII data handling
- Error checking and graceful failure

### 2. `socket_curve_and_img_fetch.py` - Waveform & Screenshot Example
Complete example script demonstrating:
- Waveform acquisition and scaling
- Screenshot capture with PNG header alignment
- Data logging to CSV files
- Optional matplotlib plotting

**Usage:**
```python
# Configure options at top of script
plots = False        # Set True to enable matplotlib plots
save2file = True     # Save waveform data to CSV
save_img = True      # Fetch screenshot from scope
chan_sel = [1, 2]    # Channels to acquire
```

**What It Does:**
1. Connects to scope via socket (port 4000)
2. Configures acquisition (record length, encoding)
3. Captures waveform data via `CURVe?`
4. Scales binary data to voltage/time values
5. Optionally fetches screenshot using special pipeline-priming sequence
6. Saves all data to timestamped files

### 3. `socket_fetch_image_multiple.py` - Multi-Screenshot Capture
Specialized script for capturing multiple screenshots in a loop with:
- State machine priming for reliable PNG transfer
- Automatic PNG header detection and realignment
- Timestamped filenames for series capture

## Critical Raw Socket Techniques

### Pipeline Priming for Screenshot Capture

The scope's socket daemon requires specific query sequences before `FILESystem:READFile` works correctly:

```python
# Prime the UI subsystems (CRITICAL - not optional)
scope.write('*CLS')
scope.query('SAVE:IMAGe:FILEFormat?')
scope.write('*CLS')
scope.query('SAVE:IMAGe:COMPosition?')
scope.write('*CLS')
scope.query('SAVE:IMAGe:VIEWTYpe?')
scope.write('*CLS')
scope.query('SAVE:IMAGe:INKSaver?')
scope.write('*CLS')
scope.query('SAVE:IMAGe:LAYout?')
scope.write('*CLS')
scope.query('FILESystem:CWD?')

# NOW the file read will work
scope.write('SAVE:IMAGe "C:\\Temp\\screenshot.png"')
scope.write('FILESystem:READFile "C:\\Temp\\screenshot.png"')
data = scope.read_timeout_based()  # Read until timeout
```

**Why This Works:**
- Priming queries initialize internal UI state machines
- `*CLS` between queries clears event queues
- Prevents stray text from contaminating binary stream
- Scope enters "raw streaming mode" during file read

### Timeout-Based EOF Detection

Unlike PyVISA, raw sockets use timeout to signal end-of-transfer:

```python
def read_timeout_based(self):
    """Read until socket timeout (timeout = EOF)"""
    data = bytearray()
    self.socket.settimeout(2.0)  # Short timeout for EOF detection
    
    try:
        while True:
            chunk = self.socket.recv(4096)
            if not chunk:
                break
            data.extend(chunk)
    except socket.timeout:
        pass  # Timeout means transfer complete
    
    return bytes(data)
```

### PNG Header Realignment

Socket responses may include SCPI headers before binary data:

```python
png_magic = b'\x89PNG\r\n\x1a\n'

# Check if PNG header is at start
if data[:8] != png_magic:
    # Search for PNG magic bytes
    idx = data.find(png_magic)
    if idx > 0:
        # Strip everything before PNG header
        data = data[idx:]
        print(f"Realigned PNG header (stripped {idx} bytes)")
```

## Integration with TekAutomate

### Using Raw Socket Helpers in Generated Scripts

When exporting Python code from TekAutomate, you can manually integrate raw socket helpers:

1. **Copy helper files** from `helper/` folder to your project directory
2. **Import the module** in your generated script:
   ```python
   from socket_instr import SocketInstr
   ```

3. **Replace screenshot blocks** with raw socket implementation:
   ```python
   # Instead of PyVISA screenshot:
   # scope.save_screenshot("screenshot.png")
   
   # Use raw socket approach:
   sock_scope = SocketInstr(host='192.168.1.100', port=4000)
   # ... pipeline priming sequence ...
   sock_scope.write('FILESystem:READFile "C:\\Temp\\screenshot.png"')
   img_data = sock_scope.read_timeout_based()
   with open('screenshot.png', 'wb') as f:
       f.write(img_data)
   ```

### Automated Helper Bundling (Future Feature)

A future version of TekAutomate will automatically:
- Detect when `save_screenshot` blocks use raw socket mode
- Bundle `socket_instr.py` with exported Python script
- Generate integrated code with proper imports

## Performance Comparison

| Operation | PyVISA (TCPIP::INSTR) | Raw Socket (port 4000) |
|-----------|----------------------|------------------------|
| Screenshot (PNG) | ❌ Timeout | ✅ 2-3 seconds |
| 10M sample waveform | 8-12 seconds | 4-6 seconds |
| Simple SCPI query | 50-100ms | 30-50ms |
| Session setup | Fast (auto-discovery) | Manual (IP + port) |

**Overhead tradeoff:**
- Raw sockets: Lower latency, higher throughput
- PyVISA: Better error handling, easier debugging

## Troubleshooting

### Issue: Screenshot returns corrupted PNG
**Cause:** Pipeline not primed, binary data contaminated with ASCII  
**Solution:** Run all priming queries with `*CLS` between each

### Issue: Socket timeout before transfer completes
**Cause:** Timeout too short for large files  
**Solution:** Increase timeout: `scope.socket.settimeout(30)`

### Issue: Connection refused (port 4000)
**Cause:** Raw socket service disabled on scope  
**Solution:** Enable in Utility > I/O > Socket Server > Enable

### Issue: Waveform data all zeros
**Cause:** Acquisition not triggered or completed  
**Solution:** Add `ACQuire:STATE ON` wait, then `ACQuire:STATE OFF` before `CURVe?`

## Code Examples

### Minimal Screenshot Capture
```python
from socket_instr import SocketInstr

scope = SocketInstr('192.168.1.100', 4000)

# Prime pipeline
for cmd in ['SAVE:IMAGe:FILEFormat?', 'SAVE:IMAGe:COMPosition?']:
    scope.write('*CLS')
    scope.query(cmd)

# Capture and fetch
scope.write('SAVE:IMAGe "C:\\Temp\\test.png"')
scope.write('FILESystem:READFile "C:\\Temp\\test.png"')

# Read with timeout-based EOF
scope.socket.settimeout(5)
data = bytearray()
try:
    while True:
        data.extend(scope.socket.recv(4096))
except socket.timeout:
    pass

# Save to file
with open('screenshot.png', 'wb') as f:
    f.write(data)

scope.close()
```

### Waveform Capture with Scaling
```python
from socket_instr import SocketInstr
import numpy as np

scope = SocketInstr('192.168.1.100', 4000)

# Configure acquisition
scope.write('DATa:SOUrce CH1')
scope.write('DATa:ENCdg SRIBinary')
scope.write('DATa:WIDth 1')
scope.write('HORizontal:RECOrdlength 10000')

# Capture
scope.write('ACQuire:STATE ON')
time.sleep(0.5)
scope.write('ACQuire:STATE OFF')

# Get scaling parameters
y_mult = float(scope.query('WFMOutpre:YMUlt?'))
y_off = float(scope.query('WFMOutpre:YOFf?'))
y_zero = float(scope.query('WFMOutpre:YZEro?'))
x_incr = float(scope.query('WFMOutpre:XINcr?'))

# Fetch waveform
raw = scope.query('CURVe?')
# Parse and scale (see socket_curve_and_img_fetch.py for full implementation)

scope.close()
```

## Best Practices

1. **Always call `*CLS`** between configuration queries to clear event queues
2. **Use timeout-based EOF** for binary transfers (don't rely on length headers)
3. **Check PNG magic bytes** and realign if needed
4. **Close sockets properly** with `shutdown()` then `close()`
5. **Test with small data first** before capturing 100M sample waveforms
6. **Add error handling** - socket operations can fail silently

## Additional Resources

- **Full documentation:** `docs/RAW_SOCKET_SCREENSHOT.txt` (detailed state machine analysis)
- **Example scripts:** `helper/` folder (all 3 helper files)
- **TekAutomate integration:** Use `python_code` blocks to embed socket calls

## Author & Credits

Helper utilities developed by **Steve Guerrero**  
Tested on: MDO3000/4000C, MSO2/3/4/5(B)/6(B) series  
Python version: 3.10.5+

---

**Note:** These utilities are provided "as-is" for advanced users. For most automation tasks, use TekAutomate's built-in PyVISA or tm_devices backends. Raw sockets are recommended only when performance or specific operations (like screenshot capture) require direct control.
