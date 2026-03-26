# TekAutomate Template Guidelines

This document provides guidelines for creating consistent and reliable TekAutomate templates that work seamlessly with single and multi-device configurations.

## Table of Contents

1. [Template Structure](#template-structure)
2. [Required Fields](#required-fields)
3. [Connection Management](#connection-management)
4. [Single vs Multi-Device Templates](#single-vs-multi-device-templates)
5. [Step Types and Best Practices](#step-types-and-best-practices)
6. [Device Binding](#device-binding)
7. [Backend Specification](#backend-specification)
8. [Command Compatibility](#command-compatibility)
9. [Examples](#examples)

---

## Template Structure

### Basic Template Format

```json
{
  "category": "Category Name",
  "templates": [
    {
      "name": "Template Name",
      "description": "Brief description of what this template does",
      "backend": "pyvisa" | "tm_devices" | "tekhsi" | "hybrid",
      "deviceType": "SCOPE" | "AWG" | "SMU" | etc. (optional),
      "deviceDriver": "MSO6B" | "MSO70KDX" | etc. (optional),
      "steps": [
        // Array of step objects
      ]
    }
  ]
}
```

### Individual Template Object

```typescript
interface Template {
  name: string;                    // Required: Display name
  description: string;              // Required: What the template does
  steps: Step[];                    // Required: Array of workflow steps
  backend?: Backend;                // Recommended: 'pyvisa' | 'tm_devices' | 'tekhsi' | 'hybrid'
  category?: string;                // Optional: For organization
  source?: string;                  // Optional: Reference to source code/example
  deviceType?: DeviceType;         // Optional: 'SCOPE' | 'AWG' | 'SMU' | etc.
  deviceDriver?: string;            // Optional: Specific driver/model (e.g., 'MSO6B', 'MSO70KDX')
}
```

---

## Required Fields

### Minimum Required Template

Every template MUST have:
- ✅ `name` - Clear, descriptive name
- ✅ `description` - Explains what the template does
- ✅ `steps` - At least one step (typically starting with connect)

### Recommended Fields

- ✅ `backend` - Specifies which backend to use (prevents confusion)
- ✅ `deviceType` - Helps users understand device compatibility
- ✅ `deviceDriver` - For tm_devices templates, specifies exact driver

---

## Connection Management

### ⚠️ CRITICAL: Always Include Connect/Disconnect

**Every template MUST include proper connection management:**

1. **Start with Connect Step**
   ```json
   {
     "id": "1",
     "type": "connect",
     "label": "Connect",
     "params": {
       "instrumentIds": []  // Empty = connect all enabled devices
     }
   }
   ```

2. **End with Disconnect Step**
   ```json
   {
     "id": "last",
     "type": "disconnect",
     "label": "Disconnect",
     "params": {
       "instrumentIds": []  // Empty = disconnect all
     }
   }
   ```

### Connection Step Parameters

#### Single Device Template
```json
{
  "type": "connect",
  "label": "Connect Scope",
  "params": {
    "instrumentId": "",      // Leave empty - will use first enabled device
    "instrumentIds": [],     // Leave empty for single device
    "printIdn": true         // Optional: Print *IDN? after connection
  }
}
```

#### Multi-Device Template
```json
{
  "type": "connect",
  "label": "Connect All Instruments",
  "params": {
    "instrumentIds": []      // Empty array = connect all enabled devices
  }
}
```

#### Specific Device Selection
```json
{
  "type": "connect",
  "label": "Connect Scope and SMU",
  "params": {
    "instrumentIds": ["scope", "smu"]  // Use device aliases (set by user)
  }
}
```

### Disconnect Step Parameters

```json
{
  "type": "disconnect",
  "label": "Disconnect",
  "params": {
    "instrumentIds": []      // Empty = disconnect all
    // OR specify: ["scope", "smu"] to disconnect specific devices
  }
}
```

---

## Single vs Multi-Device Templates

### Single Device Template Pattern

**Use when:** Template works with one instrument (most common)

```json
{
  "name": "Single Waveform Capture",
  "description": "Capture waveform from single scope",
  "backend": "pyvisa",
  "deviceType": "SCOPE",
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect",
      "params": {}  // Will use first enabled device
    },
    {
      "id": "2",
      "type": "write",
      "label": "Configure CH1",
      "params": { "command": "CH1:SCAle 1.0" }
    },
    // ... more steps ...
    {
      "id": "last",
      "type": "disconnect",
      "label": "Disconnect",
      "params": {}
    }
  ]
}
```

**Key Points:**
- Connect step with empty params = uses first enabled device
- All commands default to first device
- Simple and works for most use cases

### Multi-Device Template Pattern

**Use when:** Template coordinates multiple instruments

```json
{
  "name": "Scope + SMU Characterization",
  "description": "Sweep voltage on SMU while capturing on scope",
  "backend": "pyvisa",
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect All",
      "params": {
        "instrumentIds": []  // Connect all enabled devices
      }
    },
    {
      "id": "2",
      "type": "write",
      "label": "Configure SMU",
      "params": {
        "command": "SOURce:VOLTage 1.0"
      },
      "boundDeviceId": "smu"  // Bind to SMU device
    },
    {
      "id": "3",
      "type": "write",
      "label": "Configure Scope",
      "params": {
        "command": "CH1:SCAle 1.0"
      },
      "boundDeviceId": "scope"  // Bind to scope device
    },
    // ... more steps ...
    {
      "id": "last",
      "type": "disconnect",
      "label": "Disconnect All",
      "params": {
        "instrumentIds": []  // Disconnect all
      }
    }
  ]
}
```

**Key Points:**
- Connect all devices at start
- Use `boundDeviceId` to specify which device each command targets
- Device aliases are set by user in device configuration
- Disconnect all at end

---

## Step Types and Best Practices

### 1. Connect Step

**Purpose:** Establish connection to instrument(s)

```json
{
  "id": "1",
  "type": "connect",
  "label": "Connect",
  "params": {
    "instrumentIds": [],     // Empty = all, or ["scope", "smu"]
    "printIdn": true          // Optional: Verify connection
  }
}
```

**Best Practices:**
- ✅ Always first step (unless template is meant to be appended)
- ✅ Use empty `instrumentIds` for "connect all" behavior
- ✅ Set `printIdn: true` for verification in generated code
- ✅ Label should be clear: "Connect", "Connect Scope", "Connect All"

### 2. Disconnect Step

**Purpose:** Close connections to instrument(s)

```json
{
  "id": "last",
  "type": "disconnect",
  "label": "Disconnect",
  "params": {
    "instrumentIds": []  // Empty = all, or specific devices
  }
}
```

**Best Practices:**
- ✅ Always last step (unless template is meant to be appended)
- ✅ Use empty `instrumentIds` for "disconnect all"
- ✅ Label: "Disconnect", "Disconnect All", etc.

### 3. Write Step

**Purpose:** Send SCPI write command

```json
{
  "id": "2",
  "type": "write",
  "label": "Stop Acquisition",
  "params": {
    "command": "ACQuire:STATE OFF"
  },
  "boundDeviceId": "scope"  // Optional: bind to specific device
}
```

**Best Practices:**
- ✅ Use full SCPI command syntax
- ✅ Commands can be from library or custom (will parse either way)
- ✅ Use `boundDeviceId` for multi-device templates
- ✅ Label should describe what the command does

### 4. Query Step

**Purpose:** Send SCPI query and save result

```json
{
  "id": "3",
  "type": "query",
  "label": "Query IDN",
  "params": {
    "command": "*IDN?",
    "saveAs": "idn"  // Variable name for result
  },
  "boundDeviceId": "scope"  // Optional
}
```

**Best Practices:**
- ✅ Always specify `saveAs` with meaningful variable name
- ✅ Use descriptive labels
- ✅ Results can be used in Python steps or saved to file

### 5. Set+Query Step

**Purpose:** Write value then immediately query to verify

```json
{
  "id": "4",
  "type": "set_and_query",
  "label": "Set and Verify Scale",
  "params": {
    "command": "CH1:SCAle 1.0",
    "saveAs": "scale_verify"
  }
}
```

**Best Practices:**
- ✅ Use when verification is critical
- ✅ Automatically generates write + query sequence

### 6. Sleep Step

**Purpose:** Wait/delay between operations

```json
{
  "id": "5",
  "type": "sleep",
  "label": "Wait for Stabilization",
  "params": {
    "duration": 0.5  // Seconds (can be any value, not limited)
  }
}
```

**Best Practices:**
- ✅ Use after state changes that need time to settle
- ✅ Use after starting acquisition (wait for trigger)
- ✅ Typical values: 0.1-2.0 seconds
- ✅ Can use any duration (no hard limit)

### 7. Python Step

**Purpose:** Execute custom Python code

```json
{
  "id": "6",
  "type": "python",
  "label": "Custom Processing",
  "params": {
    "code": "for i in range(10):\n    with scope.access_data():\n        waveform = scope.get_data('CH1')"
  },
  "boundDeviceId": "scope"  // Optional
}
```

**Best Practices:**
- ✅ Use for complex logic not expressible in SCPI
- ✅ For TekHSI: use `scope` object
- ✅ For tm_devices: use `scope.commands.*` or high-level API
- ✅ For pyvisa: use `scpi` object (PyVISA resource)
- ✅ Keep code readable and well-commented

### 8. Comment Step

**Purpose:** Add documentation/notes

```json
{
  "id": "7",
  "type": "comment",
  "label": "Note: This section configures channels",
  "params": {
    "text": "Note: This section configures channels"
  }
}
```

**Best Practices:**
- ✅ Use to document template sections
- ✅ Explain non-obvious operations
- ✅ Label and text should match

### 9. Save Data Step

**Purpose:** Capture and save waveform/data

```json
{
  "id": "8",
  "type": "save_waveform",
  "label": "Save Waveform",
  "params": {
    "command": "CURVe?",           // Optional: defaults to CURVe?
    "source": "CH1",               // Channel/source
    "filename": "waveform.bin",   // Output filename
    "format": "bin",               // 'bin' | 'wfm' | 'csv'
    "width": 1,                    // 1 or 2 bytes
    "encoding": "RIBinary",        // 'RIBinary' | 'RPBinary'
    "start": 1,                    // Optional: start point
    "stop": null                   // Optional: stop point (null = all)
  },
  "boundDeviceId": "scope"
}
```

**Best Practices:**
- ✅ Specify source channel clearly
- ✅ Use meaningful filenames
- ✅ Choose format based on use case (bin = fast, csv = readable)

### 10. Error Check Step

**Purpose:** Verify no instrument errors

```json
{
  "id": "9",
  "type": "error_check",
  "label": "Check for Errors",
  "params": {
    "command": "ALLEV?"  // Default: ALLEV?
  },
  "boundDeviceId": "scope"
}
```

**Best Practices:**
- ✅ Use after critical operations
- ✅ Place before disconnect
- ✅ Helps catch issues early

### 11. Group Step

**Purpose:** Organize related steps

```json
{
  "id": "g1",
  "type": "group",
  "label": "Configure Channels",
  "params": {},
  "collapsed": false,  // Start expanded or collapsed
  "children": [
    // Child steps here
  ]
}
```

**Best Practices:**
- ✅ Use to organize logical sections
- ✅ Set `collapsed: false` for important sections
- ✅ Use descriptive labels
- ✅ Can nest groups (groups within groups)

### 12. Sweep Step

**Purpose:** Iterate over a range of values

```json
{
  "id": "sweep1",
  "type": "sweep",
  "label": "Voltage Sweep",
  "params": {
    "variableName": "voltage",
    "start": 0,
    "stop": 10,
    "step": 0.5,
    "saveResults": true,
    "resultVariable": "results"
  },
  "children": [
    // Steps that use ${voltage} in commands
  ]
}
```

**Best Practices:**
- ✅ Use descriptive variable names
- ✅ Child steps can use `${variableName}` in commands
- ✅ Enable `saveResults` to collect query results
- ✅ Useful for characterization/sweeps

---

## Device Binding

### When to Use Device Binding

Use `boundDeviceId` when:
- ✅ Template uses multiple devices
- ✅ Specific commands must target specific devices
- ✅ Template clarity requires explicit device assignment

### Device Binding Syntax

```json
{
  "id": "2",
  "type": "write",
  "label": "Configure SMU",
  "params": {
    "command": "SOURce:VOLTage 1.0"
  },
  "boundDeviceId": "smu"  // Device alias (set by user)
}
```

**Important Notes:**
- `boundDeviceId` uses device **alias**, not ID
- If device alias doesn't exist, command uses default (first device)
- For single-device templates, binding is usually unnecessary

### Device Selection Priority

1. `boundDeviceId` on step (if specified)
2. `boundDeviceId` on parent group (if step is in group)
3. Default device (first enabled device)

---

## Backend Specification

### Backend Types

- **`pyvisa`** - Standard PyVISA (works with all instruments)
- **`tm_devices`** - Tektronix tm_devices Python library (MSO/AWG series)
- **`tekhsi`** - TekHSI (legacy, for older instruments)
- **`hybrid`** - Combines tm_devices + TekHSI capabilities

### When to Specify Backend

**Always specify `backend` when:**
- ✅ Template uses tm_devices-specific commands (`.commands.*`, `.add_*`, etc.)
- ✅ Template uses TekHSI-specific syntax (`scope.` without `.commands`)
- ✅ Template requires specific backend features

**Can omit `backend` when:**
- ✅ Template uses only standard SCPI commands
- ✅ Template works with any backend

### Backend-Specific Command Examples

#### PyVISA (Standard SCPI)
```json
{
  "type": "write",
  "params": {
    "command": "CH1:SCAle 1.0"
  }
}
```

#### tm_devices (High-Level API)
```json
{
  "type": "write",
  "params": {
    "command": "scope.commands.ch[1].scale.write(1.0)"
  }
}
```

#### TekHSI
```json
{
  "type": "write",
  "params": {
    "command": "scope.ch[1].scale = 1.0"
  }
}
```

---

## Command Compatibility

### Library Commands vs Custom Commands

**Library Commands (Recommended):**
- ✅ Commands from JSON library have parameter detection
- ✅ Editable parameters work automatically
- ✅ Better user experience

**Custom Commands (Also Supported):**
- ✅ Any valid SCPI command will work
- ✅ Parser handles commands not in library
- ✅ Editable parameters detected automatically
- ⚠️ May not have parameter options from library

### Command Format Guidelines

1. **Use Full SCPI Syntax**
   ```json
   "command": "ACQuire:STATE OFF"  // ✅ Good
   "command": "ACQ:ST OFF"        // ⚠️ Works but less clear
   ```

2. **Handle Placeholders**
   ```json
   "command": "CH<x>:SCAle 1.0"   // <x> will be replaced with 1, 2, etc.
   ```

3. **Multiple Commands (Concatenated)**
   ```json
   "command": "DATA:SOURCE CH1;:DATA:ENCDG RIBINARY;:DATA:WIDTH 1"
   ```

---

## Examples

### Example 1: Single Device Template (Basic)

```json
{
  "name": "Basic Waveform Capture",
  "description": "Simple waveform capture from CH1",
  "backend": "pyvisa",
  "deviceType": "SCOPE",
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect",
      "params": {
        "printIdn": true
      }
    },
    {
      "id": "2",
      "type": "write",
      "label": "Stop Acquisition",
      "params": {
        "command": "ACQuire:STATE OFF"
      }
    },
    {
      "id": "3",
      "type": "write",
      "label": "Configure CH1",
      "params": {
        "command": "CH1:SCAle 1.0"
      }
    },
    {
      "id": "4",
      "type": "write",
      "label": "Start Acquisition",
      "params": {
        "command": "ACQuire:STATE ON"
      }
    },
    {
      "id": "5",
      "type": "sleep",
      "label": "Wait for Trigger",
      "params": {
        "duration": 0.5
      }
    },
    {
      "id": "6",
      "type": "write",
      "label": "Stop Acquisition",
      "params": {
        "command": "ACQuire:STATE OFF"
      }
    },
    {
      "id": "7",
      "type": "query",
      "label": "Wait Complete",
      "params": {
        "command": "*OPC?",
        "saveAs": "opc"
      }
    },
    {
      "id": "8",
      "type": "save_waveform",
      "label": "Save Waveform",
      "params": {
        "source": "CH1",
        "filename": "waveform.bin",
        "format": "bin"
      }
    },
    {
      "id": "9",
      "type": "error_check",
      "label": "Check Errors",
      "params": {
        "command": "ALLEV?"
      }
    },
    {
      "id": "10",
      "type": "disconnect",
      "label": "Disconnect",
      "params": {}
    }
  ]
}
```

### Example 2: Multi-Device Template

```json
{
  "name": "Scope + SMU Characterization",
  "description": "Sweep SMU voltage while capturing on scope",
  "backend": "pyvisa",
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect All Instruments",
      "params": {
        "instrumentIds": [],
        "printIdn": true
      }
    },
    {
      "id": "2",
      "type": "write",
      "label": "Configure SMU Output",
      "params": {
        "command": "SOURce:VOLTage 0.0"
      },
      "boundDeviceId": "smu"
    },
    {
      "id": "3",
      "type": "write",
      "label": "Enable SMU Output",
      "params": {
        "command": "OUTPut:STATE ON"
      },
      "boundDeviceId": "smu"
    },
    {
      "id": "4",
      "type": "write",
      "label": "Configure Scope CH1",
      "params": {
        "command": "CH1:SCAle 1.0"
      },
      "boundDeviceId": "scope"
    },
    {
      "id": "sweep1",
      "type": "sweep",
      "label": "Voltage Sweep",
      "params": {
        "variableName": "voltage",
        "start": 0,
        "stop": 5,
        "step": 0.1,
        "saveResults": true,
        "resultVariable": "results"
      },
      "children": [
        {
          "id": "5",
          "type": "write",
          "label": "Set Voltage",
          "params": {
            "command": "SOURce:VOLTage ${voltage}"
          },
          "boundDeviceId": "smu"
        },
        {
          "id": "6",
          "type": "sleep",
          "label": "Stabilize",
          "params": {
            "duration": 0.2
          }
        },
        {
          "id": "7",
          "type": "write",
          "label": "Trigger Scope",
          "params": {
            "command": "ACQuire:STATE SINGLE"
          },
          "boundDeviceId": "scope"
        },
        {
          "id": "8",
          "type": "query",
          "label": "Read Current",
          "params": {
            "command": "MEASure:CURRent:DC?",
            "saveAs": "current"
          },
          "boundDeviceId": "smu"
        }
      ]
    },
    {
      "id": "9",
      "type": "write",
      "label": "Disable SMU Output",
      "params": {
        "command": "OUTPut:STATE OFF"
      },
      "boundDeviceId": "smu"
    },
    {
      "id": "10",
      "type": "disconnect",
      "label": "Disconnect All",
      "params": {
        "instrumentIds": []
      }
    }
  ]
}
```

### Example 3: Template with Groups

```json
{
  "name": "Organized Measurement Template",
  "description": "Template showing group organization",
  "backend": "pyvisa",
  "steps": [
    {
      "id": "1",
      "type": "connect",
      "label": "Connect",
      "params": {}
    },
    {
      "id": "g1",
      "type": "group",
      "label": "Initial Setup",
      "params": {},
      "collapsed": false,
      "children": [
        {
          "id": "2",
          "type": "write",
          "label": "Reset",
          "params": {
            "command": "*RST"
          }
        },
        {
          "id": "3",
          "type": "sleep",
          "label": "Wait",
          "params": {
            "duration": 1.0
          }
        }
      ]
    },
    {
      "id": "g2",
      "type": "group",
      "label": "Channel Configuration",
      "params": {},
      "collapsed": false,
      "children": [
        {
          "id": "4",
          "type": "write",
          "label": "CH1 Scale",
          "params": {
            "command": "CH1:SCAle 1.0"
          }
        },
        {
          "id": "5",
          "type": "write",
          "label": "CH2 Scale",
          "params": {
            "command": "CH2:SCAle 2.0"
          }
        }
      ]
    },
    {
      "id": "6",
      "type": "disconnect",
      "label": "Disconnect",
      "params": {}
    }
  ]
}
```

---

## Checklist for Template Creation

### Before Creating a Template

- [ ] Determine if single or multi-device
- [ ] Choose appropriate backend
- [ ] Identify required device type(s)
- [ ] Plan connection/disconnection strategy

### Template Structure

- [ ] ✅ Has `name` field
- [ ] ✅ Has `description` field
- [ ] ✅ Has `steps` array (not empty)
- [ ] ✅ Starts with `connect` step
- [ ] ✅ Ends with `disconnect` step
- [ ] ✅ Specifies `backend` (recommended)
- [ ] ✅ Specifies `deviceType` if applicable

### Connection Management

- [ ] ✅ Connect step is first (or clearly documented if not)
- [ ] ✅ Disconnect step is last (or clearly documented if not)
- [ ] ✅ Connect step handles single/multi-device correctly
- [ ] ✅ Disconnect step handles single/multi-device correctly
- [ ] ✅ `printIdn` used for connection verification (optional but recommended)

### Multi-Device Considerations

- [ ] ✅ Uses `boundDeviceId` for device-specific commands
- [ ] ✅ Device aliases are documented or use generic names
- [ ] ✅ All devices are connected at start
- [ ] ✅ All devices are disconnected at end

### Command Quality

- [ ] ✅ Commands use full SCPI syntax (not abbreviations)
- [ ] ✅ Commands are from library when possible
- [ ] ✅ Custom commands are valid SCPI
- [ ] ✅ Query steps have meaningful `saveAs` names
- [ ] ✅ Labels are descriptive and clear

### Code Generation

- [ ] ✅ Template generates valid Python code
- [ ] ✅ No syntax errors in generated code
- [ ] ✅ Device references are correct
- [ ] ✅ Backend-specific commands are correct

### Testing

- [ ] ✅ Test with single device
- [ ] ✅ Test with multiple devices (if applicable)
- [ ] ✅ Verify generated Python code runs
- [ ] ✅ Check that connections work properly
- [ ] ✅ Verify disconnect happens correctly

---

## Common Pitfalls to Avoid

### ❌ Missing Connect/Disconnect

```json
// BAD: No connect step
{
  "steps": [
    { "type": "write", "params": { "command": "*RST" } }
  ]
}

// GOOD: Has connect and disconnect
{
  "steps": [
    { "type": "connect", "params": {} },
    { "type": "write", "params": { "command": "*RST" } },
    { "type": "disconnect", "params": {} }
  ]
}
```

### ❌ Wrong Device Binding

```json
// BAD: Multi-device template without binding
{
  "steps": [
    { "type": "connect", "params": { "instrumentIds": [] } },
    { "type": "write", "params": { "command": "SOURce:VOLTage 1.0" } },  // Which device?!
    { "type": "write", "params": { "command": "CH1:SCAle 1.0" } }        // Which device?!
  ]
}

// GOOD: Explicit device binding
{
  "steps": [
    { "type": "connect", "params": { "instrumentIds": [] } },
    { "type": "write", "params": { "command": "SOURce:VOLTage 1.0" }, "boundDeviceId": "smu" },
    { "type": "write", "params": { "command": "CH1:SCAle 1.0" }, "boundDeviceId": "scope" }
  ]
}
```

### ❌ Missing Backend Specification

```json
// BAD: Uses tm_devices commands but doesn't specify backend
{
  "steps": [
    { "type": "write", "params": { "command": "scope.commands.ch[1].scale.write(1.0)" } }
  ]
}

// GOOD: Specifies backend
{
  "backend": "tm_devices",
  "steps": [
    { "type": "write", "params": { "command": "scope.commands.ch[1].scale.write(1.0)" } }
  ]
}
```

### ❌ Inconsistent Device Handling

```json
// BAD: Connects all but only uses one device
{
  "steps": [
    { "type": "connect", "params": { "instrumentIds": [] } },  // Connects all
    { "type": "write", "params": { "command": "CH1:SCAle 1.0" } },  // Only uses first
    { "type": "disconnect", "params": { "instrumentIds": ["scope"] } }  // Only disconnects one
  ]
}

// GOOD: Consistent device handling
{
  "steps": [
    { "type": "connect", "params": { "instrumentIds": [] } },
    { "type": "write", "params": { "command": "CH1:SCAle 1.0" } },
    { "type": "disconnect", "params": { "instrumentIds": [] } }  // Disconnects all
  ]
}
```

---

## Template File Organization

### File Structure

```
public/templates/
  ├── basic.json          # Basic/common templates
  ├── advanced.json        # Advanced/complex templates
  ├── tm_devices.json     # tm_devices-specific templates
  ├── tekhsi.json         # TekHSI-specific templates
  └── custom.json         # User-created templates (optional)
```

### Category Naming

Use clear, descriptive categories:
- ✅ "Basic" - Simple, common workflows
- ✅ "Advanced" - Complex, multi-step workflows
- ✅ "tm_devices" - Templates using tm_devices backend
- ✅ "TekHSI" - Templates using TekHSI backend
- ✅ "Characterization" - Measurement/sweep templates
- ✅ "Debugging" - Troubleshooting templates

---

## Version Compatibility

### Backward Compatibility

Templates created before command library integration will still work:
- ✅ Commands not in library are still parsed
- ✅ Editable parameters are detected automatically
- ✅ Generated code works correctly

### Forward Compatibility

When creating new templates:
- ✅ Prefer commands from library (better UX)
- ✅ Use full SCPI syntax
- ✅ Specify backend explicitly
- ✅ Follow connection/disconnection guidelines

---

## Additional Resources

- **Command Library**: Check `public/commands/` for available commands
- **Existing Templates**: Review `public/templates/` for examples
- **Step Types**: See step type documentation in App.tsx
- **Device Configuration**: Users configure devices in the Devices tab

---

## Questions or Issues?

If you encounter issues creating templates:
1. Check this guide first
2. Review existing templates for patterns
3. Test with single device first, then multi-device
4. Verify generated Python code runs correctly

---

**Last Updated:** 2024
**Version:** 1.0
