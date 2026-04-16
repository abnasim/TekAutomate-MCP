# COMMANDS_CORPUS.md — TekAutomate SCPI & tm_devices Knowledge Base Reference

This document is the canonical reference for the SCPI command corpus and tm_devices command tree used by TekAutomate. It covers file organization, JSON schemas, parameter types, extraction pipelines, and the tm_devices API mapping layer.

---

## 1. Command JSON File Organization

### Files in `public/commands/`

| File | Description | Command Count | Device Family |
|------|-------------|---------------|---------------|
| `mso_2_4_5_6_7.json` | MSO 2/4/5/6/7 series | ~2753 | MSO4, MSO5, MSO6, MSO7 |
| `MSO_DPO_5k_7k_70K.json` | Legacy scopes | ~1481 | DPO5K, DPO7K, DPO70K |
| `afg.json` | AFG generators | ~65 | AFG31K, AFG3K |
| `awg.json` | AWG generators | ~211 | AWG5K, AWG5200, AWG7K |
| `smu.json` | Source Measure Units | ~63 | SMU2400-2600 |
| `dpojet.json` | DPOJET analysis | ~88 | — |
| `tekexpress.json` | TekExpress compliance | ~49 | — |
| `rsa.json` | Real-time Spectrum | ~3722 | RSA |

### Organization

- Each JSON file has a metadata header with `version` and `manual` reference fields.
- Commands are organized under a top-level `groups` object. Each key is a group name (e.g., `"Acquisition"`, `"Trigger"`) containing a `commands` array.
- The `group` field on each command entry ties it back to its parent group.
- Some files (AFG, TekExpress) use a slightly different structure with `metadata` at root level and group-level `description` / `color` fields for UI rendering.

### Example: MSO/DPO file root structure

```json
{
  "version": "2.0",
  "manual": "MSO/DPO5000/B, DPO7000/C, DPO70000/B/C/D/DX/SX ...",
  "groups": {
    "Acquisition": {
      "name": "Acquisition",
      "description": "",
      "commands": [ ... ]
    },
    "Trigger": { ... },
    ...
  }
}
```

### Example: AFG file root structure

```json
{
  "metadata": {
    "name": "AFG Series",
    "description": "Arbitrary Function Generator SCPI commands for AFG31K, AFG3K series",
    "instruments": ["AFG31K", "AFG3KB", "AFG3KC", "AFG3K"],
    "version": "1.0",
    "manualReference": { ... }
  },
  "groups": {
    "Output": {
      "description": "Output channel control commands",
      "color": "bg-green-100 text-green-700",
      "commands": [ ... ]
    }
  }
}
```

---

## 2. Command Entry Schema (Full)

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the command |
| `category` | string | Category ID (e.g., `"acquisition"`, `"channels"`) |
| `scpi` | string | Full SCPI command string (e.g., `"ACQuire:STATE"`) |
| `header` | string | Command header without arguments |
| `commandType` | string | `"set"`, `"query"`, or `"both"` |
| `shortDescription` | string | Brief one-line description |
| `description` | string | Full detailed description |
| `mnemonics` | string[] | Array of mnemonic components (e.g., `["ACQuire", "MODe"]`) |
| `instruments` | object | Instrument compatibility — see below |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `arguments` | array | Argument definitions — see below |
| `queryResponse` | object | Query response format specification |
| `syntax` | object | Set and query syntax strings |
| `codeExamples` | array | Code examples in multiple languages |
| `relatedCommands` | string[] | Related command headers |
| `manualReference` | object | Manual section/page/subsection |
| `notes` | string[] | Additional notes |
| `backwardCompatibility` | object | Legacy command mappings |
| `dynamicActivation` | object | Dynamic object creation behavior |
| `concatenation` | object | Command concatenation rules |
| `commandGroup` | string | Display group name |
| `subGroup` | string | Subgroup name |

### Instruments Object

```json
"instruments": {
  "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
  "models": ["MSO4XB", "MSO5XB", "MSO6XB"],
  "exclusions": ["AWG70000"]
}
```

### Arguments Structure

Each argument is an object in the `arguments` array:

```json
{
  "name": "argumentName",
  "type": "numeric|enumeration|mnemonic|quoted_string|block",
  "required": true,
  "position": 0,
  "description": "What this argument does",
  "mnemonicType": "channel|reference|math|bus|measurement",
  "validValues": { },
  "defaultValue": "default value"
}
```

### Valid Values by Type

**Numeric:**
```json
"validValues": {
  "type": "numeric",
  "format": "NR1|NR2|NR3",
  "min": 0.001,
  "max": 1000,
  "unit": "volts",
  "increment": 0.001,
  "default": 1.0,
  "notes": "Additional notes"
}
```

**Enumeration:**
```json
"validValues": {
  "type": "enumeration",
  "values": ["OPTION1", "OPTION2", "OPTION3"],
  "caseSensitive": false,
  "default": "OPTION1",
  "notes": "Case insensitive"
}
```

**Mnemonic Range:**
```json
"validValues": {
  "type": "mnemonic_range",
  "pattern": "CH<x>|REF<x>|MATH<x>",
  "examples": ["CH1", "CH2", "REF1"],
  "range": {
    "channels": { "min": 1, "max": 4 },
    "references": { "min": 1, "max": 4 },
    "math": { "min": 1, "max": 4 }
  }
}
```

**Quoted String:**
```json
"validValues": {
  "type": "quoted_string",
  "maxLength": 1000,
  "description": "File path or name"
}
```

### Query Response

```json
"queryResponse": {
  "type": "numeric|enumeration|string",
  "format": "NR1|NR2|NR3|Enumeration string|Quoted string",
  "description": "What the query returns",
  "example": "1.0",
  "unit": "volts"
}
```

### Syntax

```json
"syntax": {
  "set": "ACQuire:MODe <enumeration>",
  "query": "ACQuire:MODe?",
  "argumentType": "enumeration|NR1|NR2|NR3|mnemonic",
  "description": "Detailed syntax description"
}
```

### Code Examples

```json
"codeExamples": [
  {
    "description": "What this example demonstrates",
    "codeExamples": {
      "scpi": {
        "code": "ACQuire:STATE RUN",
        "library": "SCPI",
        "description": "Raw SCPI command"
      },
      "python": {
        "code": "scope.write('ACQuire:STATE RUN')",
        "library": "PyVISA",
        "description": "PyVISA example"
      },
      "tm_devices": {
        "code": "scope.commands.acquire.state.write(1)",
        "library": "tm_devices",
        "description": "TM Devices library"
      }
    },
    "result": "1",
    "resultDescription": "What the result means"
  }
]
```

### Related Commands

```json
"relatedCommands": [
  "ACQuire:STOPAfter",
  "ACQuire:MODe",
  "ACQuire:NUMAVg"
]
```

### Manual Reference

```json
"manualReference": {
  "section": "Acquisition Commands",
  "page": 164,
  "subsection": "ACQuire:STATE"
}
```

### Backward Compatibility

```json
"backwardCompatibility": {
  "legacyCommands": ["OLD:COMMAND"],
  "notes": "Legacy command mapping notes"
}
```

### Dynamic Activation

For commands that create objects implicitly:

```json
"dynamicActivation": {
  "implicitlyActivates": true,
  "createsObject": "measurement|math|bus",
  "defaultType": "PERIod",
  "notes": "Querying creates measurement with default type"
}
```

### Concatenation

```json
"concatenation": {
  "canConcatenate": true,
  "requiresColon": true,
  "example": "ACQuire:MODe AVErage;:ACQuire:NUMAVg 8"
}
```

---

### Example: Enumeration Command (`ACQuire:MODe`)

```json
{
  "_comment": "Example with Enumeration Argument",
  "_description": "Template showing how to define commands with enumeration (fixed text) arguments",

  "id": "acq_mode",
  "category": "acquisition",
  "scpi": "ACQuire:MODe",
  "header": "ACQuire:MODe",
  "mnemonics": ["ACQuire", "MODe"],
  "commandType": "both",
  "shortDescription": "Set or query acquisition mode",
  "description": "Sets or queries the acquisition mode. Available modes include Sample (normal), Average, Envelope, High Resolution, and Peak Detect.",

  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "models": ["MSO4XB", "MSO5XB", "MSO6XB", "MSO58LP", "LPD64"],
    "exclusions": []
  },

  "arguments": [
    {
      "name": "mode",
      "type": "enumeration",
      "required": true,
      "position": 0,
      "description": "Acquisition mode",
      "validValues": {
        "type": "enumeration",
        "values": [
          "SAMple",
          "PEAKdetect",
          "HIRes",
          "AVErage",
          "ENVelope"
        ],
        "caseSensitive": false,
        "default": "SAMple",
        "notes": "Case insensitive, can use abbreviated forms"
      },
      "defaultValue": "SAMple"
    }
  ],

  "queryResponse": {
    "type": "enumeration",
    "format": "Enumeration string",
    "description": "Returns current acquisition mode",
    "example": "SAMple"
  },

  "syntax": {
    "set": "ACQuire:MODe <enumeration>",
    "query": "ACQuire:MODe?",
    "argumentType": "enumeration",
    "description": "Enumeration: SAMple, PEAKdetect, HIRes, AVErage, or ENVelope"
  },

  "codeExamples": [
    {
      "description": "Set acquisition mode to Average",
      "codeExamples": {
        "scpi": {
          "code": "ACQuire:MODe AVErage",
          "library": "SCPI",
          "description": "Raw SCPI command"
        },
        "python": {
          "code": "scope.write('ACQuire:MODe AVErage')",
          "library": "PyVISA",
          "description": "PyVISA example"
        },
        "tm_devices": {
          "code": "scope.commands.acquire.mode.write('AVErage')",
          "library": "tm_devices",
          "description": "TM Devices library"
        }
      },
      "result": null,
      "resultDescription": "Acquisition mode set to Average"
    },
    {
      "description": "Query current acquisition mode",
      "codeExamples": {
        "scpi": {
          "code": "ACQuire:MODe?",
          "library": "SCPI",
          "description": "Raw SCPI query"
        },
        "python": {
          "code": "mode = scope.query('ACQuire:MODe?')",
          "library": "PyVISA",
          "description": "PyVISA query"
        },
        "tm_devices": {
          "code": "mode = scope.commands.acquire.mode.query()",
          "library": "tm_devices",
          "description": "TM Devices query"
        }
      },
      "result": "SAMple",
      "resultDescription": "Returns current mode, e.g., 'SAMple'"
    }
  ],

  "relatedCommands": [
    "ACQuire:NUMAVg",
    "ACQuire:STATE",
    "ACQuire:STOPAfter"
  ],

  "manualReference": {
    "section": "Acquisition Commands",
    "page": 164,
    "subsection": "ACQuire:MODe"
  },

  "notes": [
    "Default mode is SAMple",
    "AVErage mode requires ACQuire:NUMAVg to be set",
    "ENVelope mode shows min/max over multiple acquisitions"
  ],

  "backwardCompatibility": {
    "legacyCommands": [],
    "notes": "No backward compatibility issues"
  },

  "dynamicActivation": {
    "implicitlyActivates": false,
    "createsObject": null,
    "defaultType": null,
    "notes": "Does not create new objects"
  },

  "concatenation": {
    "canConcatenate": true,
    "requiresColon": true,
    "example": "ACQuire:MODe AVErage;:ACQuire:NUMAVg 8"
  },

  "commandGroup": "Acquisition",
  "subGroup": "Mode"
}
```

---

### Example: Mnemonic Command (`CH<x>:SCAle`)

```json
{
  "_comment": "Example with Mnemonic Argument (CH<x>, MEAS<x>, etc.)",
  "_description": "Template showing how to define commands with variable mnemonics",

  "id": "ch_scale",
  "category": "channels",
  "scpi": "CH<x>:SCAle",
  "header": "CH<x>:SCAle",
  "mnemonics": ["CH<x>", "SCAle"],
  "commandType": "both",
  "shortDescription": "Set or query channel vertical scale",
  "description": "Sets or queries the vertical scale (volts per division) for the specified channel. The scale determines how much voltage each vertical division represents on the display.",

  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "models": ["MSO4XB", "MSO5XB", "MSO6XB", "MSO58LP", "LPD64"],
    "exclusions": []
  },

  "arguments": [
    {
      "name": "channel",
      "type": "mnemonic",
      "required": true,
      "position": 0,
      "mnemonicType": "channel",
      "description": "Channel specifier (CH1, CH2, CH3, or CH4)",
      "validValues": {
        "type": "mnemonic_range",
        "pattern": "CH<x>",
        "examples": ["CH1", "CH2", "CH3", "CH4"],
        "range": {
          "channels": {
            "min": 1,
            "max": 4,
            "description": "Channel number from 1 to 4"
          }
        }
      },
      "defaultValue": "CH1"
    },
    {
      "name": "scale",
      "type": "numeric",
      "required": true,
      "position": 1,
      "description": "Vertical scale in volts per division",
      "validValues": {
        "type": "numeric",
        "format": "NR2",
        "min": 0.001,
        "max": 1000,
        "unit": "volts",
        "increment": 0.001,
        "notes": "Scale affected by probe attenuation"
      },
      "defaultValue": 1.0
    }
  ],

  "queryResponse": {
    "type": "numeric",
    "format": "NR2",
    "unit": "volts",
    "description": "Returns scale as floating point in volts per division",
    "example": "1.0"
  },

  "syntax": {
    "set": "CH<x>:SCAle <NR2>",
    "query": "CH<x>:SCAle?",
    "argumentType": "NR2",
    "description": "NR2 is the vertical scale in volts per division"
  },

  "codeExamples": [
    {
      "description": "Set channel 1 scale to 1V per division",
      "codeExamples": {
        "scpi": {
          "code": "CH1:SCAle 1.0",
          "library": "SCPI",
          "description": "Raw SCPI command"
        },
        "python": {
          "code": "scope.write('CH1:SCAle 1.0')",
          "library": "PyVISA",
          "description": "PyVISA example"
        },
        "tm_devices": {
          "code": "scope.ch[1].scale.write(1.0)",
          "library": "tm_devices",
          "description": "TM Devices library"
        }
      },
      "result": null,
      "resultDescription": "Scale set to 1.0 V/div"
    },
    {
      "description": "Query channel 1 scale",
      "codeExamples": {
        "scpi": {
          "code": "CH1:SCAle?",
          "library": "SCPI",
          "description": "Raw SCPI query"
        },
        "python": {
          "code": "scale = scope.query('CH1:SCAle?')",
          "library": "PyVISA",
          "description": "PyVISA query"
        },
        "tm_devices": {
          "code": "scale = scope.ch[1].scale.query()",
          "library": "tm_devices",
          "description": "TM Devices query"
        }
      },
      "result": "1.0",
      "resultDescription": "Returns scale value in volts per division"
    }
  ],

  "relatedCommands": [
    "CH<x>:OFFSet",
    "CH<x>:POSition",
    "CH<x>:COUPling",
    "CH<x>:BANdwidth"
  ],

  "manualReference": {
    "section": "Channel Commands",
    "page": 45,
    "subsection": "CH<x>:SCAle"
  },

  "notes": [
    "Scale affected by probe attenuation",
    "Instrument may round to nearest valid setting",
    "Valid range depends on instrument model"
  ],

  "backwardCompatibility": {
    "legacyCommands": [],
    "notes": "No backward compatibility issues"
  },

  "dynamicActivation": {
    "implicitlyActivates": false,
    "createsObject": null,
    "defaultType": null,
    "notes": "Does not create new objects"
  },

  "concatenation": {
    "canConcatenate": true,
    "requiresColon": true,
    "example": "CH1:SCAle 1.0;:CH1:POSition 0"
  },

  "commandGroup": "Channels",
  "subGroup": "Vertical Scale"
}
```

---

### Example: Numeric Command (`ACQuire:SEQuence:NUMSEQuence`)

```json
{
  "_comment": "Complete JSON Template for SCPI Command Entry",
  "_description": "This template shows all possible fields for a command entry in mso_commands.json",

  "id": "command_unique_id",
  "category": "acquisition",
  "scpi": "ACQuire:SEQuence:NUMSEQuence",
  "header": "ACQuire:SEQuence:NUMSEQuence",
  "mnemonics": ["ACQuire", "SEQuence", "NUMSEQuence"],
  "commandType": "both",
  "shortDescription": "Set or query number of acquisitions in sequence",
  "description": "In single sequence acquisition mode, specify the number of acquisitions or measurements that comprise the sequence. The default is 1. This command sets or queries how many acquisitions will be performed before stopping.",

  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "models": ["MSO4XB", "MSO5XB", "MSO6XB", "MSO58LP", "LPD64"],
    "exclusions": []
  },

  "arguments": [
    {
      "name": "numAcqs",
      "type": "numeric",
      "required": true,
      "position": 0,
      "description": "The number of acquisitions or measurements that comprise the sequence",
      "validValues": {
        "type": "numeric",
        "format": "NR1",
        "min": 1,
        "max": 10000,
        "unit": "acquisitions",
        "increment": 1,
        "default": 1,
        "notes": "Must be a positive integer"
      },
      "defaultValue": 1
    }
  ],

  "queryResponse": {
    "type": "numeric",
    "format": "NR1",
    "description": "Returns the number of acquisitions in a sequence",
    "example": "1",
    "unit": "acquisitions"
  },

  "syntax": {
    "set": "ACQuire:SEQuence:NUMSEQuence <NR1>",
    "query": "ACQuire:SEQuence:NUMSEQuence?",
    "argumentType": "NR1",
    "description": "NR1 is the number of acquisitions or measurements that comprise the sequence"
  },

  "codeExamples": [
    {
      "description": "Set sequence to 2 acquisitions",
      "codeExamples": {
        "scpi": {
          "code": "ACQuire:SEQuence:NUMSEQuence 2",
          "library": "SCPI",
          "description": "Raw SCPI command to set sequence to 2 acquisitions"
        },
        "python": {
          "code": "scope.write('ACQuire:SEQuence:NUMSEQuence 2')",
          "library": "PyVISA",
          "description": "Set sequence using PyVISA"
        },
        "tm_devices": {
          "code": "scope.commands.acquire.sequence.numsequence.write(2)",
          "library": "tm_devices",
          "description": "Set sequence using tm_devices library"
        }
      },
      "result": null,
      "resultDescription": "Sequence set to 2 acquisitions"
    },
    {
      "description": "Query current sequence number",
      "codeExamples": {
        "scpi": {
          "code": "ACQuire:SEQuence:NUMSEQuence?",
          "library": "SCPI",
          "description": "Raw SCPI query"
        },
        "python": {
          "code": "num = scope.query('ACQuire:SEQuence:NUMSEQuence?')",
          "library": "PyVISA",
          "description": "Query sequence number using PyVISA"
        },
        "tm_devices": {
          "code": "num = scope.commands.acquire.sequence.numsequence.query()",
          "library": "tm_devices",
          "description": "Query sequence number using tm_devices"
        }
      },
      "result": "1",
      "resultDescription": "Returns the current sequence number, e.g., '1' indicating sequence is set to 1 acquisition"
    },
    {
      "description": "Query sequence mode (shows related command usage)",
      "codeExamples": {
        "scpi": {
          "code": "ACQuire:SEQuence:MODe?",
          "library": "SCPI",
          "description": "Query sequence mode - might return :ACQUIRE:SEQUENCE:MODE NUMACQS"
        },
        "python": {
          "code": "mode = scope.query('ACQuire:SEQuence:MODe?')",
          "library": "PyVISA",
          "description": "Query sequence mode"
        }
      },
      "result": ":ACQUIRE:SEQUENCE:MODE NUMACQS",
      "resultDescription": "Returns sequence mode indicating the acquisition sequence mode is set to NUMACQS"
    }
  ],

  "relatedCommands": [
    "ACQuire:SEQuence:MODe",
    "ACQuire:SEQuence:CURrent?",
    "ACQuire:STOPAfter",
    "ACQuire:MODe"
  ],

  "manualReference": {
    "section": "Acquisition Commands",
    "page": 164,
    "subsection": "ACQuire:SEQuence:NUMSEQuence"
  },

  "notes": [
    "Default value is 1",
    "Only applies in single sequence acquisition mode",
    "Sequence stops after specified number of acquisitions",
    "Related to ACQuire:SEQuence:MODe command"
  ],

  "backwardCompatibility": {
    "legacyCommands": [],
    "notes": "No backward compatibility issues"
  },

  "dynamicActivation": {
    "implicitlyActivates": false,
    "createsObject": null,
    "defaultType": null,
    "notes": "Does not create new objects"
  },

  "concatenation": {
    "canConcatenate": true,
    "requiresColon": true,
    "example": "ACQuire:MODe SAMple;:ACQuire:SEQuence:NUMSEQuence 2"
  },

  "commandGroup": "Acquisition",
  "subGroup": "Sequence"
}
```

---

### Example: Query-Only Command (`ACQuire:MAXSamplerate?`)

```json
{
  "_comment": "Example of Query-Only Command",
  "_description": "Template for commands that can only be queried (no set form)",

  "id": "acq_max_samplerate",
  "category": "acquisition",
  "scpi": "ACQuire:MAXSamplerate?",
  "header": "ACQuire:MAXSamplerate",
  "mnemonics": ["ACQuire", "MAXSamplerate"],
  "commandType": "query",
  "shortDescription": "Query maximum real-time sample rate",
  "description": "Returns the maximum real-time sample rate available on the instrument. This is a read-only value that depends on the instrument model and current settings.",

  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "models": ["MSO4XB", "MSO5XB", "MSO6XB", "MSO58LP", "LPD64"],
    "exclusions": []
  },

  "arguments": [],

  "queryResponse": {
    "type": "numeric",
    "format": "NR3",
    "unit": "samples/second",
    "description": "Returns maximum sample rate in samples per second",
    "example": "2.5E+09"
  },

  "syntax": {
    "query": "ACQuire:MAXSamplerate?",
    "description": "Query-only command, no arguments"
  },

  "codeExamples": [
    {
      "description": "Query maximum sample rate",
      "codeExamples": {
        "scpi": {
          "code": "ACQuire:MAXSamplerate?",
          "library": "SCPI",
          "description": "Raw SCPI query"
        },
        "python": {
          "code": "max_rate = scope.query('ACQuire:MAXSamplerate?')",
          "library": "PyVISA",
          "description": "Query using PyVISA"
        },
        "tm_devices": {
          "code": "max_rate = scope.commands.acquire.maxsamplerate.query()",
          "library": "tm_devices",
          "description": "Query using tm_devices"
        }
      },
      "result": "2.5E+09",
      "resultDescription": "Returns maximum sample rate, e.g., '2.5E+09' (2.5 GS/s)"
    }
  ],

  "relatedCommands": [
    "ACQuire:SAMPLERate?",
    "HORizontal:SAMPLERate?"
  ],

  "manualReference": {
    "section": "Acquisition Commands",
    "page": 164,
    "subsection": "ACQuire:MAXSamplerate"
  },

  "notes": [
    "Read-only value",
    "Depends on instrument model",
    "May vary based on number of active channels"
  ],

  "backwardCompatibility": {
    "legacyCommands": [],
    "notes": "No backward compatibility issues"
  },

  "dynamicActivation": {
    "implicitlyActivates": false,
    "createsObject": null,
    "defaultType": null,
    "notes": "Does not create new objects"
  },

  "concatenation": {
    "canConcatenate": true,
    "requiresColon": false,
    "example": "ACQuire:MAXSamplerate?;:ACQuire:MODe?"
  },

  "commandGroup": "Acquisition",
  "subGroup": "Sample Rate"
}
```

---

## 3. Command Groups Reference

The MSO Programmer Manual defines **34 command groups** containing **2,952 total commands** (MSO 2/4/5/6/7 series). Some commands may not be available on all instrument models, and some require specific installed options.

### Acquisition and Measurement

| Group | Commands | Description |
|-------|----------|-------------|
| Acquisition | 15 | Modes and functions controlling how the instrument acquires signals: start/stop, averaging, envelope, acquisition parameters |
| Measurement | 367 | Automated measurement system control — set/query measurement parameters, assign sources and reference levels per measurement |
| Digital Power Management | 26 | DPM functionality (requires option 5-DPM or 6-DPM) |
| Inverter Motors and Drive Analysis | 81 | IMDA group: input analysis, output analysis, ripple analysis measurements |
| Wide Band Gap Analysis (WBG) | 47 | WBG-DPT (Wide Band Gap Device Power Test) measurements |

### Display and Visualization

| Group | Commands | Description |
|-------|----------|-------------|
| Display | 130 | Graticule intensity, stacked/overlay mode, fastacq color palette, waveform positioning, zoom settings |
| Cursor | 121 | Cursor display, readout, waveform source, cursor position setups |
| Zoom | 20 | Horizontal and vertical waveform expansion/positioning without changing timebase/vertical settings |
| Histogram | 28 | Histogram functionality |
| Plot | 47 | Plot type selection and appearance control |
| Spectrum View | 52 | Spectrum analysis selection and execution |

### Triggering and Search

| Group | Commands | Description |
|-------|----------|-------------|
| Trigger | 266 | All triggering aspects: A/B triggers, edge/pulse/logic modes, pulse width, timeout, runt, window, rise/fall time |
| Search and Mark | 650 | Seek and identify waveform record information — bus protocol search capabilities (largest group) |

### Bus Protocols

| Group | Commands | Description |
|-------|----------|-------------|
| Bus | 339 | Bus configuration: type, signals, display style. Supports CAN, I2C, SPI, USB, Ethernet, ARINC429A, FlexRay, LIN, MIL-STD-1553B, and more |

### Waveform Processing

| Group | Commands | Description |
|-------|----------|-------------|
| Math | 85 | Create and define math waveforms using available math functions |
| Waveform Transfer | 41 | Transfer waveform data points. Formats: ASCII, RIBinary, SRIBinary, RFBinary, SRFBinary |

### Power Analysis

| Group | Commands | Description |
|-------|----------|-------------|
| Power | 268 | Control loop response, impedance, efficiency, harmonics, switching loss, and more |

### File and Data Management

| Group | Commands | Description |
|-------|----------|-------------|
| Save and Recall | 26 | Store and retrieve internal waveforms and settings |
| Save On | 8 | Program the instrument to save images/measurements/waveforms/setup on selected triggers |
| File System | 19 | Built-in hard disk: list directories, create/delete directories, create/copy/read/rename/delete files |

### System and Configuration

| Group | Commands | Description |
|-------|----------|-------------|
| Miscellaneous | 71 | Commands that don't fit other categories. Includes IEEE 488.2 common commands (`*RST`, `*IDN?`, etc.) |
| Status and Error | 17 | Instrument status determination and event control (IEEE Std 488.2-1987) |
| Calibration | 8 | Calibration state information and signal path calibration (SPC) initiation |
| Self Test | 10 | Selection and execution of diagnostic tests |

### Specialized Features

| Group | Commands | Description |
|-------|----------|-------------|
| Act On Event | 32 | Program actions on trigger, search, measurement limit, and mask test events |
| Mask | 29 | Compare incoming waveforms to standard or user-defined masks (polygonal regions) |
| Alias | 7 | Define new commands as sequences of standard commands |
| Callout | 14 | Create custom callouts to document test results |

### Channel and Signal Control

| Group | Commands | Description |
|-------|----------|-------------|
| Digital | 33 | Acquire up to 64 digital signals (requires digital probe on super channel) |
| Horizontal | 48 | Time base control: time per division/point |
| DVM | 12 | Digital Voltmeter functionality (requires DVM option, free with registration) |

### Communication and Interface

| Group | Commands | Description |
|-------|----------|-------------|
| Ethernet | 14 | 10BASE-T, 100BASE-TX, 1000BASE-TX Ethernet remote interface setup |

### Optional Features

| Group | Commands | Description |
|-------|----------|-------------|
| AFG | 18 | Arbitrary Function Generator (requires option AFG) |
| History | 3 | History mode functionality |

---

## 4. Search/Lookup Logic

### Category-based Filtering
- Filter commands by `category` field (e.g., `"acquisition"`, `"channels"`, `"trigger"`)
- Categories map to command groups but use normalized lowercase IDs

### Device Family Filtering
- Source file → family mapping:
  - `mso_2_4_5_6_7.json` → MSO4, MSO5, MSO6, MSO7
  - `MSO_DPO_5k_7k_70K.json` → DPO5K, DPO7K, DPO70K
  - `afg.json` → AFG31K, AFG3K
  - `awg.json` → AWG5K, AWG5200, AWG7K
  - `smu.json` → SMU2400-2600
  - `rsa.json` → RSA
- Per-command `instruments.families` and `instruments.models` fields enable fine-grained filtering
- `instruments.exclusions` array lists models/families that do NOT support a command

### Text Search
- Search across `scpi`, `description`, `shortDescription` fields
- Mnemonic component search via `mnemonics` array
- SCPI headers use Tektronix case convention (uppercase = required characters, lowercase = optional)

### Group Filtering
- Filter by `group` or `commandGroup` field
- Each file organizes commands under `groups` object with named categories

### Command Type Filtering
- `commandType`: `"set"`, `"query"`, or `"both"`
- Query-only commands have `commandType: "query"` and no `set` syntax
- Some commands also have `hasQuery` and `hasSet` boolean fields

---

## 5. tm_devices Command Tree (`tm_devices_full_tree.json`)

### Structure

The tm_devices command tree is a **hierarchical object graph**, not a flat list of SCPI strings. It mirrors the Python API path structure of the `tm_devices` package.

### Node Types

| Node Type | Description |
|-----------|-------------|
| `GROUP` | Intermediate node — contains child nodes but is not directly callable |
| `LEAF` | Terminal node — represents a command endpoint |
| `METHOD` | Executable method on a leaf node |

### Indexed Nodes

Commands with variable indices use bracket notation in the API:
- `ch[x]` — Channel index (e.g., `scope.ch[1]`, `scope.ch[4]`)
- `math[x]` — Math waveform index
- `source[x]` — Source index
- `meas[x]` — Measurement index
- `ref[x]` — Reference waveform index
- `bus[x]` — Bus index

### Method Types

| Method | Description |
|--------|-------------|
| `write` | Send a set command (e.g., `scope.commands.acquire.mode.write('AVErage')`) |
| `query` | Send a query command (e.g., `scope.commands.acquire.maxsamplerate.query()`) |
| `set_and_verify` | Write a value and verify it was set correctly |
| `no_op` | Placeholder — no operation |

### Model-Specific Availability

Nodes may have flags indicating which instrument families/models support them. If a selected model root is absent in `tm_devices_full_tree.json`, the browser should show it as unavailable (not empty/broken).

### API Path ↔ SCPI Mapping

In tm_devices mode, the **API path is authoritative** for code generation; SCPI text is explanatory/reference context. Always show both when available:

| API Path | SCPI Equivalent |
|----------|----------------|
| `scope1.commands.acquire.maxsamplerate.query()` | `ACQuire:MAXSamplerate?` |
| `scope1.commands.acquire.mode.write('AVErage')` | `ACQuire:MODe AVErage` |
| `scope1.ch[1].scale.write(1.0)` | `CH1:SCAle 1.0` |
| `scope1.ch[1].scale.query()` | `CH1:SCAle?` |

### Related Browser Data Files

| File | Purpose |
|------|---------|
| `tm_devices_full_tree.json` | Structural command tree (paths, indexed factories, methods) — used for valid path construction and model-aware browsing |
| `tm_devices_docstrings.json` | Extracted docstrings and metadata — loaded lazily for help/details rendering |

### Extraction

Generated by `scripts/extract_tm_devices_docs.py`, which parses the installed `tm_devices` package to produce browser metadata artifacts.

---

### tm_devices Chunk Schema (`rag/tm_devices_chunks.jsonl`)

For RAG/AI ingestion, tm_devices knowledge is chunked into JSONL format. Each chunk follows this schema:

```json
{
  "id": "tmdev::<section>::<slug>::v1",
  "source": {
    "repo_path": "docs/TM_DEVICES_RAG_CONTEXT.md",
    "doc_section": "Section name",
    "package_path": "tm_devices.package.path",
    "origin": "manual|extracted|generated"
  },
  "title": "Chunk title",
  "body": "500-1200 characters of body text. One main concept per chunk.",
  "code_examples": [
    "scope1.commands.acquire.state.write(\"ON\")"
  ],
  "tags": ["tm_devices", "shared_implementations"],
  "retrieval": {
    "intent": ["api_reference", "implementation_mapping"],
    "priority": 5,
    "must_include_when_query_mentions": ["shared_implementations", "IEEE4882Commands"],
    "avoid_when_query_mentions": ["css", "theme", "layout"]
  },
  "version": "v1",
  "updated_at_utc": "2026-03-11T00:00:00Z"
}
```

**Retrieval tag taxonomy** (normalized tags only):

`tm_devices`, `shared_implementations`, `helpers`, `device_manager`, `common_pi_error_check`, `common_tsp_error_check`, `ieee4882`, `add_device_methods`, `get_device_methods`, `backend_selection`, `tekautomate_mapping`, `api_to_scpi_mapping`, `docstrings`, `command_tree`, `model_availability`, `generation_runtime`, `signal_generators`, `awg5200`, `awg70k`, `constraints`

**Chunking rules:**
- Target size: 500–1200 characters of body text
- One main concept per chunk
- At least one deterministic retrieval keyword in `must_include_when_query_mentions` for priority ≥ 4
- Do not mix package API semantics with UI styling details
- Repeat critical disambiguation: `tm_devices` API path is runtime-authoritative; SCPI text is reference/mapping context

**Query routing heuristics:**
- `add_scope`, `DeviceManager` → boost `device_manager` chunks
- `shared_implementations`, `ESR`, `IEEE488.2` → boost `shared_implementations` / `ieee4882`
- `PYVISA_PY_BACKEND`, `visa_library` → boost `helpers` / `backend_selection`
- `write()`, `parameter` → boost `generation_rules` + `api_to_scpi_mapping`
- `no commands found`, `model`, `missing family` → boost `model_availability` + `command_tree`
- `AFG`, `AWG`, `signal generator` → boost `signal_generators` + `constraints`

---

## 6. Command Extraction Pipeline

### MSO 2/4/5/6/7 Series

**Source:** `4-5-6_MSO_Programmer_077189801_RevA.txt` (73,236 lines)

**Pipeline stages:**

1. **Initial extraction (v1):** Basic parser → 4,917 commands (with false positives)
2. **Cleaned v1:** Removed 650 invalid entries + 602 duplicates → 3,665 valid commands
3. **Improved extraction (v2):** Better filtering, argument parsing, example extraction → 4,316 commands
4. **Final merge:** Merged all sources (cleaned_v1 + v2 + detailed + complete), prioritized detailed entries → **3,814 unique commands**

**Top categories in final output:**

| Category | Commands |
|----------|----------|
| Zoom | 735 |
| Search and Mark | 504 |
| Power | 368 |
| Measurement | 273 |
| Trigger | 257 |
| Bus | 207 |
| Cursor | 119 |
| Channel | 103 |
| Display Control | 96 |

### DPO/MSO 5K/7K/70K Series

**Source:** `MSO-DPO5000-B-DPO7000-C-DPO70000.docx` (Word document)

**Font-aware extraction** — the script detects structure from font formatting:

| Font | Meaning |
|------|---------|
| Arial Narrow, Bold | Command headers and section headers |
| Arial Narrow, Italic | NOTE sections |
| Lucida Console | Syntax lines |
| Times New Roman | Descriptions |

**Pipeline:**

1. **Font-aware extraction:** `scripts/extract_scpi_from_word_font_aware_DPO.py` → 1,481 commands
2. **Group mapping:** `scripts/parse_dpo_command_groups.py` parsed pages 22–116 of manual → 912 commands mapped from tables
3. **Enhanced prefix matching:** 20+ prefix patterns reduced Miscellaneous from 511 (34.5%) to 21 (1.4%)

**Final distribution (top groups):**

| Group | Commands | % |
|-------|----------|---|
| Search and Mark | 357 | 24.1% |
| Trigger | 298 | 20.1% |
| Error Detector | 137 | 9.3% |
| Bus | 87 | 5.9% |
| Mask | 85 | 5.7% |
| Measurement | 65 | 4.4% |
| Horizontal | 54 | 3.6% |

### Extraction Scripts

| Script | Purpose |
|--------|---------|
| `scripts/parse_manual_to_json.py` | Initial MSO parser (basic command detection) |
| `scripts/parse_manual_to_json_v2.py` | Improved MSO parser (better filtering, argument parsing) |
| `scripts/validate_and_cleanup_json.py` | Validation, cleanup, duplicate removal |
| `scripts/merge_and_optimize_commands.py` | Multi-source merge with priority scoring |
| `scripts/extract_scpi_from_word_font_aware_DPO.py` | Font-aware DPO extraction from .docx |
| `scripts/parse_dpo_command_groups.py` | DPO command group table parser |
| `scripts/command_groups_mapping_DPO.py` | Generated mapping (912 commands, 27 groups) |
| `scripts/extract_tm_devices_docs.py` | tm_devices package → browser metadata |

---

## 7. Parameter Types Reference

| Type | Format | Description | Example Value | Example Command |
|------|--------|-------------|---------------|-----------------|
| `NR1` | Integer | Signed integer with no fractional part | `2`, `100`, `-5` | `ACQuire:SEQuence:NUMSEQuence 2` |
| `NR2` | Float | Explicit decimal point | `1.0`, `0.001`, `500.0` | `CH1:SCAle 1.0` |
| `NR3` | Scientific | Mantissa + exponent | `2.5E+09`, `1.0E-3` | `ACQuire:MAXSamplerate? → 2.5E+09` |
| `enumeration` | Keyword | Fixed set of text values | `SAMple`, `AVErage`, `HIRes` | `ACQuire:MODe AVErage` |
| `mnemonic` | Variable | Indexed variable mnemonic | `CH1`, `REF2`, `MATH3` | `CH1:SCAle?` |
| `mnemonic_range` | Pattern | Range pattern with `<x>` placeholder | `CH<x>`, `MEAS<x>` | `CH<x>:SCAle` where x=1–4 |
| `quoted_string` | `"text"` | Quoted string value | `"C:/path/file.txt"` | `TEKEXP:SELECT DEVICE,"USB4"` |
| `block` | Binary | IEEE 488.2 binary data block | `#42048<data>` | `CURVe #42048<binary>` |

### Numeric Format Details

- **NR1** (integer): No decimal point. Used for counts, indices, and discrete settings.
- **NR2** (float): Always has a decimal point. Used for voltage, time, frequency values.
- **NR3** (scientific): `<mantissa>E<exponent>` notation. Used for very large/small values (sample rates, time intervals).

### Enumeration Conventions

- Case-insensitive matching (uppercase characters are the required abbreviation)
- Example: `SAMple` can be sent as `SAM`, `SAMP`, `SAMPL`, or `SAMPLE`
- The `{OPT1|OPT2|OPT3}` syntax in manual syntax lines denotes enumeration choices

### Mnemonic Conventions

- `<x>` denotes a numeric index placeholder (e.g., `CH<x>` → `CH1`, `CH2`, `CH3`, `CH4`)
- Range is model-dependent (4-channel scope: CH1–CH4; 8-channel: CH1–CH8)
- Common mnemonic types: `channel`, `reference`, `math`, `bus`, `measurement`, `cursor`, `zoom`, `search`, `plot`, `view`

---

## 8. `_manualEntry` Subobject

Many extracted commands include a `_manualEntry` subobject that preserves the structure as extracted from the programmer's manual before normalization. This serves as the raw source record.

### Fields

```json
"_manualEntry": {
  "command": "ACQuire:ENHANCEDEnob",
  "header": "ACQuire",
  "mnemonics": ["ACQuire", "ENHANCEDEnob"],
  "commandType": "both",
  "hasQuery": true,
  "hasSet": true,
  "description": "Full description from manual",
  "shortDescription": "Truncated description (~100 chars)",
  "arguments": "Raw argument text from manual or null",
  "examples": [
    {
      "scpi": "ACQUIRE:ENHANCEDENOB AUTO",
      "description": "sets enhanced effective number of bits to AUTO.",
      "codeExamples": {
        "scpi": {
          "code": "ACQUIRE:ENHANCEDENOB AUTO"
        }
      }
    }
  ],
  "relatedCommands": [],
  "commandGroup": "Acquisition",
  "syntaxList": ["ACQuire:ENHANCEDEnob {OFF|AUTO}"],
  "syntax": {
    "set": "ACQuire:ENHANCEDEnob {OFF|AUTO}",
    "query": "ACQuire:ENHANCEDEnob?"
  },
  "manualReference": {
    "section": "Acquisition"
  },
  "notes": []
}
```

### Key Differences from Top-Level Fields

| Aspect | Top-Level | `_manualEntry` |
|--------|-----------|----------------|
| `arguments` | Structured array of typed objects | Raw text string from manual |
| `syntax` | Object with `set`/`query`/`argumentType`/`description` | Object with just `set`/`query` (plus optional `syntaxList` array) |
| `examples` | `codeExamples` array with multi-language support | Simple `scpi` + `description` pairs |
| `header` | Full command path (e.g., `ACQuire:ENHANCEDEnob`) | Root mnemonic only (e.g., `ACQuire`) in DPO files, full path in MSO files |
| `commandType` | Derived from syntax analysis | May include `hasQuery`/`hasSet` booleans |

### Purpose

- **Provenance:** Preserves exactly what was extracted from the manual before enrichment
- **Debugging:** When enriched top-level fields look wrong, check `_manualEntry` for the raw source
- **Re-processing:** Can re-run enrichment pipelines without re-extracting from .docx/.txt files
- **Manual → JSON mapping:** Shows how manual syntax lines (e.g., `ACQuire:ENHANCEDEnob {OFF|AUTO}`) were parsed into structured `params` arrays

### Example: SET+QUERY Template with `_manualEntry`

```json
{
  "scpi": "COMMAND:HEADER<x>:SUBCMD",
  "description": "Full description of what this command does.",
  "conditions": null,
  "group": "GroupName",
  "syntax": [
    "COMMAND:HEADER<x>:SUBCMD  <NR1> COMMAND:HEADER<x>:SUBCMD?"
  ],
  "relatedCommands": null,
  "arguments": "Detailed description of arguments.\nHEADER<x> is the header number.\n<NR1> specifies the numeric value.",
  "examples": [
    {
      "scpi": "COMMAND:HEADER1:SUBCMD 10",
      "description": "Description of what this example does."
    },
    {
      "scpi": "COMMAND:HEADER1:SUBCMD?",
      "description": "Description of what this query returns."
    }
  ],
  "returns": null,
  "shortDescription": "Short description",
  "notes": [],
  "name": "CommandName",
  "params": [
    {
      "name": "header",
      "type": "integer",
      "required": true,
      "default": 1,
      "min": 1,
      "max": 8,
      "description": "HEADER<x> where x is the header number (1-8)"
    },
    {
      "name": "value",
      "type": "number",
      "required": true,
      "default": 1,
      "description": "Numeric value"
    }
  ],
  "example": "COMMAND:HEADER1:SUBCMD 10",
  "_manualEntry": {
    "command": "COMMAND:HEADER<x>:SUBCMD",
    "header": "COMMAND:HEADER<x>:SUBCMD",
    "mnemonics": ["COMMAND", "HEADER<x>", "SUBCMD"],
    "commandType": "both",
    "description": "Full description of what this command does.",
    "shortDescription": "Short description",
    "arguments": null,
    "examples": [
      {
        "description": "Description of what this example does.",
        "codeExamples": {
          "scpi": { "code": "COMMAND:HEADER1:SUBCMD 10" }
        }
      },
      {
        "description": "Description of what this query returns.",
        "codeExamples": {
          "scpi": { "code": "COMMAND:HEADER1:SUBCMD?" }
        }
      }
    ],
    "relatedCommands": [],
    "commandGroup": "GroupName",
    "syntax": {
      "set": "COMMAND:HEADER<x>:SUBCMD  <NR1>",
      "query": "COMMAND:HEADER<x>:SUBCMD?"
    },
    "manualReference": { "section": "GroupName" },
    "notes": []
  }
}
```

### Example: Query-Only Template with `_manualEntry`

```json
{
  "scpi": "COMMAND:QUERYONLY?",
  "description": "This query-only command returns [description of what it returns].",
  "conditions": null,
  "group": "GroupName",
  "syntax": ["COMMAND:QUERYONLY?"],
  "relatedCommands": null,
  "arguments": null,
  "examples": [
    {
      "scpi": "COMMAND:QUERYONLY?",
      "description": "Description of what this query returns."
    }
  ],
  "returns": "Description of return value format",
  "shortDescription": "Short description",
  "notes": [],
  "name": "QueryOnlyCommand",
  "params": [],
  "example": "COMMAND:QUERYONLY?",
  "_manualEntry": {
    "command": "COMMAND:QUERYONLY?",
    "header": "COMMAND:QUERYONLY",
    "mnemonics": ["COMMAND", "QUERYONLY"],
    "commandType": "query",
    "description": "This query-only command returns [description of what it returns].",
    "shortDescription": "Short description",
    "arguments": null,
    "examples": [
      {
        "description": "Description of what this query returns.",
        "codeExamples": {
          "scpi": { "code": "COMMAND:QUERYONLY?" }
        }
      }
    ],
    "relatedCommands": [],
    "commandGroup": "GroupName",
    "syntax": { "query": "COMMAND:QUERYONLY?" },
    "manualReference": { "section": "GroupName" },
    "notes": []
  }
}
```

---

## 9. tm_devices Core API Reference

### `driver_mixins.shared_implementations`

**Path:** `tm_devices.driver_mixins.shared_implementations`

Shared mixins and IEEE488.2 command helper classes used by multiple device families.

**Key classes:**
- `CommonPISystemErrorCheckMixin` — PI-side error checking helpers (e.g., `expect_esr(...)`)
- `CommonTSPErrorCheckMixin` — TSP-side error checking
- `IEEE4882Commands` — Standard IEEE 488.2 commands
- `LegacyTSPIEEE4882Commands` / `TSPIEEE4882Commands`

TekAutomate does **not** directly instantiate these mixins. They are consumed through official `tm_devices` driver classes when generated Python calls execute.

### `helpers`

**Path:** `tm_devices.helpers`

Package-wide constants, dataclasses, enums, and connection/verification utilities.

**Key constants:**
- `PYVISA_PY_BACKEND` — Use pyvisa-py backend
- `SYSTEM_DEFAULT_VISA_BACKEND` — Use system VISA

**Key helper functions:**
- `check_network_connection`, `check_port_connection`, `check_visa_connection`
- `create_visa_connection`, `detect_visa_resource_expression`, `get_visa_backend`
- `validate_address`, `sanitize_enum`, `verify_values`

### `device_manager`

**Path:** `tm_devices.device_manager`

Singleton manager for device lifecycle, connection setup, and typed accessors.

**`add_*` methods** (register/connect typed drivers):

| Method | Device Type |
|--------|-------------|
| `add_scope` | Oscilloscope |
| `add_awg` | Arbitrary Waveform Generator |
| `add_afg` | Arbitrary Function Generator |
| `add_dmm` | Digital Multimeter |
| `add_smu` | Source Measure Unit |
| `add_psu` | Power Supply Unit |
| `add_daq` | Data Acquisition |
| `add_ss` | Systems Switch |
| `add_mf` | Margin Fader |
| `add_mt` | Media Tester |

**`get_*` methods** retrieve typed drivers by number or alias.

**Generated code pattern:**
```python
from tm_devices import DeviceManager
from tm_devices.helpers import PYVISA_PY_BACKEND

dm = DeviceManager(verbose=False)
scope1 = dm.add_scope("192.168.1.100", alias="scope1")

# API calls (authoritative in tm_devices mode)
scope1.commands.acquire.maxsamplerate.query()      # ACQuire:MAXSamplerate?
scope1.commands.acquire.mode.write('AVErage')       # ACQuire:MODe AVErage
scope1.ch[1].scale.write(1.0)                       # CH1:SCAle 1.0
```

### Signal Generation Constraints

For AFG/AWG families:
- `generate_function()` may accept parameter combinations that exceed real instrument limits — consult constraints first
- `get_waveform_constraints()` is the authoritative constraint source (model/path/option dependent)
- AWG5200 and AWG70K have command sequencing nuances (blocking/overlapping behavior) affecting timeout handling
- Constraints vary by model/options — avoid assuming one-size-fits-all limits

---

## 10. Command Compatibility and Migration

### PI Command Translator

Modern Tektronix oscilloscopes (firmware v1.30+) include a built-in **Programming Interface (PI) Command Translator** that automatically converts legacy commands to modern equivalents. This allows existing automation scripts written for older hardware (DPO7000, MSO/DPO5000) to work on newer models (2/4/5/6 Series MSO) without immediate code changes.

### Backward Compatibility Fields

Each command entry can include:

```json
"backwardCompatibility": {
  "legacyCommands": ["OLD:COMMAND:SYNTAX"],
  "notes": "Description of mapping behavior"
}
```

This field documents which legacy SCPI strings map to the current command, enabling migration tooling and translator awareness.
