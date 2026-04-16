# DEVICE_PROFILES.md — TekAutomate Device-Specific Knowledge

## 1. MSO 4/5/6 Series (Modern Scopes)

### Models
- MSO44, MSO44B, MSO46, MSO46B (4-Series, 4 channels)
- MSO54, MSO54B, MSO56, MSO56B, MSO58, MSO58B, MSO58LP (5-Series)
- MSO64, MSO64B, MSO66B, MSO68B (6-Series, flagship)
- LPD64 (Low Profile Digitizer)
- MSO2 Series (2/4 Channel, 70–200 MHz, entry-level)

### Supported Backends
- ✅ PyVISA (recommended for most use cases)
- ✅ tm_devices (full command tree support; classes: MSO4, MSO4B, MSO5, MSO5B, MSO6, MSO6B)
- ✅ TekHSI (high-speed gRPC waveform capture on port 5000, MSO5/6 only)
- ✅ VXI-11 (direct TCP/IP, lightweight Linux-friendly)
- ✅ Hybrid (TekHSI + PyVISA simultaneously for SCPI + fast waveforms)

### Connection Types
- `TCPIP::host::INSTR` (VXI-11 via RPC portmapper, recommended — no port needed)
- `TCPIP::host::4000::SOCKET` (raw socket)
- `USB::0x0699::product_id::INSTR`
- `GPIB0::address::INSTR`
- TekHSI: `host:5000` (gRPC, waveform streaming only)

### Screenshot Commands (VERIFIED)
**WORKING:**
- `SAVE:IMAGe "C:/Temp/file.png"` — format determined by extension (.png, .bmp, .jpg)
- `SAVE:IMAGe:COMPosition NORMal|INVErted`
- `SAVE:IMAGe:VIEWTYpe FULLScreen`
- `FILESystem:READFile "path"` — returns raw binary (no IEEE 488.2 block header)
- `FILESystem:DELEte "path"`
- `*OPC?` (wait for SAVE:IMAGe completion)

**NOT WORKING (Command not found on MSO 4/5/6):**
- `SAVE:IMAGe:FILEFormat` (use filename extension instead)
- `SAVE:IMAGe:INKSaver`
- `SAVE:IMAGe:LAYout`
- `EXPort` commands (70k series only)
- `HARDCopy` commands (70k series only)

### Working Directory
`C:/Users/Public/Tektronix/TekScope`

### Screenshot Flow
1. `SAVE:IMAGe:VIEWTYpe FULLScreen`
2. `SAVE:IMAGe:COMPosition NORMal`
3. `SAVE:IMAGe "C:/Temp/screenshot.png"`
4. `*OPC?` (or `time.sleep(1.0)` for binary safety — avoids buffer contamination)
5. `FILESystem:READFile "C:/Temp/screenshot.png"`
6. `FILESystem:DELEte "C:/Temp/screenshot.png"`

### FILESystem:READFile — Critical Transport Notes
`FILESystem:READFile` is **not IEEE 488.2 compliant**. It is a command (not a query) that produces unframed binary output:
- No SCPI definite-length block header (`#<n><length><data>`)
- No termination character
- Terminated only by EOI (End-Or-Identify)
- Newlines may appear **inside** the binary data
- **VISA-based `read_raw()` will timeout** because VISA expects framing or termination

**Required transport:** Raw TCP socket with timeout-based EOF detection.

**PyVISA workaround:** Use `visalib.read()` in a loop, checking `StatusCode.success_max_count_read`:
```python
image_data = bytearray()
scope.timeout = 5000  # 5 second chunks
while True:
    try:
        chunk, status = scope.visalib.read(scope.session, 65536)
        if chunk:
            image_data.extend(bytes(chunk))
        if status != pyvisa.constants.StatusCode.success_max_count_read:
            break
    except pyvisa.errors.VisaIOError:
        if len(image_data) > 0:
            break
        raise
```

### Raw Socket Pipeline Priming (for screenshot capture)
The scope's socket daemon requires priming queries before `FILESystem:READFile` works correctly. These initialize internal UI subsystems:
```
*CLS → SAVE:IMAGe:FILEFormat? → *CLS → SAVE:IMAGe:COMPosition?
*CLS → SAVE:IMAGe:VIEWTYpe? → *CLS → SAVE:IMAGe:INKSaver?
*CLS → SAVE:IMAGe:LAYout? → *CLS → FILESystem:CWD?
```
After priming, issue `SAVE:IMAGe` then `FILESystem:READFile` immediately. **Do not** issue any other SCPI commands while READFile is streaming.

### PNG Header Realignment
Socket responses may include stray ASCII before binary data. Always check for PNG magic bytes (`\x89PNG\r\n\x1a\n`) and realign:
```python
png_magic = b'\x89PNG\r\n\x1a\n'
if data[:8] != png_magic:
    idx = data.find(png_magic)
    if idx > 0:
        data = data[idx:]  # Strip leading garbage
```

### Firmware Notes
- Tested: MSO68B FW 2.20.8 ✓
- Tested: TekscopeSW FW 2.16.9 ✓
- VXI-11 chunking regression on MSO46B FW 2.20 (vs MSO54 FW 1.38 — no issue)

### SCPI Quirks
- Format determined by filename extension (.png, .bmp, .jpg) — no `SAVE:IMAGe:FILEFormat` command
- `FILESYSTEM:READFILE` returns raw binary (no IEEE header)
- Use `time.sleep(1.0)` instead of `*OPC?` after `SAVE:IMAGe` to avoid UnicodeDecodeError when PNG data contaminates the query buffer
- PI Command Translator (firmware v1.30+) can auto-convert legacy DPO commands to modern equivalents

### tm_devices Command Examples
```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    scope: MSO6B = dm.add_scope("192.168.0.1")
    scope.commands.ch[1].scale.write(1.0)
    scope.commands.ch[1].coupling.write("DC")
    scope.commands.acquire.mode.write("SAMPLE")
    scope.commands.acquire.state.write("ON")
    scope.commands.trigger.a.edge.source.write("CH1")
    scope.commands.trigger.a.level.write(1.5)
    scope.commands.horizontal.scale.write(1e-3)
    scope.commands.measurement.addmeas.write("FREQUENCY")
    value = scope.commands.measurement.meas[1].results.currentacq.mean.query()
    scope.save_screenshot("capture.png")
```

### SCPI Command Groups (34 groups, 2952 commands)
Key groups: Acquisition (15), Measurement (367), Trigger (266), Search & Mark (650), Bus (339), Power (268), Display (130), Horizontal (48), Waveform Transfer (41), File System (19), Math (85).

---

## 2. MSO/DPO 5000/7000/70000 Series (Legacy Scopes)

### Models
- MSO/DPO 5000, 5000B
- DPO 7000, 7000C
- DPO 70000, 70000B/C/D/DX/SX
- DSA 70000, 70000B/C/D
- MSO 70000, 70000C/DX

### Supported Backends
- ✅ PyVISA (recommended — most reliable for legacy)
- ⚠️ tm_devices (limited support; auto-detects driver from `*IDN?`, e.g. `MSO73304DX` → `MSO70KDX`)
- ❌ TekHSI (not supported)
- ✅ VXI-11 (works, but PyVISA preferred on Windows)

### Connection Types
- `TCPIP::host::INSTR` (VXI-11)
- `TCPIP::host::4000::SOCKET` (raw socket)
- `USB::0x0699::product_id::INSTR`
- `GPIB0::address::INSTR`

### Screenshot Commands (VERIFIED)
**WORKING:**
- `EXPort:FILEName "path"` — set output file path
- `EXPort:FORMat PNG|BMP|TIFF|JPEG`
- `EXPort:VIEW FULLSCREEN`
- `EXPort:PALEtte COLOR|BLACKWHITE`
- `EXPort START` — trigger screenshot (case-sensitive! must be `START`)
- `HARDCopy:DATA?` — **direct binary stream, no file I/O, fastest method (LEGACY ONLY)**
- `HARDCopy:PORT FILE`
- `HARDCopy:FORMAT PNG`
- `HARDCopy:FILENAME "path"`
- `HARDCopy START`
- `FILESystem:READFile "path"` — transfer file (raw binary)
- `FILESystem:DELEte "path"`

**NOT WORKING:**
- `SAVE:IMAGe "path"` — use `EXPort` instead
- `SAVE:IMAGe:FILEFormat` — use `EXPort:FORMat` instead
- `EXPort` (no parameter) — must use `EXPort START`
- `EXPort:STARt` — case-sensitive, use `START`

### Working Directory
`C:/TekScope`

### Three Screenshot Methods
1. **`HARDCOPY:DATA?`** — Direct binary stream, no file I/O, fastest. Returns IEEE 488.2 definite-length block. **LEGACY ONLY — does NOT work on MSO 4/5/6 series.**
   ```python
   scope.write("HARDCopy:FORMat PNG")
   scope.write("HARDCopy:LAYout PORTrait")
   image_data = scope.query_binary_values('HARDCopy:DATA?', datatype='B', container=bytes)
   ```
2. **`HARDCOPY PORT FILE`** — Save to file on scope, then transfer via `FILESystem:READFile`.
   ```python
   scope.write('HARDCOPY:PORT FILE')
   scope.write('HARDCOPY:FORMAT PNG')
   scope.write(f'HARDCOPY:FILENAME "{scope_temp}"')
   scope.write('HARDCOPY START')
   time.sleep(1.0)
   scope.write(f'FILESYSTEM:READFILE "{scope_temp}"')
   image_data = scope.read_raw()
   ```
3. **`EXPort`** — Alternative save method with explicit format/view/palette control.

### EXPort Screenshot Flow
1. `EXPort:FILEName "C:/TekScope/screenshot.png"`
2. `EXPort:FORMat PNG`
3. `EXPort:VIEW FULLSCREEN`
4. `EXPort:PALEtte COLOR`
5. `EXPort START`
6. `*OPC?`
7. `FILESystem:READFile "C:/TekScope/screenshot.png"`
8. `FILESystem:DELEte "C:/TekScope/screenshot.png"`

### Firmware Notes
- Tested: MSO73304DX FW 10.14.1 ✓

### Model Detection from *IDN?
```python
def detect_scope_series(idn_string):
    model = idn_string.upper().split(',')[1].strip()
    if model.startswith('MSO7') or model.startswith('DPO7'):
        return 'mso70k'   # Use EXPort START
    if model.startswith('MSO4') or model.startswith('MSO5') or model.startswith('MSO6'):
        return 'mso456'   # Use SAVE:IMAGe
    if 'TEKSCOPESW' in idn_string.upper():
        return 'mso456'
    return 'unknown'
```

### DPOJET Measurements (tm_devices)
```python
from tm_devices.drivers import MSO70KDX
scope: MSO70KDX = dm.add_scope("127.0.0.1")
scope.commands.dpojet.activate.write()
scope.commands.dpojet.addmeas.write("Period")
scope.commands.dpojet.addmeas.write("RiseTime")
scope.commands.dpojet.state.write("single")
max_val = scope.commands.dpojet.meas[1].results.currentacq.max.query()
```

---

## 3. TekscopePC (Software Oscilloscope)

### Special Rules
- Runs on Windows PC, no physical instrument
- Supports same SCPI as MSO 4/5/6 series (use `SAVE:IMAGe` method)
- Connection via `localhost` (127.0.0.1)
- Useful for development/testing without hardware
- Detected by `TEKSCOPESW` in `*IDN?` response
- Tested: FW 2.16.9 ✓

### Connection
```python
# PyVISA
scope = rm.open_resource("TCPIP::127.0.0.1::INSTR")
# tm_devices
scope = dm.add_scope("127.0.0.1")
```

---

## 4. MSO2 Series (Entry-Level Scopes)

### Models
- MSO2 Series — 2/4 Channel, 70–200 MHz

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices (MSO2 class)

---

## 5. DPO/MDO 2000/3000/4000 Series (Mid-Range Legacy)

### Models
- DPO 2000, DPO 4000
- MDO 3000, MDO 4000 (Mixed Domain — includes RF)

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices (DPO2K, DPO4K, MDO3K, MDO4K classes)
- ❌ TekHSI

---

## 6. AFG Series (Function Generators)

### Models
- AFG3000 (AFG3K): 1/2 ch, 250 MHz, 2 GS/s
- AFG3000B (AFG3KB): Updated features
- AFG3000C (AFG3KC): Latest generation
- AFG31000 (AFG31K): 1/2 ch, 250 MHz, 14-bit resolution

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices (AFG3K, AFG3KB, AFG3KC, AFG31K classes)

### Key SCPI Commands
- `OUTPut{ch}:STATe ON|OFF`
- `SOURce{ch}:FREQuency:FIXed <NR3>`
- `SOURce{ch}:VOLTage:AMPLitude <NR3>`
- `SOURce{ch}:FUNCtion:SHAPe SINusoid|SQUare|RAMP|PULSe|...`

### tm_devices Usage
```python
from tm_devices.drivers import AFG3KC
afg: AFG3KC = dm.add_afg("192.168.0.1")
afg.set_and_check(":OUTPUT1:STATE", "1")
afg.generate_function(
    function=afg.source_device_constants.functions.RAMP,
    channel="SOURCE1",
    frequency=10e6,
    amplitude=0.5,
    offset=0,
    symmetry=50.0,
)
# Or via command tree:
afg.commands.source[1].frequency.write(1e6)
afg.commands.output[1].state.write("ON")
```

---

## 7. AWG Series (Arbitrary Waveform Generators)

### Models
- AWG5000 (AWG5K): 2/4 ch, 600 MS/s–1.2 GS/s, 14-bit
- AWG5200: 2/4/8 ch, 10 GS/s, multi-channel
- AWG7000 (AWG7K): 1/2 ch, 10–20 GS/s, high speed
- AWG70000 (AWG70K): 1/2 ch, 25–50 GS/s, ultra high speed

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices (AWG5K, AWG5200, AWG7K, AWG70K classes)

### tm_devices Usage
```python
from tm_devices.drivers import AWG5K
awg: AWG5K = dm.add_awg("192.168.0.1")
awg.generate_function(
    function=awg.source_device_constants.functions.RAMP,
    channel="SOURCE1",
    frequency=10e6,
    amplitude=0.5,
    offset=0,
)
awg.source_channel["SOURCE1"].set_offset(0.5)
awg.source_channel["SOURCE1"].set_amplitude(0.2)
awg.source_channel["SOURCE1"].set_state(1)
# Constraint checking before generation:
constraints = awg.get_waveform_constraints(function=desired_function)
freq_range = constraints.frequency_range
```

---

## 8. Keithley SMU Series (Source Measure Units)

### PI-Based Models (SCPI)
- SMU2400: Basic SMU (legacy)
- SMU2450: Mid-range, touchscreen, 200V/1A/20W
- SMU2460: High current, 100V/7A/100W, 7.5 digit
- SMU2461: 100V/10A/100W, 7.5 digit
- SMU2470: High voltage, 1100V/1A/110W, 7.5 digit

### TSP-Based Models (Lua scripting)
- SMU2600B series: SMU2601B, SMU2602B, SMU2604B, SMU2606B (40V, 3–10A)
- SMU2611B, SMU2612B, SMU2614B (200V, 1.5A)
- SMU2634B, SMU2635B, SMU2636B (200V, 1.5–10A)
- SMU2651A, SMU2657A (40V, 50A — high power)

### Supported Backends
- ✅ PyVISA (recommended for PI models)
- ✅ tm_devices (all models; classes: SMU2450, SMU2460, SMU2601B, etc.)

### Key SCPI Commands (PI models — 2400/2450/2460/2470)
- `:SOURce:FUNCtion VOLTage|CURRent`
- `:SOURce:VOLTage:LEVel <NR3>`
- `:SOURce:CURRent:LEVel <NR3>`
- `:SOURce:VOLTage:RANGe:AUTO ON`
- `:SENSe:CURRent:PROTection <NR3>` (compliance)
- `:OUTPut ON|OFF`
- `:MEASure:CURRent?`
- `:MEASure:VOLTage?`

### tm_devices Usage (TSP-based 2600B series)
```python
from tm_devices.drivers import SMU2602B
smu: SMU2602B = dm.add_smu("192.168.0.1")
smua = smu.commands.smu["a"]   # Channel A
smub = smu.commands.smu["b"]   # Channel B

smua.reset()
smua.source.func = smua.OUTPUT_DCVOLTS
smua.source.levelv = 5.0
smua.source.limiti = 100e-3
smua.source.output = smua.OUTPUT_ON

voltage = smua.measure.v()
current = smua.measure.i()
smua.source.output = smua.OUTPUT_OFF
```

### tm_devices Usage (PI-based 2460)
```python
from tm_devices.drivers import SMU2460
smu: SMU2460 = dm.add_smu("192.168.0.1")
smu.commands.smu.source.func.write("FUNC_DC_VOLTAGE")
smu.commands.smu.source.level.write(5.0)
smu.commands.smu.measure.read()  # Execute and return measurement
```

### Device Context in TekAutomate
- SCPI prefix: `:SOURce:`, `:SENSe:`, `:OUTPut`
- Blockly DEVICE_CONTEXT: `(smu)`

---

## 9. Keithley PSU Series (Power Supplies)

### Models
- PSU2200 Series: 30/60V, single/dual/triple output
- PSU2220: 30V, 3A, dual channel
- PSU2230: 30V, 3A, triple channel
- PSU2231: 30V, 3A, triple channel with USB
- PSU2280: 32/60V, 6/3.2A, high resolution
- PSU2281: 120/240V, battery simulator

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices (PSU2200, PSU2220, PSU2230, PSU2231, PSU2280, PSU2281 classes)

### Key Commands
- `OUTPut ON|OFF`
- `VOLTage <NR3>`
- `CURRent <NR3>`

---

## 10. Keithley DMM Series (Digital Multimeters)

### Models
- DMM6500: 6.5 digit, bench/system DMM, touchscreen
- DMM7510: 7.5 digit, graphical sampling DMM, 1M samples/s
- DMM7512: 7.5 digit, dual display DMM

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices (DMM6500, DMM7510, DMM7512 classes)

### Key Capabilities
- Voltage, current, resistance, temperature measurement
- TSP-based scripting (Lua)

---

## 11. Keithley DAQ Series (Data Acquisition)

### Models
- DAQ6510: Data Acquisition and Logging System, 6.5 digit DMM, multi-channel scanning

### Supported Backends
- ✅ PyVISA
- ✅ tm_devices

---

## 12. Specialized Instruments

### TMT4 (Margin Tester)
- DC-DC converter testing
- tm_devices: `dm.add_mt("192.168.0.2", "TMT4", alias="margin tester", port=5000)`

### SS3706A (Systems Switch)
- Systems switch with DMM, 6.5 digit, 96 channels

---

## 13. TekExpress (Compliance Test Suite)

### Applications
- USB4Tx, PCIe, Thunderbolt, DisplayPort

### Connection
- PyVISA SOCKET: `TCPIP::host::5000::SOCKET`
- `write_termination = "\n"`
- `read_termination = "\n"`
- `timeout = 30000` (30 seconds, tests may run minutes)

```python
import pyvisa
rm = pyvisa.ResourceManager()
tekexp = rm.open_resource("TCPIP::localhost::5000::SOCKET")
tekexp.write_termination = "\n"
tekexp.read_termination = "\n"
tekexp.timeout = 30000
```

### Special Rules
- **No `*OPC?` support** — use `TEKEXP:STATE?` polling
- `TEKEXP:POPUP?` check during state polling (TekExpress may pause for user input)
- **Never generate raw socket code** — only PyVISA `.write()`/`.query()` methods
- Termination handled by PyVISA config — **never embed `\n` in command strings**
- All commands: `TEKEXP:*` namespace

### State Machine Pattern
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

### Key Commands
- `TEKEXP:SELECT DEVICE|SUITE|TEST`
- `TEKEXP:VALUE GENERAL|ACQUIRE|ANALYZE`
- `TEKEXP:ACQUIRE_MODE LIVE`
- `TEKEXP:STATE RUN`
- `TEKEXP:STATE?` → `RUNNING|WAIT|ERROR|COMPLETE`
- `TEKEXP:POPUP?`
- `TEKEXP:POPUP "OK"`
- `TEKEXP:EXPORT REPORT|LOG|CSV`
- `TEKEXP:LASTERROR?`

### Key Differences from Scope SCPI
| Feature | Scope SCPI | TekExpress SCPI |
|---------|------------|------------------|
| Synchronization | `*OPC?` supported | Use `TEKEXP:STATE?` polling |
| Execution | Immediate | State machine (async) |
| User Interaction | None | Popup handling required |
| Timeouts | Standard (seconds) | Extended (minutes) |

---

## 14. Backend Compatibility Matrix

| Device | PyVISA | tm_devices | TekHSI | VXI-11 | Hybrid |
|--------|--------|-----------|--------|--------|--------|
| MSO4/5/6/B | ✅ | ✅ | ✅ (5/6 only) | ✅ | ✅ (5/6 only) |
| MSO2 | ✅ | ✅ | ❌ | ✅ | ❌ |
| DPO/MDO 2K/3K/4K | ✅ | ✅ | ❌ | ✅ | ❌ |
| DPO5K/7K/70K | ✅ | ⚠️ Limited | ❌ | ✅ | ❌ |
| TekscopePC | ✅ | ✅ | ❌ | ✅ | ❌ |
| AFG3K/31K | ✅ | ✅ | ❌ | ✅ | ❌ |
| AWG5K/70K | ✅ | ✅ | ❌ | ✅ | ❌ |
| SMU2400-2600 | ✅ | ✅ | ❌ | ✅ | ❌ |
| DMM6500/7510 | ✅ | ✅ | ❌ | ✅ | ❌ |
| PSU2200+ | ✅ | ✅ | ❌ | ✅ | ❌ |
| DAQ6510 | ✅ | ✅ | ❌ | ✅ | ❌ |
| TekExpress | ✅ SOCKET | ❌ | ❌ | ❌ | ❌ |

### Backend Connection Type Support

| Backend | TCP/IP (VXI-11) | Socket | USB | GPIB | Notes |
|---------|-----------------|--------|-----|------|-------|
| PyVISA | ✅ | ✅ | ✅ | ✅ | All devices |
| tm_devices | ✅ | ❌ | ✅ | ✅ | Uses IP/hostname, not VISA strings |
| VXI-11 | ✅ | ❌ | ❌ | ❌ | TCP/IP only, no drivers needed |
| TekHSI | ✅ (port 5000) | ❌ | ❌ | ❌ | gRPC, newer scopes only |
| Hybrid | ✅ | ❌ | ✅ | ✅ | Two simultaneous connections |

---

## 15. Transport Selection Rules (for AI Agents)

### Decision Matrix
| Operation | Command Examples | Required Transport | Reason |
|-----------|-----------------|-------------------|--------|
| Identification | `*IDN?` | PyVISA | Message-based |
| Configuration | `ACQ:MODE`, `HOR:SCALE` | PyVISA | Message-based |
| Measurements | `MEASU:IMM:VALUE?` | PyVISA | Message-based |
| Compliance tests | `DPOJET:*`, `TEKEXP:*` | PyVISA | Message-based |
| Screenshot (direct) | `HARDCopy:DATA?` | PyVISA INSTR only | Definite-length block |
| Screenshot (file) | `SAVE:IMAGe` + `READFile` | Raw socket | Unframed binary stream |
| File transfer | `FILESystem:READFile` | Raw socket | Stream-based, no EOF |
| Large waveform | `CURVe?` (100M+ samples) | Raw socket preferred | Throughput |

### Hard Fail Conditions
An AI agent **must refuse** to execute if:
- `FILESystem:READFile` is routed to PyVISA `read_raw()`
- VISA timeout is misinterpreted as success
- Raw socket code is generated for TekExpress (use PyVISA SOCKET)

---

## 16. Firmware Version Gotchas
| Instrument | Firmware | Status | Notes |
|-----------|----------|--------|-------|
| MSO68B | FW 2.20.8 | ✅ Verified working | Reference platform |
| MSO46B | FW 2.20 | ⚠️ VXI-11 chunking regression | Use socket or upgrade FW |
| MSO54 | FW 1.38 | ✅ No chunking issue | Older FW, stable |
| MSO73304DX | FW 10.14.1 | ✅ Verified working | Legacy 70k reference |
| TekscopeSW | FW 2.16.9 | ✅ Verified working | Software oscilloscope |

---

## 17. tm_devices Quick Reference

### Installation
```bash
pip install tm-devices
# Optional pure-Python VISA backend:
pip install pyvisa-py
```

### Connection Pattern
```python
from tm_devices import DeviceManager
from tm_devices.helpers import PYVISA_PY_BACKEND

with DeviceManager(verbose=True) as dm:
    dm.visa_library = PYVISA_PY_BACKEND  # Optional: use PyVISA-py
    dm.setup_cleanup_enabled = True
    dm.teardown_cleanup_enabled = True

    scope = dm.add_scope("192.168.0.1")
    afg = dm.add_afg("192.168.0.2")
    smu = dm.add_smu("192.168.0.3", alias="smu1")
    awg = dm.add_awg("192.168.0.4")
    dmm = dm.add_dmm("192.168.0.5")
    psu = dm.add_psu("192.168.0.6")
```

### Key Concepts
- **tm_devices is NOT a SCPI command list** — it's a Python framework that composes SCPI at runtime
- Commands are Python objects: `device.commands.<subsystem>.<node>.<method>(value)`
- SCPI strings are assembled dynamically when `.write()` or `.query()` is called
- Use `.write(value, verify=True)` for write-with-verification
- Use `scope.set_and_check(":HORIZONTAL:SCALE", 100e-9)` for set-and-verify patterns
- Use `scope.expect_esr(0)` to check error status register
- Access raw PyVISA via `scope.visa_resource.write("raw SCPI")`

### Device Aliases
```python
dm.add_scope("192.168.0.1", alias="BOB")
scope = dm.get_scope("BOB")
```

### Global Constants for Arguments
- Logic: `"ON"`, `"OFF"`, `"ENABLE"`, `"DISABLE"`, `"RUN"`, `"STOP"`
- Trigger: `"RISE"`, `"FALL"`, `"EITHER"`
- Units: `"VOLT"`, `"AMP"`, `"OHM"`, `"WATT"`, `"HERTZ"`, `"SECOND"`
