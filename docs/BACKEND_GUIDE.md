# TekAutomate Backend Selection Guide

## When to Use Which Backend

### 1. **PyVISA** (Recommended for most users)
**Best for:**
- ✅ Cross-platform compatibility (Windows, Linux, macOS)
- ✅ Works with both old and new devices
- ✅ Most reliable and widely used
- ✅ Good for DPO70k series (older scopes)
- ✅ Works with any VISA backend (NI-VISA, TekVISA, PyVISA-py)

**When NOT to use:**
- ❌ Need high-level device-specific APIs
- ❌ Want command validation and autocomplete
- ❌ Need multi-device management

**Connection Types:**
- TCP/IP (VISA INSTR): `TCPIP::192.168.1.1::INSTR` (uses VXI-11 protocol via RPC portmapper, no specific port)
- Socket: `TCPIP::192.168.1.1::4000::SOCKET` (raw socket connection, port 4000)
- USB: `USB0::0x0699::0x0522::INSTR`
- GPIB: `GPIB0::1::INSTR`

**Note:** `TCPIP::host::INSTR` uses VXI-11 protocol which doesn't require a port number - it uses RPC portmapper to discover the service automatically.

**Install:**
```bash
pip install pyvisa
# Optional: pip install pyvisa-py (pure Python, no drivers needed)
```

---

### 2. **tm_devices** (Official Tektronix Framework)
**Best for:**
- ✅ MSO4/5/6 Series (newer scopes)
- ✅ Need command validation and type hints
- ✅ Want high-level device APIs
- ✅ Multi-device automation
- ✅ Official Tektronix support
- ✅ Great IDE autocomplete support

**When NOT to use:**
- ❌ DPO70k and older series (limited support)
- ❌ Need lightweight solution
- ❌ Using Linux without proper VISA setup

**Device Support:**
- ✅ MSO2/4/5/6 Series (including B variants)
- ✅ DPO5K/7K/70K Series (newer models)
- ⚠️ Older DPO/MSO series (limited)
- ✅ AWG5K/7K Series
- ✅ AFG3K Series
- ✅ PSU, SMU, DMM devices

**Install:**
```bash
pip install tm-devices
```

**Connection:**
- Uses VISA resource strings (same as PyVISA)
- Supports both System VISA and PyVISA-py backends
- **Auto-detection**: tm_devices automatically detects the device driver from `*IDN?` response
  - Example: `MSO73304DX` → automatically uses `MSO70KDX` driver
  - You can specify driver manually, but auto-detection works well

---

### 3. **VXI-11** (Lightweight, Linux-friendly)
**Best for:**
- ✅ Linux systems without VISA drivers
- ✅ Simple, lightweight automation
- ✅ Direct RPC protocol (no VISA needed)
- ✅ Works with both old and new devices

**When NOT to use:**
- ❌ Windows (PyVISA is better)
- ❌ Need advanced features
- ❌ USB or GPIB connections (TCP/IP only)

**Install:**
```bash
pip install vxi11
```

**Connection:**
- TCP/IP only via RPC portmapper
- No port configuration needed
- Format: `TCPIP::192.168.1.1::INSTR`

---

### 4. **TekHSI** (High-Speed gRPC)
**Best for:**
- ✅ MSO5/6 Series (newer scopes only)
- ✅ High-speed waveform streaming
- ✅ Fast data acquisition
- ✅ Modern gRPC architecture

**When NOT to use:**
- ❌ DPO70k or older series (not supported)
- ❌ Need SCPI commands (different API)
- ❌ Simple automation tasks

**Limitations:**
- ⚠️ Only newer scopes (MSO5/6, DPO7K)
- ⚠️ Different API (not SCPI-based)
- ⚠️ Port 5000 only

**Install:**
```bash
pip install tekhsi
```

**Connection:**
- gRPC on port 5000
- Format: `192.168.1.1:5000`

---

### 5. **Hybrid** (TekHSI + PyVISA)
**Best for:**
- ✅ MSO5/6 Series
- ✅ Need both SCPI control AND fast waveform streaming
- ✅ Best of both worlds

**When NOT to use:**
- ❌ DPO70k or older series
- ❌ Simple automation (PyVISA alone is enough)
- ❌ Don't need high-speed streaming

**How it works:**
- PyVISA: SCPI commands (configuration, setup)
- TekHSI: Fast waveform acquisition
- Both connections active simultaneously

---

### 6. **TekExpress** (Application SCPI over Socket)
**Best for:**
- ✅ TekExpress compliance test applications (USB4Tx, PCIe, Thunderbolt)
- ✅ Automated compliance testing
- ✅ Session-driven test execution
- ✅ Report generation and export

**When NOT to use:**
- ❌ Scope waveform capture (use scope SCPI instead)
- ❌ Real-time instrument control
- ❌ Non-TekExpress applications

**Characteristics:**
- Transport: TCP socket via PyVISA SOCKET backend
- Default port: 5000
- Write/Read termination: `\n` (handled by PyVISA)
- Commands: `TEKEXP:*` namespace
- Execution model: State machine (async, requires polling)

**Key Differences from Scope SCPI:**
| Feature | Scope SCPI | TekExpress SCPI |
|---------|------------|-----------------|
| Synchronization | `*OPC?` supported | Use `TEKEXP:STATE?` polling |
| Execution | Immediate | State machine (async) |
| User Interaction | None | Popup handling required |
| Timeouts | Standard (seconds) | Extended (minutes) |

**Connection:**
```python
import pyvisa
rm = pyvisa.ResourceManager()
tekexp = rm.open_resource("TCPIP::localhost::5000::SOCKET")
tekexp.write_termination = "\n"
tekexp.read_termination = "\n"
tekexp.timeout = 30000
```

**CRITICAL RULE:**
> TekExpress commands are SCPI strings sent over a PyVISA SOCKET backend; never generate raw `socket.sendall()` code, only SCPI commands via `.write()`/`.query()` methods.

**State Machine Pattern:**
```python
tekexp.write("TEKEXP:STATE RUN")
while True:
    state = tekexp.query("TEKEXP:STATE?").strip()
    if state == "COMPLETE":
        break
    if state in ("WAIT", "ERROR"):
        popup = tekexp.query("TEKEXP:POPUP?")
        tekexp.write('TEKEXP:POPUP "OK"')
    time.sleep(2)
```

**See Also:** `docs/TEKEXPRESS_INTEGRATION.md` for comprehensive integration guide.

---

## Device-Specific Recommendations

### DPO70k Series (Older)
**Recommended:** PyVISA or tm_devices
- ✅ PyVISA: Most reliable, works well
- ✅ tm_devices: Use DPO70K driver if available
- ❌ TekHSI: Not supported
- ⚠️ VXI-11: Works but PyVISA is better

**Connection:**
- TCP/IP (VISA INSTR): Port 5025
- Socket: Port 4000
- USB: Works with vendor/product ID

### MSO6Xb Series (Newer)
**Recommended:** tm_devices or Hybrid
- ✅ tm_devices: Best support, official APIs
- ✅ Hybrid: If you need fast waveforms
- ✅ PyVISA: Works but less optimized
- ✅ TekHSI: For waveform streaming only

**Connection:**
- TCP/IP (VISA INSTR): Port 5025
- Socket: Port 4000
- TekHSI: Port 5000 (gRPC)

---

## Quick Decision Tree

```
Start Here
    │
    ├─ Do you have DPO70k or older scope?
    │   └─ Yes → Use PyVISA (most reliable)
    │
    ├─ Do you have MSO5/6 or newer scope?
    │   ├─ Need high-level APIs? → Use tm_devices
    │   ├─ Need fast waveforms? → Use Hybrid (TekHSI + PyVISA)
    │   └─ Simple automation? → Use PyVISA
    │
    ├─ Are you on Linux without VISA?
    │   └─ Yes → Use VXI-11 or PyVISA-py
    │
    └─ Need multi-device automation?
        └─ Yes → Use tm_devices
```

---

## Code Style Standards

### General Principles
1. **Consistent formatting**: PEP 8 style
2. **Error handling**: Always use try/except blocks
3. **Resource cleanup**: Always close connections in finally blocks
4. **Documentation**: Include docstrings for complex functions
5. **Type hints**: Use where applicable (especially for tm_devices)

### Code Structure
```python
#!/usr/bin/env python3
"""
Generated by TekAutomate
Backend: [backend_name]
Device: [device_model]
Connection: [connection_string]
"""

import argparse
import time
import pathlib
# Backend-specific imports

# Helper functions (if needed)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()
    
    # Connection setup
    try:
        # Your automation code here
        pass
    except Exception as e:
        print(f"Error: {e}")
        raise
    finally:
        # Cleanup
        pass

if __name__ == "__main__":
    main()
```

---

## Testing Priority

1. **DPO70k** (Older series)
   - Test PyVISA connection
   - Test basic SCPI commands
   - Test waveform acquisition
   - Verify error handling

2. **MSO6Xb** (Newer series)
   - Test tm_devices connection
   - Test high-level APIs
   - Test TekHSI (if applicable)
   - Test Hybrid mode
   - Verify all features work

