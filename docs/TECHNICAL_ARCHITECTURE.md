# Tek Automator - Technical Architecture Documentation

## Overview

This document explains the internal logic and architecture of Tek Automator, including how it handles instrument connections, multiple instruments, SCPI commands, and backend mixing.

---

## Table of Contents

1. [Connection Management](#connection-management)
2. [Multiple Instrument Handling](#multiple-instrument-handling)
3. [SCPI Command Processing](#scpi-command-processing)
4. [Backend Mixing and Selection](#backend-mixing-and-selection)
5. [Python Code Generation](#python-code-generation)
6. [Flow Designer Architecture](#flow-designer-architecture)

---

## Connection Management

### Connection Types

The application supports four connection types:

1. **TCP/IP (VXI-11)** - `tcpip`
   - VISA Resource String: `TCPIP::<host>::INSTR`
   - Uses VXI-11 protocol via RPC portmapper
   - No specific port required (auto-discovered)
   - Default port: 5025 (VXI-11)

2. **Socket** - `socket`
   - VISA Resource String: `TCPIP::<host>::<port>::SOCKET`
   - Raw socket connection
   - Default port: 4000
   - Not supported with tm_devices backend

3. **USB** - `usb`
   - VISA Resource String: `USB::<vendor_id>::<product_id>::<serial>::INSTR`
   - Requires vendor ID, product ID, and optional serial number
   - Example: `USB::0x0699::0x0522::INSTR`

4. **GPIB** - `gpib`
   - VISA Resource String: `GPIB<board>::<address>::INSTR`
   - Requires GPIB board number and address (1-30)
   - Example: `GPIB0::1::INSTR`

### Connection Logic

The connection logic is implemented in `getVisaResourceString()` function:

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

### Connection State Management

Each device maintains a connection state:
- `online` - Connected and ready
- `offline` - Not connected
- `idle` - Connected but not active
- `acquiring` - Currently acquiring data

---

## Multiple Instrument Handling

### Device Entry Structure

Each instrument is represented as a `DeviceEntry`:

```typescript
interface DeviceEntry {
  id: string;                    // Unique identifier
  alias: string;                 // User-friendly name (e.g., "scope1")
  deviceType: 'SCOPE' | 'AWG' | ...;
  backend: Backend;              // Backend to use
  connectionType: ConnectionType;
  host?: string;                 // IP address or hostname
  port?: number;                 // Port number
  enabled: boolean;              // Whether device is active
  // ... other connection parameters
}
```

### Multi-Device Architecture

The application supports multiple instruments simultaneously:

1. **Device Registry**
   - All devices are stored in a `devices` array
   - Each device has a unique `id` and `alias`
   - Devices can be enabled/disabled independently

2. **Device Binding**
   - Steps in workflows can be bound to specific devices via `boundDeviceId`
   - Commands within groups can specify `instrumentAlias` or `instrumentId`
   - If not specified, commands use the default device (first enabled device)

3. **Device Selection Logic**

   In the Flow Designer, each node can specify:
   - `instrumentId` - Reference to DeviceEntry.id
   - `instrumentAlias` - Reference to DeviceEntry.alias
   - `instrumentIds` - Array for connect/disconnect operations

   Command-level device selection (within groups):
   ```typescript
   // Command uses group's instrument if not specified
   const cmdAlias = cmd.instrumentAlias || groupAlias;
   const cmdInstrument = devices.find(d => d.alias === cmdAlias);
   ```

### Device Connection in Generated Python

When generating Python code, each device is connected separately:

```python
devices: Dict[str, Any] = {}

# Connect each device based on its backend
for device in enabled_devices:
    if device.backend == 'tm_devices' or device.backend == 'hybrid':
        devices[device.alias] = DeviceManager(resource_string)
    elif device.backend == 'tekhsi':
        devices[device.alias] = tekhsi.connect(resource_string)
    else:
        rm = pyvisa.ResourceManager()
        devices[device.alias] = rm.open_resource(resource_string)
```

Commands then reference devices by alias:
```python
devices['scope1'].write('*RST')
result = devices['scope2'].query('*IDN?')
```

---

## SCPI Command Processing

### Command Structure

SCPI commands are stored in JSON files with the following structure:

```typescript
interface CommandLibraryItem {
  name: string;              // Display name
  scpi: string;              // SCPI command (may contain placeholders)
  description: string;
  category: string;
  params?: CommandParam[];   // Parameter definitions
  example?: string;
  tekhsi?: boolean;          // TekHSI-specific command
}
```

### Command Parameter Substitution

Commands can contain placeholders that are substituted at runtime:

```typescript
function substituteSCPI(cmd: string, params: CommandParam[], values: Record<string, any>): string {
  let result = cmd;
  params.forEach(param => {
    const value = values[param.name] ?? param.default;
    // Replace ${param.name} with actual value
    result = result.replace(new RegExp(`\\$\\{${param.name}\\}`, 'g'), String(value));
  });
  return result;
}
```

Example:
- Command: `CH${channel}:SCALE ${scale}`
- Parameters: `[{name: 'channel', default: 1}, {name: 'scale', default: 1.0}]`
- Values: `{channel: 2, scale: 0.5}`
- Result: `CH2:SCALE 0.5`

### Command Type Detection

The system distinguishes between different command types:

1. **SCPI Commands** - Standard SCPI (e.g., `*RST`, `CH1:SCALE 1.0`)
2. **tm_devices Commands** - High-level API calls (e.g., `scope.commands.reset()`, `scope.add_measurement()`)
3. **TekHSI Commands** - gRPC API calls (e.g., `scope.get_data("CH1")`, `scope.acquire()`)
4. **Hybrid Commands** - Mix of SCPI and TekHSI

Detection logic:
```typescript
// Check if command is tm_devices high-level API
const isTmDevicesCommand = cmd.includes('.commands.') || 
                          cmd.includes('.add_') || 
                          cmd.includes('.save_') ||
                          cmd.includes('.turn_') ||
                          cmd.includes('.set_and_check');

// Check if command is TekHSI (starts with 'scope.' but not tm_devices)
const isTekHSI = (cmd.startsWith('scope.') && !isTmDevicesCommand) || 
                 cmd.startsWith('#');

// Otherwise, it's a standard SCPI command
```

### Query vs Write Commands

Commands are classified as:
- **Query** - Ends with `?` or has `type: 'query'`
  - Returns a value that can be stored in a variable
  - Example: `*IDN?`, `CH1:SCALE?`
  
- **Write** - Does not end with `?` or has `type: 'write'`
  - Executes an action, no return value
  - Example: `*RST`, `CH1:SCALE 1.0`

---

## Backend Mixing and Selection

### Supported Backends

1. **PyVISA** (`pyvisa`)
   - Industry standard VISA interface
   - Works with all connection types
   - Cross-platform (Windows, Linux, macOS)

2. **tm_devices** (`tm_devices`)
   - Official Tektronix framework
   - High-level device APIs
   - Command validation and autocomplete
   - Supports newer devices (MSO4/5/6, DPO5K/7K)

3. **VXI-11** (`vxi11`)
   - Lightweight RPC protocol
   - Linux-friendly (no VISA drivers needed)
   - TCP/IP only

4. **TekHSI** (`tekhsi`)
   - High-speed gRPC interface
   - Port 5000 only
   - Newer scopes only (MSO5/6, DPO7K)

5. **Hybrid** (`hybrid`)
   - Combines PyVISA (SCPI) and TekHSI (waveforms)
   - Best of both worlds
   - Two simultaneous connections

### Backend Selection Logic

#### Per-Device Backend

Each device can have its own backend:
```typescript
const device1: DeviceEntry = {
  alias: 'scope1',
  backend: 'tm_devices',  // This device uses tm_devices
  // ...
};

const device2: DeviceEntry = {
  alias: 'scope2',
  backend: 'pyvisa',      // This device uses PyVISA
  // ...
};
```

#### Per-Command Backend Override

Within a group, individual commands can override the device's backend:
```typescript
interface Command {
  scpi: string;
  instrumentAlias?: string;  // Which device to use
  backend?: Backend;         // Override backend for this command
  // ...
}
```

#### Backend Resolution Algorithm

When executing a command, the backend is resolved as follows:

1. **Check command-level backend** (`cmd.backend`)
2. **Check command's instrument backend** (if `cmd.instrumentAlias` is set)
3. **Check group-level backend** (if command is in a group)
4. **Use device's default backend** (from DeviceEntry)

```typescript
// In PythonGenerator.ts
const cmdAlias = cmd.instrumentAlias || groupAlias;
const cmdInstrument = devices.find(d => d.alias === cmdAlias);
const effectiveBackend = cmd.backend || 
                        cmdInstrument?.backend || 
                        groupBackend || 
                        defaultBackend;
```

### Hybrid Mode Special Handling

In hybrid mode, the system automatically routes commands:

1. **SCPI Commands** → PyVISA connection
   ```python
   scpi.write('*RST')  # Uses PyVISA connection
   ```

2. **TekHSI Commands** → TekHSI gRPC connection
   ```python
   scope.get_data("CH1")  # Uses TekHSI connection
   ```

3. **tm_devices Commands** → DeviceManager (which uses PyVISA internally)
   ```python
   scope.commands.reset()  # Uses DeviceManager
   ```

Detection in hybrid mode:
```typescript
const isHSI = (cmd.startsWith('scope.') && !isTmDevicesCommand) || 
              cmd.startsWith('#');

if (isHSI) {
  // Route to TekHSI
  output += `${varName} = ${clean}\n`;  // Direct TekHSI call
} else if (isTmDevicesCommand) {
  // Route to DeviceManager
  output += `${varName} = ${cmd}\n`;  // tm_devices API
} else {
  // Route to SCPI (PyVISA)
  output += `scpi.write(${JSON.stringify(cmd)})\n`;
}
```

### Backend Compatibility Matrix

| Backend | TCP/IP | Socket | USB | GPIB | Device Support |
|---------|--------|--------|-----|------|----------------|
| PyVISA | ✅ | ✅ | ✅ | ✅ | All devices |
| tm_devices | ✅ | ❌ | ✅ | ✅ | MSO4/5/6, DPO5K/7K |
| VXI-11 | ✅ | ❌ | ❌ | ❌ | All devices (TCP/IP only) |
| TekHSI | ✅ (port 5000) | ❌ | ❌ | ❌ | MSO5/6, DPO7K only |
| Hybrid | ✅ | ❌ | ✅ | ✅ | MSO5/6, DPO7K only |

---

## Python Code Generation

### Generation Strategy

The Python generator (`PythonGenerator.ts`) creates executable Python scripts based on the workflow:

1. **Import Generation**
   - Analyzes all devices to determine required backends
   - Generates appropriate imports:
     ```python
     import pyvisa  # If PyVISA or tm_devices used
     from tm_devices import DeviceManager  # If tm_devices used
     import tekhsi  # If TekHSI or hybrid used
     ```

2. **Device Connection Generation**
   - Creates connection code for each enabled device
   - Uses appropriate backend for each device
   - Stores connections in `devices` dictionary

3. **Command Generation**
   - Traverses flow graph starting from trigger node
   - Generates Python code for each node type:
     - **Trigger** - Flow start marker
     - **Group** - Sequential command execution
     - **Condition** - If/else branching
     - **Loop** - While/for loops
     - **Delay** - `time.sleep()`
     - **Verify** - Retry logic with verification
     - **Python** - Custom Python code blocks
     - **Terminate** - Flow exit

### Command Execution in Generated Code

#### Standard SCPI (PyVISA/VXI-11)
```python
# Write command
devices['scope1'].write('*RST')

# Query command
result = devices['scope1'].query('*IDN?').strip()
```

#### tm_devices
```python
# High-level API (if command contains dots and not SCPI)
if cmd.scpi.includes('.') && !cmd.scpi.startsWith(':'):
    devices['scope1'].commands.reset()  # Direct API call
else:
    devices['scope1'].write('*RST')  # SCPI via DeviceManager
```

#### TekHSI
```python
# Direct gRPC call (no quotes)
result = scope.get_data("CH1")
scope.acquire()
```

#### Hybrid Mode
```python
# SCPI commands use scpi variable (PyVISA connection)
scpi.write('*RST')

# TekHSI commands use scope variable (TekHSI connection)
wfm = scope.get_data("CH1")

# tm_devices commands use DeviceManager
scope.commands.reset()
```

### Variable Context

The generated code maintains a `context` dictionary for variable storage:

```python
context = {}  # Runtime context for variables

# Store query result
result = devices['scope1'].query('CH1:SCALE?')
context['scale'] = result  # If outputVariable is set

# Use in later commands
if context.get('scale', 0) > 1.0:
    devices['scope1'].write('CH1:SCALE 0.5')
```

### Error Handling

Generated code includes error handling:

```python
try:
    devices['scope1'].write('*RST')
except Exception as e:
    print(f"Error: {e}")
    raise
finally:
    # Cleanup - disconnect all devices
    for alias, device in devices.items():
        device.close()
```

---

## Flow Designer Architecture

### Flow Structure

The Flow Designer uses a graph-based structure:

```typescript
interface Flow {
  flow_id: string;
  name: string;
  trigger: {
    type: 'manual' | 'schedule' | 'event';
  };
  nodes: FlowNode[];
  variables?: Record<string, any>;
}
```

### Node Types

1. **Trigger** - Flow entry point
   - `manual` - Run immediately
   - `schedule` - Run on schedule
   - `event` - Run on event

2. **Group** - Container for commands
   - Can be bound to a specific instrument
   - Commands execute sequentially
   - Can be collapsed/expanded

3. **Condition** - Branching logic
   - `conditionExpression` - Python expression
   - `nextTrue` - Node ID for true branch
   - `nextFalse` - Node ID for false branch

4. **Loop** - Iteration
   - `loopType`: 'while' | 'do_until' | 'for_each'
   - `loopExpression` - Loop condition
   - `next` - Node ID for loop body

5. **Delay** - Wait time
   - `waitTime` - Seconds to wait

6. **Verify** - Verification with retry
   - `verifyCmd` - Command to verify (default: `*OPC?`)
   - `expectedResponse` - Expected value (default: `1`)
   - `retryCount` - Number of retries

7. **Python** - Custom Python code
   - `pythonCode` - Python code to execute
   - `passCriteria` - Success condition
   - `failCriteria` - Failure condition

8. **Terminate** - Flow exit

### Graph Traversal

The Python generator traverses the flow graph:

```typescript
function traverse(nodeId: string): void {
  const node = nodeMap.get(nodeId);
  if (!node || visited.has(nodeId)) return;
  
  visited.add(nodeId);
  
  if (node.type === 'condition') {
    generateCondition(node);
    if (node.nextTrue) traverse(node.nextTrue);
    if (node.nextFalse) {
      generateElse();
      traverse(node.nextFalse);
    }
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

### Instrument Binding in Flow

Each node can specify instrument binding:

```typescript
interface FlowNode {
  instrumentId?: string;      // DeviceEntry.id
  instrumentAlias?: string;   // DeviceEntry.alias
  instrumentIds?: string[];   // Multiple devices (for connect/disconnect)
  // ...
}
```

Commands within groups can override:
```typescript
interface Command {
  instrumentAlias?: string;   // Override group's instrument
  instrumentId?: string;      // Override group's instrument
  // ...
}
```

---

## Summary

### Key Design Principles

1. **Flexibility** - Support multiple backends and connection types
2. **Multi-Device** - Each device can have its own backend and connection
3. **Command-Level Control** - Commands can override device/backend settings
4. **Backend Mixing** - Different devices can use different backends simultaneously
5. **Hybrid Mode** - Automatic routing of SCPI vs TekHSI commands
6. **Graph-Based Flow** - Visual flow designer with conditions and loops

### Best Practices

1. **Use appropriate backend for each device**
   - Newer scopes (MSO5/6) → tm_devices or hybrid
   - Older scopes (DPO70k) → PyVISA
   - Linux without VISA → VXI-11

2. **Bind commands to specific devices**
   - Use `instrumentAlias` in commands for multi-device workflows
   - Avoid relying on default device

3. **Use hybrid mode for fast waveforms**
   - SCPI for configuration
   - TekHSI for waveform acquisition

4. **Test generated scripts**
   - Always test generated Python scripts before production use
   - Verify device connections and command execution

---

## Additional Resources

- **Backend Guide:** See `BACKEND_GUIDE.md` for backend selection recommendations
- **User Guide:** See `README.md` for user-facing documentation
- **Tektronix Documentation:**
  - tm_devices: https://github.com/tektronix/tm_devices
  - TekHSI: https://github.com/tektronix/TekHSI
  - PyVISA: https://pyvisa.readthedocs.io/

