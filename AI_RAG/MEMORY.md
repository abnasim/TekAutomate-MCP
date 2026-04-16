# TekAutomate — MEMORY.md
> Master knowledge document. Last harvested: 2026-03-13

This is the single source of truth for the TekAutomate automation authoring environment.
It covers architecture, schemas, code generation, Blockly integration, device management,
SCPI libraries, tm_devices, TekExpress, testing, distribution, and known bugs/fixes.

---

## 1. Architecture Overview

### What TekAutomate Is

TekAutomate is an automation authoring environment for **Tektronix and Keithley** test & measurement instruments. Users build workflows that control oscilloscopes, power supplies, SMUs, DMMs, AFGs, and TekExpress applications, then **export runnable Python scripts**.

### Delivery & Stack

| Attribute | Value |
|-----------|-------|
| Delivery | Web app (`http://dev.tek.com/TekAutomate`); optional Electron desktop packaging |
| Frontend | React, TypeScript, Google Blockly, CodeMirror |
| Code-gen | Client-side only — no backend server for Python generation |
| Persistence | Browser `localStorage` for workspace; JSON/XML file export |

### Two Authoring Modes

| Mode | Strength | Multi-device? |
|------|----------|---------------|
| **Steps Builder** | Linear step list, command library browser, single-device | ⚠️ Single device only |
| **Blockly Builder** | Drag-and-drop blocks, loops, variables, multi-device | ✅ Full multi-device |

Workflows convert **bidirectionally** between Steps ↔ Blockly.

### High-Level Data Flow

```
┌──────────────────┐        ┌──────────────────┐
│  Blockly Builder │◄──────►│   Steps Builder  │
│  (Multi-Device)  │ bidir  │  (Single Device) │
└────────┬─────────┘ sync   └────────┬─────────┘
         │                           │
         ▼                           ▼
┌──────────────────┐        ┌──────────────────┐
│  Clean Python    │        │  Legacy Python   │
│  (multi-device)  │        │  (single-device) │
│  ✅ Production   │        │  ⚠️ Limited      │
└──────────────────┘        └──────────────────┘
```

### Connection Types

| Type | VISA Resource String | Default Port | Notes |
|------|---------------------|--------------|-------|
| TCP/IP (VXI-11) | `TCPIP::<host>::INSTR` | auto (RPC portmapper) | No port needed |
| Socket | `TCPIP::<host>::<port>::SOCKET` | 4000 | Raw socket; NOT supported with tm_devices |
| USB | `USB::<vendor>::<product>::<serial>::INSTR` | — | e.g. `USB::0x0699::0x0522::INSTR` |
| GPIB | `GPIB<board>::<address>::INSTR` | — | Address 1-30, e.g. `GPIB0::1::INSTR` |

### VISA Resource String Builder (TypeScript)

```typescript
function getVisaResourceString(device: DeviceEntry): string {
  if (device.connectionType === 'tcpip') {
    return `TCPIP::${device.host}::INSTR`;
  } else if (device.connectionType === 'socket') {
    return `TCPIP::${device.host}::${device.port}::SOCKET`;
  } else if (device.connectionType === 'usb') {
    const serial = device.usbSerial ? `::${device.usbSerial}` : '';
    return `USB::${device.usbVendorId}::${device.usbProductId}${serial}::INSTR`;
  } else if (device.connectionType === 'gpib') {
    return `GPIB${device.gpibBoard}::${device.gpibAddress}::INSTR`;
  }
  return 'Unknown';
}
```

### Connection State Machine

Each device tracks: `online` → `acquiring` → `idle` → `offline`.

### DeviceEntry Interface

```typescript
interface DeviceEntry {
  id: string;                    // Unique identifier
  alias: string;                 // User-friendly name ("scope1", "psu")
  deviceType: 'SCOPE' | 'AWG' | 'PSU' | 'DMM' | 'SMU' | ...;
  backend: Backend;              // pyvisa | tm_devices | tekhsi | vxi11 | hybrid
  connectionType: ConnectionType; // tcpip | socket | usb | gpib
  host?: string;
  port?: number;
  enabled: boolean;
  // USB fields: usbVendorId, usbProductId, usbSerial
  // GPIB fields: gpibBoard, gpibAddress
}
```

### Device Binding Hierarchy

1. Command-level `instrumentAlias` (highest priority)
2. Group-level `instrumentAlias`
3. Default device (first enabled device)

```typescript
const cmdAlias = cmd.instrumentAlias || groupAlias;
const cmdInstrument = devices.find(d => d.alias === cmdAlias);
```

### Key Features Checklist

- [x] Multi-device workflows (scope + PSU + DMM in one workflow)
- [x] Multiple backends (PyVISA, tm_devices, TekHSI, VXI-11)
- [x] Hybrid mode (mix SCPI via PyVISA + waveforms via TekHSI)
- [x] Bidirectional Steps ↔ Blockly conversion
- [x] One-click Python export
- [x] Command libraries (SCPI, tm_devices, TekExpress)
- [x] TekAcademy in-app guidance
- [x] Optional Custom GPT round-trip (Blockly XML → GPT → re-import)

---

## 2. Step Types & Schema

### Flow Designer Node Types

```typescript
interface Flow {
  flow_id: string;
  name: string;
  trigger: { type: 'manual' | 'schedule' | 'event' };
  nodes: FlowNode[];
  variables?: Record<string, any>;
}
```

| Node Type | Purpose | Key Fields |
|-----------|---------|------------|
| **Trigger** | Flow entry point | `type`: manual / schedule / event |
| **Group** | Container for sequential commands | `instrumentAlias`, `commands[]` |
| **Condition** | If/else branching | `conditionExpression`, `nextTrue`, `nextFalse` |
| **Loop** | Iteration | `loopType` (while/do_until/for_each), `loopExpression` |
| **Delay** | Wait | `waitTime` (seconds) |
| **Verify** | Retry with verification | `verifyCmd` (default `*OPC?`), `expectedResponse` (default `1`), `retryCount` |
| **Python** | Custom code | `pythonCode`, `passCriteria`, `failCriteria` |
| **Terminate** | Flow exit | — |

### Steps Builder Step Types

| Step Type | Maps To | Python Output |
|-----------|---------|---------------|
| `connect` | Connection | `rm.open_resource(...)` |
| `write` | SCPI Write | `device.write('CMD')` |
| `query` | SCPI Query | `result = device.query('CMD?').strip()` |
| `sleep` | Delay | `time.sleep(N)` |
| `python` | Custom code | Inline Python |
| `comment` | Annotation | `# comment text` |
| `save_waveform` | Waveform save | `device.write('SAVE:WAVEFORM ...')` |
| `sweep` | Parameter sweep loop | `for i in range(start, stop, step):` |

Canonical naming note:
- Runtime `StepType` in `src/App.tsx` uses `write` and `query`.
- `scpi_write` / `scpi_query` are Blockly/internal naming forms seen in conversion/documentation contexts.

### Command Structure

```typescript
interface CommandLibraryItem {
  name: string;              // Display name
  scpi: string;              // SCPI command (may contain ${placeholders})
  description: string;
  category: string;
  params?: CommandParam[];   // Parameter definitions
  example?: string;
  tekhsi?: boolean;          // TekHSI-specific
}
```

### Parameter Substitution

```typescript
// Command: CH${channel}:SCALE ${scale}
// Values: { channel: 2, scale: 0.5 }
// Result: CH2:SCALE 0.5
function substituteSCPI(cmd, params, values) {
  let result = cmd;
  params.forEach(param => {
    const value = values[param.name] ?? param.default;
    result = result.replace(new RegExp(`\\$\\{${param.name}\\}`, 'g'), String(value));
  });
  return result;
}
```

### Query vs Write Detection

- **Query**: ends with `?` OR has `type: 'query'` → returns value, can store in variable
- **Write**: no `?` OR has `type: 'write'` → executes action, no return

### Graph Traversal (Python Generator)

```typescript
function traverse(nodeId: string): void {
  const node = nodeMap.get(nodeId);
  if (!node || visited.has(nodeId)) return;
  visited.add(nodeId);

  if (node.type === 'condition') {
    generateCondition(node);
    if (node.nextTrue) traverse(node.nextTrue);
    if (node.nextFalse) { generateElse(); traverse(node.nextFalse); }
  } else if (node.type === 'loop') {
    generateLoop(node);
    if (node.next) traverse(node.next);
    closeLoop();
  } else {
    generateNode(node);
    if (node.next) traverse(node.next);
  }
}
```

---

## 3. Backend System

### Supported Backends

| Backend | ID | Transport | Device Support | Install |
|---------|----|-----------|----------------|---------|
| **PyVISA** | `pyvisa` | TCP/IP, Socket, USB, GPIB | All devices | `pip install pyvisa` |
| **tm_devices** | `tm_devices` | TCP/IP, USB, GPIB (NO Socket) | MSO2/4/5/6, DPO5K/7K, AWG5K/7K, AFG3K, PSU, SMU, DMM | `pip install tm-devices` |
| **VXI-11** | `vxi11` | TCP/IP only | All devices (lightweight) | `pip install vxi11` |
| **TekHSI** | `tekhsi` | TCP/IP port 5000 only | MSO5/6, DPO7K only | `pip install tekhsi` |
| **Hybrid** | `hybrid` | PyVISA + TekHSI simultaneously | MSO5/6, DPO7K | Both packages |

> **Hybrid is NOT a fifth backend** — it is a *mode* where the same workflow uses
> more than one backend (e.g., SCPI via PyVISA + waveform capture via TekHSI).

### Backend Compatibility Matrix

| Backend | TCP/IP | Socket | USB | GPIB |
|---------|--------|--------|-----|------|
| PyVISA | ✅ | ✅ | ✅ | ✅ |
| tm_devices | ✅ | ❌ | ✅ | ✅ |
| VXI-11 | ✅ | ❌ | ❌ | ❌ |
| TekHSI | ✅ (port 5000) | ❌ | ❌ | ❌ |
| Hybrid | ✅ | ❌ | ✅ | ✅ |

### Backend Resolution Algorithm

Priority order when executing a command:
1. `cmd.backend` (command-level override)
2. `cmdInstrument?.backend` (instrument's own backend, via `cmd.instrumentAlias`)
3. `groupBackend` (group-level setting)
4. `defaultBackend` (device's DeviceEntry default)

```typescript
const effectiveBackend = cmd.backend ||
  cmdInstrument?.backend ||
  groupBackend ||
  defaultBackend;
```

### Hybrid Mode Routing

```typescript
// Detection logic
const isTmDevicesCommand = cmd.includes('.commands.') ||
  cmd.includes('.add_') || cmd.includes('.save_') ||
  cmd.includes('.turn_') || cmd.includes('.set_and_check');

const isTekHSI = (cmd.startsWith('scope.') && !isTmDevicesCommand) ||
  cmd.startsWith('#');

// Routing
if (isTekHSI) {
  output += `${varName} = ${clean}\n`;       // TekHSI gRPC call
} else if (isTmDevicesCommand) {
  output += `${varName} = ${cmd}\n`;          // tm_devices API
} else {
  output += `scpi.write(${JSON.stringify(cmd)})\n`; // PyVISA SCPI
}
```

### Generated Python — Hybrid Example

```python
# SCPI commands → PyVISA connection
scpi.write('*RST')

# TekHSI commands → gRPC connection
wfm = scope.get_data("CH1")

# tm_devices commands → DeviceManager
scope.commands.reset()
```

### Quick Decision Tree

```
DPO70k or older scope?          → PyVISA
MSO5/6, need high-level APIs?   → tm_devices
MSO5/6, need fast waveforms?    → Hybrid (TekHSI + PyVISA)
Linux without VISA drivers?     → VXI-11 or PyVISA-py
Multi-device management?        → tm_devices
Simple single-device?           → PyVISA
TekExpress compliance?          → PyVISA SOCKET (port 5000)
```

### Device-Specific Recommendations

**DPO70k Series (older)**:
- Recommended: PyVISA (most reliable)
- TCP/IP port 5025, Socket port 4000
- TekHSI NOT supported

**MSO6Xb Series (newer)**:
- Recommended: tm_devices or Hybrid
- TCP/IP port 5025, Socket port 4000, TekHSI port 5000
- Full tm_devices high-level API support

### Generated Code Structure

```python
#!/usr/bin/env python3
"""Generated by TekAutomate
Backend: [backend_name]
Device: [device_model]
Connection: [connection_string]
"""
import argparse
import time
import pathlib
# Backend-specific imports

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--timeout", type=float, default=5.0)
    args = parser.parse_args()

    try:
        # Connection setup
        # Automation commands
        pass
    except Exception as e:
        print(f"Error: {e}")
        raise
    finally:
        # Cleanup — close all device connections
        pass

if __name__ == "__main__":
    main()
```

---

## 4. Python Generator Rules

### Import Generation

The generator (`PythonGenerator.ts`) analyzes all devices to determine required imports:

```python
import pyvisa          # If PyVISA or tm_devices used
from tm_devices import DeviceManager  # If tm_devices used
import tekhsi          # If TekHSI or hybrid used
import time            # If any delay/wait steps
import pathlib         # If file save operations
```

### Per-Backend Connection Code

**PyVISA:**
```python
rm = pyvisa.ResourceManager()
scope = rm.open_resource('TCPIP::192.168.1.10::INSTR')
scope.timeout = 5000
```

**tm_devices:**
```python
from tm_devices import DeviceManager
dm = DeviceManager()
scope = dm.add_scope('TCPIP::192.168.1.10::INSTR')
```

**VXI-11:**
```python
import vxi11
scope = vxi11.Instrument('192.168.1.10')
```

**TekHSI:**
```python
from tekhsi import TekHSIConnect
with TekHSIConnect('192.168.1.10:5000') as scope:
    wfm = scope.get_data('CH1')
```

**Hybrid (PyVISA + TekHSI):**
```python
import pyvisa
from tekhsi import TekHSIConnect

rm = pyvisa.ResourceManager()
scpi = rm.open_resource('TCPIP::192.168.1.10::INSTR')  # SCPI path
with TekHSIConnect('192.168.1.10:5000') as scope:       # TekHSI path
    scpi.write('*RST')                # → PyVISA
    wfm = scope.get_data('CH1')       # → TekHSI
```

### Multi-Device Variable Naming

Each device gets its own Python variable based on its alias:

```python
scope = rm.open_resource('TCPIP::192.168.1.10::INSTR')
psu = rm.open_resource('TCPIP::192.168.1.15::INSTR')
dmm = rm.open_resource('TCPIP::192.168.1.20::INSTR')

psu.write('VOLT 3.3')
result = scope.query('CH1:SCALE?').strip()
dmm_reading = dmm.query('MEAS:VOLT:DC?').strip()
```

### Variable Context

```python
context = {}  # Runtime context for variables
result = devices['scope1'].query('CH1:SCALE?')
context['scale'] = result  # If outputVariable is set

# Use in later commands
if context.get('scale', 0) > 1.0:
    devices['scope1'].write('CH1:SCALE 0.5')
```

### Error Handling Pattern

```python
try:
    scope.write('*RST')
    # ... automation commands ...
except Exception as e:
    print(f"Error: {e}")
    raise
finally:
    for alias, device in devices.items():
        device.close()
```

### Cleanup Code (Blockly-generated)

```python
# Cleanup — close all instrument connections
for var_name in list(locals().keys()):
    try:
        obj = locals()[var_name]
        if hasattr(obj, 'close') and callable(obj.close):
            obj.close()
    except:
        pass
```

### Command Type → Python Mapping

| Command Type | Detection | Python Output |
|-------------|-----------|---------------|
| SCPI Write | No `?`, no dots | `device.write('CMD')` |
| SCPI Query | Ends with `?` | `result = device.query('CMD?').strip()` |
| tm_devices | Contains `.commands.`, `.add_`, `.save_`, `.turn_`, `.set_and_check` | `device.commands.ch[1].scale.write(1.0)` |
| TekHSI | Starts with `scope.` (not tm_devices) or `#` | `result = scope.get_data('CH1')` |
| Custom Python | `type: 'python'` | Inline code block |
| Wait/Delay | `type: 'sleep'` | `time.sleep(N)` |
| OPC Wait | `type: 'opc'` | `device.query('*OPC?')` |

### F-String Generation for Loop Variables

```python
for i in range(5):
    voltage = 1.0 + (i * 0.5)
    psu.write(f'VOLT {voltage}')
    scope.write(f'SAVE:WAVEFORM CH1, "capture_{i}.wfm"')
```

---

## 5. Blockly ↔ Steps Conversion

### Architecture

```
src/components/BlocklyBuilder/
├── BlocklyBuilder.tsx          # Main React component
├── BlocklyBuilder.css
├── types.ts                    # TypeScript interfaces
├── toolbox.ts                  # Block category definitions
├── blocks/
│   ├── index.ts               # Block registration
│   ├── connectionBlocks.ts    # Connect/Disconnect/Use Device
│   ├── scpiBlocks.ts          # SCPI Write/Query (legacy)
│   ├── enhancedScpiBlocks.ts  # SCPI Write/Query with parameter dropdowns (DEFAULT)
│   ├── channelBlocks.ts       # Configure Channel (scale, offset, coupling, termination)
│   ├── acquisitionBlocks.ts   # Acquisition control
│   ├── dataBlocks.ts          # Data handling
│   └── timingBlocks.ts        # Timing/delay
├── generators/
│   └── pythonGenerators.ts    # Python code generation
└── converters/
    ├── stepToBlock.ts         # Steps → Blockly converter
    └── blockToStep.ts         # Blockly → Steps converter
```

### Block Categories

| Category | Blocks |
|----------|--------|
| 🔌 Connection | Connect to Instrument, Disconnect, Use Device |
| 📺 SCPI | SCPI Write (enhanced), SCPI Query (enhanced), Custom Command |
| 🔄 Control | Repeat N times, For loop, If/else |
| 🧮 Variables & Math | Set variable, Get variable, Math operations |
| ⏱️ Timing | Wait seconds, Wait for OPC |
| 💬 Utility | Comment, Python Code |

### Blockly → Steps Conversion Table

| Blockly Block | Steps UI Step | Notes |
|--------------|---------------|-------|
| Connect to Instrument | Connect step | With device name |
| SCPI Write | Write step | — |
| SCPI Query | Query step | — |
| Wait N seconds | Sleep step | — |
| Wait for OPC | Python step (OPC code) | — |
| Comment | Comment step | — |
| Python Code | Python step | — |
| Save Waveform | Save waveform step | — |
| Repeat N times | Sweep step (loop) | — |
| For i = 0 to N | Sweep step (with loop var) | Converts start/stop/step |
| Set variable = expr | Python step (assignment) | — |
| Use Device: X | Comment (device switch) | Steps has no device context |

### Variable Name Resolution (Critical Fix)

**Problem**: Blockly stores variable **UUIDs**, not names internally.

**Solution**: Always use the workspace API:
```typescript
const varModel = workspace.getVariableById(id);
const varName = varModel.getName();  // "voltage", not "abc-123-def"
```

**Impact**: Without this fix, Python output contains random UUID strings instead of
human-readable variable names.

### Sweep Parameter Compatibility

**Problem**: Blockly uses `iterations`, Steps UI uses `start/stop/step`.

**Blockly for loop**: `for i = 0 to 4 step 1` (5 iterations)
**Steps sweep**: `start: 0, stop: 4, step: 1, iterations: 5`

Converter maps between these formats.

### Device Context Tracking

Blockly tracks which device each command targets by **walking back through the block chain**:

```typescript
// Walk up the block tree to find the nearest Connect block
function getDeviceContext(block: Blockly.Block): string {
  let current = block;
  while (current) {
    if (current.type === 'connect_to_instrument') {
      return current.getFieldValue('DEVICE_NAME');
    }
    current = current.getPreviousBlock();
  }
  return 'unknown';
}
```

### Visual Device Indicators

- SCPI blocks show `(device_name)` label: `📺 SCPI Write (scope)`
- **Color coding by device type**:
  - Scope → Blue shades (`#2563eb`, `#4f46e5`, `#7c3aed`)
  - PSU → Red (`#dc2626`)
  - DMM → Green (`#16a34a`)
  - Unknown → Gray (`#6b7280`)

### Enhanced SCPI Blocks (Default since v1.0)

Enhanced blocks (`scpi_write_enhanced`, `scpi_query_enhanced`) are now the **default**.
Old blocks renamed to `scpi_write_legacy` / `scpi_query_legacy`.

Features:
- **Auto-detect Write vs Query** from `?` suffix
- **Parameter dropdowns** auto-parsed from command (channels, modes, values)
- **Bidirectional sync**: changing dropdown updates command text and vice versa
- **Right-click context menu**:
  - 📖 Browse SCPI Commands
  - 🔄 Convert to tm_devices Command
  - 🔄 Refresh Parameters

### Parameter Types Detected

| Type | UI Element | Examples |
|------|-----------|----------|
| Channel (CH1-CH4) | Dropdown | CH1, CH2, CH3, CH4 |
| Reference (REF1-REF4) | Dropdown | REF1, REF2, REF3, REF4 |
| Math (MATH1-MATH4) | Dropdown | MATH1, MATH2, MATH3, MATH4 |
| Source (SOUrce1-4) | Dropdown | SOUrce1-SOUrce4 |
| Plot (PLOTView1-8) | Dropdown | PLOTView1-PLOTView8 |
| Mode/Enumeration | Dropdown | AUTO, MANual, ON, OFF |
| Numeric values | Text input | 1.0, 1e-6, 100 |

### SCPI ↔ tm_devices Conversion

Right-click any SCPI block → "Convert to tm_devices Command" → block **auto-replaces** with Python Code block.

| SCPI Command | tm_devices Path | Method | Value |
|-------------|-----------------|--------|-------|
| `CH1:SCALE 1.0` | `ch[1].scale` | `write` | `1.0` |
| `CH2:COUPLING DC` | `ch[2].coupling` | `write` | `DC` |
| `*IDN?` | `commands.idn` | `query` | — |
| `ACQUIRE:STATE?` | `acquire.state` | `query` | — |
| `MATH1:DEFINE "CH1+CH2"` | `math[1].define` | `write` | `"CH1+CH2"` |

Conversion algorithm:
1. Split SCPI by `:` → path components
2. Detect indexed components (`CH1` → `ch[1]`)
3. Lowercase, join with `.`
4. Determine method from `?` (query) or value presence (write)

### Configure Channel Block

```
📺 Configure Channel
  Channel: [CH1 ▼]  CH1/CH2/CH3/CH4
  Scale: [1.0] V
  Offset: [0] V
  Coupling: [DC ▼]  DC/AC/GND
  Termination: [1 MΩ ▼]  1 MΩ (ONEMEG) / 50 Ω (FIFTY)
```

Generates:
```python
scope.write('CH1:SCALE 1.0')
scope.write('CH1:OFFSET 0')
scope.write('CH1:COUPLING DC')
scope.write('CH1:TERMINATION FIFTY')
```

### Device Family to JSON File Mapping (Command Browser)

```typescript
const familyToFile: Record<string, string> = {
  '4/5/6 Series':        'mso_2_4_5_6_7.json',
  'DPO/MSO 5k_7k_70K':  'MSO_DPO_5k_7k_70K.json',
  'TekExpress':          'tekexpress.json',
  'DPOJET':              'dpojet.json',
  'AFG':                 'afg.json',
  'SMU':                 'smu.json',
};
```

### Collapsible Toolbox

"◀ Hide Blocks" / "▶ Show Blocks" button slides the Blockly toolbox to give more workspace area.

### Workspace Persistence

- Auto-saves to `localStorage` on every change
- Manual save → downloads `.xml` file
- Manual load → imports `.xml` file
- Import from Steps → converts existing JSON steps to blocks
- Export to Steps → converts blocks back to Steps format

### Steps UI Limitations (Multi-Device)

Steps UI was designed for **single-device** workflows. Known issues with multi-device:

1. **No Connect Step Generation**: `connect` steps exist but don't generate Python
2. **No Device Context Tracking**: all commands go to generic `scpi` variable
3. **Global Backend Config**: cannot mix backends per device
4. **Undefined Variables**: `psu`, `dmm` undefined if not globally configured

**Rule**: For multi-device workflows, **always use Blockly Builder and export Python from Blockly**.


---

## 6. Known Bugs & Fixes (Regression Matrix)

### Critical Fixes — Chronological

#### BUG-001: Variable Name Corruption (Blockly → Steps)
- **Symptom**: Steps Python output: `N%hHHhp:Bg=T0!BWtnrB = 0` instead of `i = 0`
- **Root cause**: `block.getFieldValue('VAR')` returns Blockly's internal UUID, not the name
- **Fix**: Use `workspace.getVariableById(id).getName()` at 3 locations in `blockToStep.ts`
- **Files**: `src/components/BlocklyBuilder/converters/blockToStep.ts`
- **Regression test**: Export any for-loop from Blockly to Steps, verify variable names

#### BUG-002: Sweep Parameter Mismatch (Blockly → Steps)
- **Symptom**: Steps UI gets `{ iterations, sweepType }` instead of `{ variableName, start, stop, step }`
- **Fix**: Map Blockly `controls_for` params to Steps sweep format
- **Correct params**: `{ variableName, start, stop, step, saveResults: false }`
- **Files**: `src/components/BlocklyBuilder/converters/blockToStep.ts`

#### BUG-003: Literal `\n` in python_code Blocks
- **Symptom**: `smu.source.function = "VOLT"\nsmu.output.enabled = True` — SyntaxError
- **Original fix**: Added `pythonCode.replace(/\\n/g, '\n')` — **THIS BROKE STRING LITERALS**
- **Second fix (pre-demo)**: **Removed** the replace. `\n` stays as escape sequence in output.
- **Rule**: `\n` in Python string literals is correct; converting to real newlines breaks `f.write("...\n")`
- **Files**: `src/components/BlocklyBuilder/generators/pythonGenerators.ts` (line ~1513)

#### BUG-004: OPC Query Return Type
- **Symptom**: `int(scope.commands.opc.query())` fails when response is `"1\n"`
- **Fix**: Use `.strip()` and string comparison: `opc.query().strip() == "1"`
- **Files**: `pythonGenerators.ts`

#### BUG-005: HARDCOPY:FORMAT String Interpolation
- **Symptom**: Generated Python has literal `${format}` instead of `PNG`
- **Fix**: Use `${format.toUpperCase()}` in template literal
- **File**: `pythonGenerators.ts` line 1264

#### BUG-006: UnicodeDecodeError After FILESYSTEM:READFILE
- **Symptom**: `UnicodeDecodeError: 'ascii' codec can't decode byte 0xe5`
- **Root cause**: `query('*OPC?')` after `READFILE` + `read_raw()` reads leftover PNG binary data
- **Fix**: Replace `query('*OPC?')` with `time.sleep(1.0)` after file operations
- **Rule**: NEVER use `*OPC?` after binary file transfer operations
- **Files**: `pythonGenerators.ts` (lines 1213-1283), `public/templates/basic.json`

#### BUG-007: Device Context Inside Loops
- **Symptom**: Measurement commands sent to `smu` instead of `scope` inside `controls_for` loops
- **Root cause**: Blocks inside `<statement name="DO">` have no previous block; `getPreviousBlock()` returns null
- **Fix**: Make `DEVICE_CONTEXT` field **absolute priority** in `getDeviceVariable()`:
```typescript
function getDeviceVariable(block) {
  // FIRST: Check explicit DEVICE_CONTEXT field
  const ctx = block.getFieldValue('DEVICE_CONTEXT');
  if (ctx && ctx.trim() !== '(?)' && ctx.trim() !== '()') {
    return ctx.replace(/[()]/g, '').trim(); // RETURN IMMEDIATELY
  }
  // FALLBACK: walk back through blocks...
}
```
- **Files**: `pythonGenerators.ts`

#### BUG-008: Float Loop Range
- **Symptom**: `for v in range(0.5, 2.5, 0.5)` — Python `range()` doesn't accept floats
- **Fix**: Detect floats, generate `while` loop instead:
```python
v = 0.5
while v <= 2.5:
    # loop body
    v += 0.5
```
- **Files**: `pythonGenerators.ts` (`controls_for` generator)

#### BUG-009: Variables Initialized to None
- **Symptom**: `vpp = None`, `frame = None` at top of script
- **Root cause**: Blockly default Python generator initializes all `<variables>` to None
- **Fix**: Override `variables_get` generator to prevent None initialization

#### BUG-010: Acquire Stopafter Enum
- **Symptom**: `scope.commands.acquire.stopafter.write("SEQUENCE")` fails on some drivers
- **Fix**: Use mixed-case `"SEQuence"` which is universally accepted

#### BUG-011: Backend Dropdown Not Preserved on XML Import
- **Symptom**: Import XML with `tm_devices` → dropdown shows `pyvisa`
- **Root cause**: `domToMutation` saved backend internally but didn't update the dropdown field
- **Fix**: Add `setTimeout(() => this.setFieldValue(this.currentBackend_, 'BACKEND'), 10)`
- **Files**: `connectionBlocks.ts` lines 301-330, 348-365

#### BUG-012: Steps UI Import Loses Device Config
- **Symptom**: Importing from Steps UI → connection blocks missing backend, IP, timeout
- **Fix**: Enhanced `convertStepToBlock()` to look up device in `devices` array and populate all fields
- **Files**: `stepToBlock.ts` lines 358-407

#### BUG-013: Asymmetric Cleanup (Only First Device Closed)
- **Symptom**: Only `scope.close()` generated, `smu.close()` missing
- **Root cause**: `disconnect` blocks were removing devices from tracking before cleanup ran
- **Fix**: Disconnect blocks generate nothing; cleanup extracts device names from generated code:
```typescript
const addDevicePattern = /(\w+)\s*=\s*device_manager\.add_(scope|smu|psu|dmm|afg|awg|device)\(/g;
```
- **Files**: `pythonGenerators.ts`, `BlocklyBuilder.tsx`

#### BUG-014: Browse SCPI Commands Shows "All (0)" in Blockly
- **Symptom**: Command browser opens with zero commands
- **Root cause**: Filter checked `category` and `commandGroup` but not `sourceFile`
- **Fix**: Enhanced filtering to check `sourceFile` property with family→file mapping
- **Files**: `BlocklyBuilder.tsx`

#### BUG-015: Set+Query Roundtrip Degradation
- **Symptom**: `set_and_query` steps become plain `scpi_write` after Steps→Blockly→Steps
- **Root cause**: `stepToBlock` converts to `scpi_write`, dropping the query half
- **Fix**: Preserve `set_and_query` metadata on imported blocks; restore during export
- **At-risk commands**: 4,975 across all instrument families
- **Canary test**: `e2e/set-and-query-canary.spec.ts`

#### BUG-016: GPT Generates Wrong Device Contexts
- **Symptom**: GPT outputs `<field name="DEVICE_CONTEXT">(smu)</field>` for scope commands like `CH1:SCAle`
- **Root cause**: GPT doesn't validate command prefix against device context
- **Mitigation (app-side)**: `validateCommandDeviceMapping()` in generator:
  - `:MEASUREMENT:`, `:CH1:`, `:ACQUIRE:` → scope only
  - `:SOURce:`, `:OUTPut:` → SMU/PSU only
- **Mitigation (GPT-side)**: Added visual wrong/correct examples to instructions v6
- **Files**: `pythonGenerators.ts`, `CUSTOM_GPT_INSTRUCTIONS.txt`

#### BUG-017: IP Conflict Detection
- **Status**: Working at generator level — throws "RESOURCE COLLISION DETECTED"
- **Gap**: No UI-level warning before generation

### Pre-Demo Fixes (Jan 30, 2026)

All 7 items fixed for Monday director/senior demo:
1. ✅ Python code block newline handling (BUG-003 second fix)
2. ✅ Backend dropdown preserved on XML import (BUG-011)
3. ✅ Clean timestamped export filenames: `workflow_20260130_143022.xml`
4. ✅ tm_devices blocks colored purple (270°), TekHSI orange (30°), VXI-11 teal (180°)
5. ✅ Steps UI import preserves device config (BUG-012)
6. ✅ Helper files verified in distribution ZIP
7. ✅ Custom GPT TekscopePC rules added

### Validation Functions in Generator

| Validator | What It Catches |
|-----------|----------------|
| Backend Compatibility | tm_devices backend + `scpi_write` blocks → error |
| IP Conflict Detection | Two devices with same IP → error |
| Command-to-Device Mapping | Scope SCPI on SMU device → error |
| Variable Usage | Assigned but unused variables → warning |
| Device Usage | Connected but unused devices → warning |

### Blockly API Deprecation Warning

```
Blockly.Workspace.getVariableById was deprecated in v12, deleted in v13.
Use Blockly.Workspace.getVariableMap().getVariableById instead.
```

**Status**: Not yet migrated. Will break on Blockly v13 upgrade.


---

## 7. Device Context Rules

### Context Resolution Priority

1. **Explicit `DEVICE_CONTEXT` field** on block (absolute priority, return immediately)
2. Walk `getPreviousBlock()` chain to find nearest `connect_to_instrument`
3. Walk parent blocks (for blocks nested inside loops/conditions)
4. Fall back to `currentDeviceContext` module variable

### Command-to-Device Validation Rules

| SCPI Prefix Pattern | Required Device Type |
|--------------------|-----------------------|
| `:MEASUREMENT:`, `:CH1:`–`:CH4:`, `:ACQUIRE:`, `:HORIZONTAL:`, `:TRIGGER:`, `:SEARCH:`, `:WAVEFORM:` | Scope |
| `:SOURce:`, `:OUTPut`, `:MEASure:` (Keithley) | SMU / PSU |
| `TEKEXP:*` | TekExpress |

Generator throws `COMMAND-TO-DEVICE MAPPING ERROR` if a scope command targets an SMU or vice versa.

### Color Coding (Visual Indicators)

| Device | Block Color | Hex |
|--------|------------|-----|
| Scope | Blue | `#2563eb` / `#4f46e5` / `#7c3aed` |
| PSU | Red | `#dc2626` |
| DMM | Green | `#16a34a` |
| Unknown | Gray | `#6b7280` |

### Backend Color Coding (Connection Blocks)

| Backend | Hue | Color |
|---------|-----|-------|
| PyVISA | 120 | Green |
| tm_devices | 270 | Purple |
| TekHSI | 30 | Orange |
| Hybrid | 60 | Yellow |
| VXI-11 | 180 | Teal |

### Device Naming Convention

| Alias | Instrument Type |
|-------|----------------|
| `scope` / `scope1`, `scope2` | Oscilloscopes |
| `psu` | Power Supply Unit |
| `dmm` | Digital Multimeter |
| `awg` | Arbitrary Waveform Generator |
| `afg` | Arbitrary Function Generator |
| `smu` | Source Measure Unit |
| `sa` | Spectrum Analyzer |

### GPT Device Context Error Pattern

The Custom GPT **persistently** generates incorrect DEVICE_CONTEXT for multi-instrument workflows. Common error:

```xml
<!-- ❌ WRONG: Scope command with SMU context -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">CH1:SCAle 1.0</field>
</block>
```

**Prefix → Context mapping for GPT:**
- `CH1:|ACQuire:|MEASU:|DATa:` → `(scope)`
- `:SOURce:|:OUTPut:|:MEASure:` → `(smu)` / `(psu)`

---

## 8. Screenshot Capture Patterns

### Scope Family Command Summary

| Feature | MSO 4/5/6 Series | MSO/DPO 70000 Series |
|---------|-----------------|---------------------|
| Trigger screenshot | `SAVE:IMAGe "path.png"` | `EXPort:FILEName "path"` + `EXPort START` |
| Set format | Extension in filename | `EXPort:FORMat PNG` |
| Set view | `SAVE:IMAGe:VIEWTYpe FULLScreen` | `EXPort:VIEW FULLSCREEN` |
| Set colors | `SAVE:IMAGe:COMPosition NORMal` | `EXPort:PALEtte COLOR` |
| Transfer file | `FILESystem:READFile` | `FILESystem:READFile` |
| Binary format | Raw PNG bytes (no IEEE header) | Raw PNG bytes (no IEEE header) |
| Working dir | `C:/Users/Public/Tektronix/TekScope` | `C:/TekScope` |
| Temp dir | `C:/Temp` | `C:/TekScope` |

**Tested firmware**: MSO68B FW 2.20.8, MSO73304DX FW 10.14.1, TekscopeSW FW 2.16.9

### Three Screenshot Methods

| Method | Scope Models | Speed | Implementation |
|--------|-------------|-------|----------------|
| `HARDCOPY:DATA?` | Legacy 5k/7k/70k ONLY | Fastest | Not yet implemented |
| `HARDCOPY PORT FILE` | Legacy 5k/7k/70k ONLY | Medium | ✅ Fixed |
| `SAVE:IMAGE + FILESYSTEM` | Modern MSO5/6 ONLY | Medium | ✅ Working |

### MSO 4/5/6 Screenshot Flow

```python
scope.write('SAVE:IMAGe:VIEWTYpe FULLScreen')    # optional
scope.write('SAVE:IMAGe:COMPosition NORMal')       # optional
scope.write('SAVE:IMAGe "C:/Temp/screenshot.png"') # format from extension!
time.sleep(1.0)  # ✅ Use sleep, NOT *OPC?
scope.write('FILESystem:READFile "C:/Temp/screenshot.png"')
data = scope.read_raw()
scope.write('FILESystem:DELEte "C:/Temp/screenshot.png"')
```

### MSO/DPO 70000 Screenshot Flow

```python
scope.write('EXPort:FILEName "C:/TekScope/screenshot.png"')
scope.write('EXPort:FORMat PNG')
scope.write('EXPort:VIEW FULLSCREEN')
scope.write('EXPort:PALEtte COLOR')
scope.write('EXPort START')          # case sensitive!
time.sleep(1.0)
scope.write('FILESystem:READFile "C:/TekScope/screenshot.png"')
data = scope.read_raw()
scope.write('FILESystem:DELEte "C:/TekScope/screenshot.png"')
```

### Scope Series Auto-Detection

```python
def detect_scope_series(idn_string):
    model = idn_string.upper().split(',')[1].strip()
    if model.startswith('MSO7') or model.startswith('DPO7'):
        return 'mso70k'   # Use EXPort START
    if model.startswith('MSO4') or model.startswith('MSO5') or \
       model.startswith('MSO6') or 'TEKSCOPESW' in idn_string.upper():
        return 'mso456'   # Use SAVE:IMAGe
    return 'unknown'
```

### CRITICAL: `*OPC?` After File Transfer = UnicodeDecodeError

**NEVER** use `query('*OPC?')` after `FILESYSTEM:READFILE` + `read_raw()`.
The PNG binary data contaminates the read buffer.

```
UnicodeDecodeError: 'ascii' codec can't decode byte 0xe5 in position 2
```

**Fix**: Use `time.sleep(1.0)` instead of `*OPC?` after all file operations.

### Commands That DO NOT Work (MSO 4/5/6)

- `SAVE:IMAGe:FILEFormat?` — use extension in filename
- `SAVE:IMAGe:INKSaver?` — not supported
- `SAVE:IMAGe:LAYout?` — not supported
- `EXPort` commands — use `SAVE:IMAGe` instead
- `HARDCopy` commands — use `SAVE:IMAGe` instead

### Commands That DO NOT Work (MSO/DPO 70000)

- `SAVE:IMAGe` — use `EXPort` instead
- `HARDCopy:DATA?` — not supported
- `EXPort` (no parameter) — must use `EXPort START`
- `EXPort:STARt` (mixed case) — case sensitive, use `START`

### PyVISA Binary Read (Reliable Method)

```python
# Use visalib.read() for reliable binary transfer
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

### PNG Header Validation & Realignment

```python
png_magic = b'\x89PNG\r\n\x1a\n'
if data[:8] != png_magic:
    idx = data.find(png_magic)
    if idx > 0:
        data = data[idx:]  # Strip garbage before PNG header
```

---

## 14. Raw Socket Communication

### Why Raw Sockets Are Needed

`FILESystem:READFile` is **intentionally non-SCPI-compliant**:
- It is a *command* that produces output (violates IEEE 488.2)
- No block header (`#<n><length><data>`)
- No termination character
- Terminated only by `<EOI>` (not visible on raw sockets)
- Newlines can appear inside the binary data
- Errors not recognizable during data output

**VISA cannot reliably consume this stream.** Raw TCP socket with timeout-based EOF is required.

### Transport Selection Matrix

| Operation | Required Transport | Reason |
|-----------|-------------------|--------|
| `*IDN?`, config, measurements | PyVISA | Message-based |
| `HARDCopy:DATA?` | PyVISA INSTR only | Definite-length block |
| `SAVE:IMAGe` + `READFile` | Raw socket | Stream-based |
| `FILESystem:READFile` | Raw socket | Stream-based |
| Large `CURVe?` waveforms | Raw socket (preferred) | Stream ambiguity |

### Pipeline Priming (CRITICAL — NOT Optional)

Before `FILESystem:READFile` works over raw sockets, the scope's UI subsystems must be primed:

```python
# Prime internal UI state machines
for cmd in [
    'SAVE:IMAGe:FILEFormat?',
    'SAVE:IMAGe:COMPosition?',
    'SAVE:IMAGe:VIEWTYpe?',
    'SAVE:IMAGe:INKSaver?',
    'SAVE:IMAGe:LAYout?',
    'FILESystem:CWD?',
]:
    scope.write('*CLS')
    scope.query(cmd)
```

**Why this works**: These queries initialize internal UI handlers. Without them, the `SAVE:IMAGe` pipeline is half-initialized and `READFile` prints nothing or stale buffers.

### Timeout-Based EOF Detection

```python
def read_timeout_based(sock, timeout=5):
    sock.settimeout(timeout)
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
                break  # Timeout = EOF
    return bytes(data)
```

### One-Shot Binary Window Rule

After sending `FILESystem:READFile`, you must:
- **NOT** query anything (`*OPC?`, `*ESR?`, `*CLS`)
- **NOT** send any other SCPI command
- Let the socket stay in raw streaming mode until timeout
- The daemon passes binary through **only during this window**

### Helper Files in `helper/` Folder

| File | Purpose |
|------|---------|
| `socket_instr.py` | Core socket communication class (mimics PyVISA API) |
| `socket_curve_and_img_fetch.py` | Waveform acquisition + screenshot example |
| `socket_fetch_image_multiple.py` | Multi-screenshot capture with state machine priming |

### Performance Comparison

| Operation | PyVISA (TCPIP::INSTR) | Raw Socket (port 4000) |
|-----------|-----------------------|------------------------|
| Screenshot (PNG) | ❌ Timeout | ✅ 2-3 seconds |
| 10M sample waveform | 8-12 seconds | 4-6 seconds |
| Simple SCPI query | 50-100ms | 30-50ms |

### Formal Specification (for docs/agents)

> `FILESystem:READFile` is a command (not a query) that produces unframed binary output.
> It omits IEEE 488.2 block headers and is terminated only by EOI.
> VISA-based APIs cannot reliably consume this output.
> Raw TCP socket access with timeout-based EOF detection is required.


---

## 9. SCPI Command Library Structure

### Library Statistics

- **34 command groups**, **2,952 total commands** (MSO Programmer Manual)
- Stored in JSON files under `public/commands/`
- Organized by instrument family

### JSON File Mapping

| Family | JSON File | Approx Commands |
|--------|-----------|----------------|
| MSO 2/4/5/6/7 Series | `mso_2_4_5_6_7.json` | 2,753 |
| MSO/DPO 5k/7k/70K | `MSO_DPO_5k_7k_70K.json` | 1,479 |
| TekExpress | `tekexpress.json` | 49 |
| DPOJET | `dpojet.json` | 88 |
| AFG | `afg.json` | 65 |
| SMU | `smu.json` | 63 |
| AWG | `awg.json` | 211 |
| RSA | `rsa.json` | 3,722 |

### Command JSON Schema (Required Fields)

```json
{
  "id": "unique-id",
  "category": "acquisition",
  "scpi": "ACQuire:STATE",
  "header": "ACQuire:STATE",
  "commandType": "set|query|both",
  "shortDescription": "Brief description",
  "description": "Full description",
  "mnemonics": ["ACQuire", "STATE"],
  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6"],
    "models": ["MSO4XB", "MSO5XB"]
  },
  "arguments": [
    {
      "name": "state",
      "type": "enumeration",
      "validValues": { "type": "enumeration", "values": ["RUN", "STOP", "ON", "OFF"] }
    }
  ],
  "syntax": {
    "set": "ACQuire:STATE {RUN|STOP}",
    "query": "ACQuire:STATE?"
  },
  "codeExamples": [
    {
      "scpi": { "code": "ACQuire:STATE RUN" },
      "python": { "code": "scope.write('ACQuire:STATE RUN')" },
      "tm_devices": { "code": "scope.commands.acquire.state.write('RUN')" }
    }
  ]
}
```

### SCPI Argument Types

| Type | Symbol | Example |
|------|--------|---------|
| Integer | `<NR1>` | `8`, `-5`, `100` |
| Float (no exponent) | `<NR2>` | `3.14`, `-0.5` |
| Float (scientific) | `<NR3>` | `1.5E-6`, `2.5E+3` |
| Enumeration | unquoted text | `SAMple`, `ON`, `OFF` |
| Quoted string | `<QString>` | `"filename.png"` (max 1000 chars) |
| Block data | `<Block>` | Binary data |

### Constructed Mnemonics

| Symbol | Meaning | Range |
|--------|---------|-------|
| `CH<x>` | Channel | ≥1, limited by model |
| `MATH<x>` | Math waveform | ≥1 |
| `REF<x>` | Reference waveform | ≥1 |
| `MEAS<x>` | Measurement | ≥1 |
| `B<x>` | Bus | ≥1 |
| `SEARCH<x>` | Search | ≥1 |
| `PLOTView<x>` | Plot view | 1 |
| `WAVEView<x>` | Waveform view | 1 |

### Command Abbreviation Rules

- Uppercase portion is required, lowercase is optional
- `ACQuire:NUMAvg` → minimum `ACQ:NUMA` or `acq:numa`
- **Recommendation**: Use full spelling for most robust code

### Command Concatenation

```scpi
# Separate headers with ; and :
TRIGger:A:MODe NORMal;:ACQuire:NUMAVg 8

# Same subsystem omit beginning colon
ACQuire:MODe ENVelope;NUMAVg 8

# Never precede * commands with colon
ACQuire:STATE 1;*OPC
```

### Major Command Groups

| Group | Commands | Description |
|-------|----------|-------------|
| Acquisition | 15 | Start/stop, mode, averaging |
| Measurement | 367 | Automated measurements |
| Search & Mark | 650 | Waveform search (largest group) |
| Bus | 339 | Protocol decode (CAN, I2C, SPI, USB, etc.) |
| Trigger | 266 | Edge, pulse, logic triggers |
| Power | 268 | Power analysis measurements |
| Display | 130 | Graticule, view modes |
| Cursor | 121 | Cursor control |
| Math | 85 | Math waveforms |
| Horizontal | 48 | Timebase |
| Waveform Transfer | 41 | Data point transfer |
| File System | 19 | File I/O on instrument |

### PI Command Translator

Modern Tektronix oscilloscopes (FW v1.30+) include a built-in PI Command Translator that auto-converts legacy DPO7000/MSO5000 commands to modern equivalents.

---

## 10. tm_devices Integration

### Core Concept

**tm_devices is NOT a SCPI command list. It is a Python command framework that composes SCPI at runtime.**

SCPI strings do not exist as static data. They are built when a method is executed:

```python
afg.source[1].frequency.write(1e6)
# Internally generates: :SOURce1:FREQuency 1000000
```

### Connection Pattern

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B

with DeviceManager(verbose=True) as dm:
    dm.setup_cleanup_enabled = True
    dm.teardown_cleanup_enabled = True
    scope: MSO6B = dm.add_scope("192.168.0.1")
```

### Device Registration Methods

| Method | Device Type |
|--------|------------|
| `dm.add_scope(addr)` | Oscilloscopes |
| `dm.add_smu(addr)` | Source Measure Units |
| `dm.add_afg(addr)` | Arbitrary Function Generators |
| `dm.add_awg(addr)` | Arbitrary Waveform Generators |
| `dm.add_psu(addr)` | Power Supplies |
| `dm.add_dmm(addr)` | Digital Multimeters |

### Command Tree Navigation

```python
# Scope commands
scope.commands.acquire.state.write("ON")
scope.commands.ch[1].scale.write(1.0)
scope.commands.horizontal.scale.write(1e-3)
scope.commands.trigger.a.level.write(1.5)
scope.commands.measurement.meas[1].source.write("CH1")
scope.commands.opc.query()  # *OPC?

# SMU commands (TSP-based, Lua functions)
smua = smu.commands.smu["a"]
smua.source.func = smua.OUTPUT_DCVOLTS
smua.source.levelv = 5.0
smua.source.output = smua.OUTPUT_ON
voltage = smua.measure.v()

# AFG commands
afg.source[1].frequency.write(1e6)
afg.source[1].amplitude.write(2.0)
afg.output[1].state.write("ON")
```

### Key Methods

| Method | Purpose |
|--------|---------|
| `.write(value)` | Set parameter |
| `.query()` | Read parameter |
| `.write(value, verify=True)` | Set and verify |
| `scope.set_and_check(cmd, value)` | Alternative set+verify |
| `scope.expect_esr(0)` | Assert no errors |
| `scope.save_screenshot(name)` | Save screenshot |
| `scope.curve_query(ch, output_csv_file=path)` | Waveform data |
| `scope.turn_channel_on("CH1")` | High-level helper |
| `scope.add_new_math("MATH1", "CH1")` | Add math waveform |
| `scope.generate_function(...)` | Built-in AFG |

### tm_devices Full Tree JSON

`public/commands/tm_devices_full_tree.json` is a structural map of the command object graph:
- Every command group, subcommand, indexed factory, callable method
- Model-specific availability
- Used for **validation and discovery**, not execution
- **Not a flat SCPI list**

### QString Handling

When generating code for tm_devices, string arguments must be properly quoted:

```python
# WRONG: msob.commands.application.activate.write(TekExpress PCI)
# CORRECT: msob.commands.application.activate.write("TekExpress PCI")
```

Auto-quote detection: numbers, booleans, None, and already-quoted values need no quoting.
Plain text and paths need `"..."` wrapping.

### VISA Backend Selection

```python
from tm_devices.helpers import PYVISA_PY_BACKEND, SYSTEM_DEFAULT_VISA_BACKEND
dm.visa_library = PYVISA_PY_BACKEND   # "@py" - pure Python, no NI-VISA
dm.visa_library = SYSTEM_DEFAULT_VISA_BACKEND  # "@ivi" - system VISA
```

### Supported Instruments (70+ models)

**Oscilloscopes (22)**: MSO2/4/4B/5/5B/6/6B, DPO2K/4K/5K/7K, MDO3K/4K, TekScopePC
**AFGs (7)**: AFG3K, AFG3KB, AFG3KC, AFG31K
**AWGs (4)**: AWG5K, AWG5200, AWG7K, AWG70K
**SMUs (20)**: SMU2400, SMU2450, SMU2460/61/70, SMU260xB series, SMU263xB series
**PSUs**: PWS4000, PWS2000
**DMMs**: DMM6500, DMM7510

---

## 11. TekExpress Integration

### Critical Principle

> TekExpress commands are SCPI strings sent over a PyVISA SOCKET backend.
> **Never generate raw `socket.sendall()` code.** Only SCPI via `.write()`/`.query()`.

### Connection

```python
import pyvisa
rm = pyvisa.ResourceManager()
tekexp = rm.open_resource("TCPIP::localhost::5000::SOCKET")
tekexp.write_termination = "\n"
tekexp.read_termination = "\n"
tekexp.timeout = 30000
```

### Control Plane Separation

| Control Plane | Transport | Port | Commands |
|--------------|-----------|------|----------|
| Scope Control | VXI-11 / HiSLIP / Socket | 4000 | `ACQuire:`, `CH1:`, `MEASurement:` |
| TekExpress Control | TCP Socket | 5000 | `TEKEXP:*` |
| File Transfer | Same as TekExpress | 5000 | Binary after `TEKEXP:EXPORT` |

### State Machine Execution

```python
tekexp.write("TEKEXP:STATE RUN")
while True:
    state = tekexp.query("TEKEXP:STATE?").strip()
    if state == "COMPLETE":
        break
    if state in ("WAIT", "ERROR"):
        popup = tekexp.query("TEKEXP:POPUP?")
        print(f"Popup: {popup}")
        tekexp.write('TEKEXP:POPUP "OK"')
    time.sleep(2)
```

### Key Differences from Scope SCPI

| Feature | Scope SCPI | TekExpress SCPI |
|---------|------------|----------------|
| Synchronization | `*OPC?` | `TEKEXP:STATE?` polling |
| Execution | Immediate | State machine (async) |
| User Interaction | None | Popup handling required |
| Timeouts | Standard (seconds) | Extended (minutes) |

### Generator Rules

1. **Never generate raw socket code** — only `.write()`/`.query()`
2. **Termination handled by config** — don't embed `\n` in commands
3. **Use `TEKEXP:STATE?` not `*OPC?`** — `*OPC?` not supported
4. **Handle popups** — TekExpress may pause for user input

### Backend Compatibility

| Backend | TekExpress? | Notes |
|---------|------------|-------|
| PyVISA (SOCKET) | ✅ | **Recommended** — only supported method |
| PyVISA (INSTR) | ❌ | Requires socket |
| tm_devices | ❌ | Not designed for TekExpress |
| TekHSI | ❌ | Different protocol |
| VXI-11 | ❌ | Requires socket |

### Conditional Arguments in TekExpress JSON

```json
{
  "name": "value",
  "dependsOn": "parametername",
  "validValues": {
    "type": "enumeration",
    "conditionalValues": {
      "ParameterName1": ["Value1", "Value2"],
      "ParameterName2": ["Value3", "Value4"]
    }
  }
}
```

---

## 12. Multi-Device Workflow Patterns

### Recommended Pattern: Blockly for Multi-Device

```python
#!/usr/bin/env python3
import time
import pyvisa

rm = pyvisa.ResourceManager()

# Connect devices
scope = rm.open_resource('TCPIP::192.168.1.10::INSTR')
scope.timeout = 5000
psu = rm.open_resource('TCPIP::192.168.1.15::INSTR')
psu.timeout = 5000

try:
    # Configure scope
    scope.write('CH1:SCALE 1.0')
    scope.write('ACQUIRE:STATE OFF')

    # Voltage sweep
    for i in range(5):
        voltage = 1.0 + (i * 0.5)
        psu.write(f'VOLT {voltage}')
        time.sleep(0.5)  # Settle time
        scope.write('ACQUIRE:STOPAFTER SEQUENCE')
        scope.write('ACQUIRE:STATE ON')
        scope.query('*OPC?')
        scope.write(f'SAVE:WAVEFORM CH1, "C:/Captures/capture_{i}.wfm"')

finally:
    scope.close()
    psu.close()
```

### tm_devices Multi-Device Pattern

```python
from tm_devices import DeviceManager
from tm_devices.drivers import MSO6B, SMU2450

with DeviceManager(verbose=True) as dm:
    dm.setup_cleanup_enabled = True
    dm.teardown_cleanup_enabled = True
    scope: MSO6B = dm.add_scope("192.168.1.100")
    smu: SMU2450 = dm.add_smu("192.168.1.101")

    scope.commands.ch[1].scale.write(1.0)
    smu.write(':SOURce:FUNCtion VOLTage')
    smu.write(':SOURce:VOLTage:LEVel 1.0')
    smu.write(':OUTPut ON')

    v = 0.5
    while v <= 2.5:
        smu.write(f':SOURce:VOLTage:LEVel {v}')
        time.sleep(0.5)
        scope.commands.acquire.state.write('OFF')
        scope.commands.acquire.stopafter.write('SEQuence')
        scope.commands.acquire.state.write('ON')
        scope.commands.opc.query()
        v += 0.5

    smu.write(':OUTPut OFF')
```

### Scope + TekExpress Hybrid Workflow

Use scope for waveform setup, TekExpress for compliance:

```python
# Scope connection (PyVISA INSTR)
scope = rm.open_resource('TCPIP::192.168.1.10::INSTR')

# TekExpress connection (PyVISA SOCKET)
tekexp = rm.open_resource('TCPIP::localhost::5000::SOCKET')
tekexp.write_termination = '\n'
tekexp.read_termination = '\n'

# Configure scope
scope.write('CH1:SCALE 0.5')
scope.write('HORIZONTAL:SCALE 1e-9')

# Run TekExpress compliance test
tekexp.write('TEKEXP:STATE RUN')
# ... poll TEKEXP:STATE? ...
```

### Steps UI Limitation

Steps UI **cannot** generate correct multi-device Python:
- No `connect` step code generation
- Global `scpi` variable only
- `psu`, `dmm` variables undefined

**Rule**: Always use Blockly Python export for multi-device workflows.


---

## 13. Test Infrastructure

### Test Commands Quick Reference

```bash
npm test                    # Unit tests (Jest) — run before every commit
npm run test:scpi           # SCPI JSON structure + generated code validation
npm run test:scpi-schema    # AJV schema: every {param} has identifier
npm run test:product        # Every command → step → Python (~13k commands)
npm run test:param-pipeline # Every {param} resolves through pipeline (~8k cmds)
npm run test:generator      # appGenerator.ts function-level unit tests
npm run test:python-validate# Generated Python compiles + runs with mock PyVISA
npm run test:e2e            # All Playwright E2E tests (requires dev server)
npm run test:regression     # Regression scenarios only (~60s)
npm run test:ci             # Full CI sequence: unit → scpi → e2e
npm run test:e2e:ui         # Playwright GUI (interactive)
```

### Unit Test Suites (Jest)

| File | Coverage |
|------|---------|
| `stepToPython.test.ts` | write, query, sleep, comment, python, set_and_query, groups, edge cases |
| `appGenerator.test.ts` | 38 tests: substituteSCPI, genStepsClassic, genStepsTekHSI, genStepsVxi11, multi-device |
| `appGenerator.negative.test.ts` | 33 negative tests: missing params, empty commands, null values |
| `generatorSnapshots.test.ts` | Snapshot regression: frozen Python for known step sequences |
| `generatorEdgeCases.test.ts` | Connect steps emit no SCPI, empty groups, invalid commands |
| `paramBinding.test.ts` | `{param}` → UI → generator → Python value |
| `realGeneratorPaths.test.ts` | Complex paths from App.tsx (TekHSI, Vxi11, multi-device) |
| `scpiCommandValidator.test.ts` | JSON structure completeness per device family |
| `scpiParameterExposure.test.ts` | AJV: every command has ID, `{param}` commands declare args |
| `pythonRuntimeValidation.test.ts` | `py_compile` + mock PyVISA execution *(skips if no Python)* |

### SCPI Corpus Tests (Playwright, Data-Driven)

Writes+queries every command from every JSON file, exports Python, checks SCPI strings appear:

```bash
npx playwright test scpi-corpus --reporter=line  # ~102 groups, 15-20 min
$env:FULL_CORPUS="true"; npx playwright test scpi-corpus  # +RSA, ~608 groups, 85-100 min
```

Output: `e2e-output/scpi-corpus/analysis-report.md`

### E2E Coverage Matrix

| Area | Covered |
|------|---------|
| Steps-only | Default palette, Save Waveform, Screenshot, Recall, generated code |
| Blockly-only | Toolbar actions, Browse Commands, Add to workspace, Export to Steps |
| Roundtrip | Steps → Blockly → Steps (write/query), set_and_query canary |

### E2E Test Files

- `e2e/default-controls.spec.ts`
- `e2e/flow-fidelity.spec.ts`
- `e2e/set-and-query-canary.spec.ts`
- `e2e/regression.spec.ts`
- `e2e/scpi-corpus.spec.ts`

### Known Gaps

1. Exhaustive option permutations per step type
2. Full Blockly block option permutations
3. Save Waveform advanced options across Steps ↔ Blockly
4. Multi-device binding permutations for save_screenshot/save_waveform/recall
5. Negative-path UX assertions (disabled states, validation messages)

### XML Example Validation (Pre-Demo)

7/7 examples validated, 7/7 error-free:
- `basic_setup_waveform.xml` — Fixed missing TERMINATION field
- `Save_Screenshot_Legacy.xml` — Valid
- `TekExpress_DisplayPort.xml` — Valid
- `TekExpress_PCIe_Example.xml` — Valid
- `TekExpress_USB.xml` — Fixed 6 issues
- `TekExpress_USB31_Example.xml` — Valid
- `Voltage sweep with SMU.xml` — Valid

---

## 15. SCPI Parameter System

### SCPIParameterSelector Component

`src/components/SCPIParameterSelector.tsx` — reusable across Blockly, Steps UI, and Command Browser.

### Parameter Detection Pipeline

1. `parseSCPI(command)` — parse command structure
2. `detectEditableParameters(parsed)` — detect mnemonics + arguments
3. Enrich with library metadata (options, descriptions)
4. Generate UI (dropdowns / text inputs)
5. Bidirectional sync: dropdown ↔ command text

### Parameter Types

| Type | UI | Detection |
|------|----|-----------|
| Channel (CH1-CH4) | Dropdown | Mnemonic `CH<x>` |
| Reference (REF1-REF4) | Dropdown | Mnemonic `REF<x>` |
| Math (MATH1-MATH4) | Dropdown | Mnemonic `MATH<x>` |
| Source (SOUrce1-4) | Dropdown | Mnemonic `SOUrce<x>` |
| Plot (PLOTView1-8) | Dropdown | Mnemonic `PLOTView<x>` |
| Mode/Enumeration | Dropdown | From `{OPTION1|OPTION2}` syntax |
| Numeric | Text input | `<NR1>`, `<NR2>`, `<NR3>` |

### Query Mark Handling

- Commands ending with `?` auto-create **Query** blocks (not Write)
- `?` is removed from command field (implied for query blocks)
- Default variable name `result` is set

### Full Syntax Parsing

Now uses `manualEntry.syntax` instead of just the command header, so **both** mnemonic AND argument parameters appear:

```
DISplay:REFFFTView<x>:CURSor:ROLOCATION {GRATICULE|BADGE}
→ View: [REFFFTView4 ▼]     ← mnemonic parameter
→ Location: [GRATICULE ▼]   ← argument parameter
```

### Parameters Always Visible

Removed the hidden settings toggle. Parameters are **always visible** when a command has editable parameters — no extra clicks needed.

---

## 16. SCPI ↔ tm_devices Conversion

### Conversion Utility

`src/utils/scpiToTmDevicesConverter.ts`

### SCPI → tm_devices Algorithm

1. Split SCPI command by `:` → path components
2. Detect indexed components (`CH1` → `ch[1]`, `MATH2` → `math[2]`)
3. Convert to lowercase, join with `.`
4. Determine method: `?` = `query()`, value present = `write(value)`

### Conversion Table

| SCPI | tm_devices | Method |
|------|-----------|--------|
| `CH1:SCALE 1.0` | `scope.commands.ch[1].scale` | `.write(1.0)` |
| `CH2:COUPLING DC` | `scope.commands.ch[2].coupling` | `.write('DC')` |
| `*IDN?` | `scope.commands.idn` | `.query()` |
| `ACQUIRE:STATE?` | `scope.commands.acquire.state` | `.query()` |
| `MATH1:DEFINE "CH1+CH2"` | `scope.commands.math[1].define` | `.write('CH1+CH2')` |
| `HORIZONTAL:SCALE 1e-3` | `scope.commands.horizontal.scale` | `.write(1e-3)` |
| `TRIGGER:A:LEVEL 1.5` | `scope.commands.trigger.a.level` | `.write(1.5)` |

### One-Click Conversion in Blockly

Right-click SCPI block → "Convert to tm_devices Command" → block auto-replaces with Python Code block containing:
```python
scope.commands.ch[1].scale.write(1.0)
```

No confirmation dialogs — instant transform with one success message.

---

## 17. Custom GPT System

### GPT Name

**TekAutomate Workflow Builder** (also: TekAutomate Script Generator)

### Capabilities

1. Generate Steps UI JSON templates
2. Generate Blockly XML workspace files
3. Validate existing workflows
4. Enhance workflows (error handling, optimization)
5. Convert between Steps JSON ↔ Blockly XML
6. Troubleshoot workflow issues

### Critical GPT Rules

1. **Always start with `connect`, end with `disconnect`**
2. **Never use `sweep` step** (deprecated) — use `python` with loops
3. **Valid backends**: `pyvisa`, `tm_devices`, `tekhsi`, `hybrid`
4. **TekHSI ONLY for high-speed waveform capture** (NOT measurements/search/histogram)
5. **tm_devices uses Python object syntax**, NOT raw SCPI strings
6. **TekExpress uses PyVISA SOCKET**, NOT raw `socket.sendall()`
7. **Multi-device: specify `boundDeviceId` per step**
8. **Query steps MUST have `saveAs` parameter**

### Backend Decision Tree (for GPT)

```
FastFrame/FastAcq waveform capture ONLY?  → TekHSI
Measurements/search/histogram?            → PyVISA (NOT TekHSI)
Modern Python API on MSO6B?               → tm_devices
TekExpress compliance testing?            → PyVISA SOCKET (port 5000)
Unsure or maximum compatibility?          → PyVISA
```

### GPT Device Context Rules (v6, 7,995 chars)

**Most common error**: Wrong DEVICE_CONTEXT in multi-instrument XML.

```
COMMAND PREFIX → DEVICE_CONTEXT:
  CH1:|ACQuire:|MEASU:|DATa:     → (scope)
  :SOURce:|:OUTPut:|:MEASure:    → (smu)/(psu)
  TEKEXP:                        → (tekexp)
```

Instructions include visual wrong/correct examples.

### Blockly XML Mandatory Structure

`controls_for` blocks **MUST** include mutation:
```xml
<block type="controls_for" id="loop1">
  <field name="VAR">frame</field>
  <mutation><variable>frame</variable></mutation>
  ...
</block>
```

Without `<mutation>`, Blockly variable scoping breaks and round-trip import/export is unstable.

### Blockly + GPT Workflow

1. **Create in Blockly → Verify with GPT**: Click "Copy XML" → paste in GPT for review
2. **Start with GPT → Import to Blockly**: Ask GPT for XML → "Load File" in Blockly
3. **Convert formats**: Steps JSON ↔ Blockly XML via GPT

### TekscopePC-Specific GPT Rules

- Connection: tm_devices with `HOST=127.0.0.1`
- Reset: Use `scpi_write("*RST")` NOT `scope.reset()` (AttributeError with PyVISA)
- Measurements: Query explicitly (no `SAVE:MEASUREMENT:ALL`)
- FastFrame: Standard commands work

---

## 18. Distribution & Deployment

### Web App Deployment

- URL: `http://dev.tek.com/TekAutomate`
- Stack: React + TypeScript (client-side only)
- No backend server required for code generation

### Electron Desktop App

| Attribute | Value |
|-----------|-------|
| File | `Tek Automator 1.0.0.exe` (portable) |
| Size | ~91 MB compressed, ~200 MB uncompressed |
| Includes | Electron runtime + React app + 58 MB command JSONs + templates |
| Build command | `npm run electron-build-win` |

**Electron Fixes Applied**:
- Removed `electron-is-dev` (crash), using `app.isPackaged`
- `protocol.interceptFileProtocol()` to handle `fetch()` for local files
- `webSecurity: false` for local file loading
- `extraResources` for commands, templates, manual, mascot

### Distribution Script

```batch
scripts\CREATE_DISTRIBUTION.bat   # Create ZIP
scripts\VERIFY_ZIP.bat            # Verify contents
scripts\CREATE_ELECTRON_ZIP.bat   # Electron ZIP
```

Distribution includes:
- `public/commands/`: 17+ JSON files
- `public/templates/`: 6+ template files
- `helper/`: 3 raw socket utility files

### Setup Troubleshooting

| Issue | Fix |
|-------|-----|
| Setup stops after Node.js detection | Use latest `setup.bat` or manual `npm install` |
| ZIP missing commands/templates | Run `CREATE_DISTRIBUTION.bat`, verify with `VERIFY_ZIP.bat` |
| Node.js not found | Install LTS from nodejs.org, reopen terminal |
| npm peer dependency errors | `npm install --legacy-peer-deps` |

---

## 19. Demo Playbook

### Demo Flow (30 minutes)

#### Part 1: Basic Automation (5-7 min)
**File**: `basic_setup_waveform.xml`
- Load XML → visual workflow appears
- Show blocks: Connect → Configure → Acquire → Save
- Highlight Configure Channel with **Termination** dropdown
- Generate Python → clean output

#### Part 2: Parameter Editing (5-7 min)
- Browse Commands → search "sweep mode"
- Select `SOURce{ch}:SWEep:MODE {mode}`
- Edit Parameters (always visible, no hidden toggle)
- Add to workspace with correct Write/Query block type

#### Part 3: Compliance Testing (10 min)
**File**: `TekExpress_USB31_Example.xml`
- Walk through TekExpress workflow
- State machine with popup handling
- Report generation
- Show clean Python output

#### Part 4: Multi-Instrument (5-8 min)
**File**: `Voltage sweep with SMU.xml`
- Scope + SMU coordination
- Device context switching
- For loop (v = 1 to 5V)
- tm_devices backend

### Demo Talking Points

1. "Parameters are immediately visible" — no hidden icons
2. "Command updates as I change parameters" — real-time feedback
3. "System knows this is a query command" — auto-detect Write vs Query
4. "One click to convert to tm_devices" — instant block transformation
5. "Color-coded by backend" — purple = tm_devices, green = PyVISA

---

## 20. Supported Instruments Catalog

### Oscilloscopes (22 models)

| Series | Models | Backend Support |
|--------|--------|-----------------|
| MSO6B | MSO64B, MSO66B, MSO68B | PyVISA, tm_devices, TekHSI, Hybrid |
| MSO5B | MSO54B, MSO56B, MSO58B | PyVISA, tm_devices, TekHSI, Hybrid |
| MSO4B | MSO44B | PyVISA, tm_devices |
| MSO5 | MSO54, MSO56, MSO58 | PyVISA, tm_devices, TekHSI, Hybrid |
| MSO4 | MSO44 | PyVISA, tm_devices |
| MSO2 | MSO22, MSO24 | PyVISA, tm_devices |
| DPO7K | DPO7054, DPO7104, DPO7254, DPO7354 | PyVISA, tm_devices |
| DPO70K | MSO70404C, MSO72004C, MSO73304DX | PyVISA |
| DPO5K | DPO5054, DPO5104, DPO5204 | PyVISA, tm_devices |
| DPO4K | DPO4054, DPO4104 | PyVISA |
| DPO2K | DPO2002, DPO2024 | PyVISA |
| MDO4K | MDO4054 | PyVISA |
| MDO3K | MDO3034 | PyVISA |
| TekScopePC | Software oscilloscope | PyVISA, tm_devices |

### Arbitrary Function Generators (7 models)

| Series | Models | Backend |
|--------|--------|---------|
| AFG3K | AFG3021, AFG3022, AFG3051, AFG3052 | PyVISA, tm_devices |
| AFG3KB | Updated AFG3K | PyVISA, tm_devices |
| AFG3KC | Latest AFG3K generation | PyVISA, tm_devices |
| AFG31K | AFG31021, AFG31022, AFG31051, AFG31052 | PyVISA, tm_devices |

### Arbitrary Waveform Generators (4 models)

| Series | Models | Backend |
|--------|--------|---------|
| AWG5K | AWG5002, AWG5012 | PyVISA, tm_devices |
| AWG5200 | AWG5202, AWG5204, AWG5208 | PyVISA, tm_devices |
| AWG7K | AWG7101, AWG7102 | PyVISA, tm_devices |
| AWG70K | AWG70001A, AWG70002A | PyVISA, tm_devices |

### Source Measure Units (20 models)

| Series | Models | Interface | Backend |
|--------|--------|-----------|--------|
| SMU2400 | Legacy SourceMeter | PI | PyVISA |
| SMU2450 | 200V, 1A, 20W | PI | PyVISA, tm_devices |
| SMU2460 | 100V, 7A, 100W | TSP | PyVISA, tm_devices |
| SMU2461 | 100V, 10A, 100W | TSP | PyVISA, tm_devices |
| SMU2470 | 1100V, 1A, 110W | TSP | PyVISA, tm_devices |
| SMU2601B | 40V, 3A, Single Ch | TSP | PyVISA, tm_devices |
| SMU2602B | 40V, 3A, Dual Ch | TSP | PyVISA, tm_devices |
| SMU2611B-2636B | Various | TSP | PyVISA, tm_devices |

### Power Supplies

| Series | Backend |
|--------|---------|
| PWS4000 | PyVISA, tm_devices |
| PWS2000 | PyVISA, tm_devices |

### Digital Multimeters

| Series | Backend |
|--------|---------|
| DMM6500 | PyVISA, tm_devices |
| DMM7510 | PyVISA, tm_devices |

### TekExpress Compliance Applications

| Application | Transport |
|-------------|-----------|
| USB4Tx | PyVISA SOCKET (port 5000) |
| PCIe | PyVISA SOCKET (port 5000) |
| Thunderbolt | PyVISA SOCKET (port 5000) |
| DisplayPort | PyVISA SOCKET (port 5000) |

### SCPI Command JSON Coverage

| Family | Commands | File |
|--------|----------|------|
| MSO 2/4/5/6/7 | 2,753 | `mso_2_4_5_6_7.json` |
| MSO/DPO 5k/7k/70K | 1,479 | `MSO_DPO_5k_7k_70K.json` |
| RSA | 3,722 | `rsa.json` |
| Bus Protocols | 339 | (within scope JSONs) |
| AFG | 65 | `afg.json` |
| AWG | 211 | `awg.json` |
| SMU | 63 | `smu.json` |
| DPOJET | 88 | `dpojet.json` |
| TekExpress | 49 | `tekexpress.json` |
| **Total** | **~8,770+** | |

---

*End of MEMORY.md — Last harvested: 2026-03-13*
