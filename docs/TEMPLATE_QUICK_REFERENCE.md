# TekAutomate Template Quick Reference

A quick reference guide for creating TekAutomate templates.

## Template JSON Structure

```json
{
  "category": "Category Name",
  "templates": [
    {
      "name": "Template Name",
      "description": "What it does",
      "backend": "pyvisa" | "tm_devices" | "tekhsi" | "hybrid",
      "deviceType": "SCOPE" | "AWG" | "SMU" | etc. (optional),
      "deviceDriver": "MSO6B" | etc. (optional),
      "steps": [ /* steps array */ ]
    }
  ]
}
```

## Required Steps Pattern

**Every template MUST have:**

1. **Connect Step** (first)
2. **Your workflow steps**
3. **Disconnect Step** (last)

```json
{
  "steps": [
    { "id": "1", "type": "connect", "label": "Connect", "params": {} },
    // ... your steps ...
    { "id": "last", "type": "disconnect", "label": "Disconnect", "params": {} }
  ]
}
```

## Step Types Quick Reference

| Type | Purpose | Key Params |
|------|---------|------------|
| `connect` | Connect to device(s) | `instrumentIds: []` (empty = all) |
| `disconnect` | Disconnect device(s) | `instrumentIds: []` (empty = all) |
| `write` | Send SCPI write | `command: "ACQuire:STATE OFF"` |
| `query` | Send SCPI query | `command: "*IDN?"`, `saveAs: "idn"` |
| `set_and_query` | Write + verify | `command: "CH1:SCAle 1.0"`, `saveAs: "scale"` |
| `sleep` | Wait/delay | `duration: 0.5` (seconds) |
| `python` | Custom Python code | `code: "your code here"` |
| `comment` | Documentation | `text: "Your comment"` |
| `save_waveform` | Capture data | `source: "CH1"`, `filename: "data.bin"` |
| `error_check` | Check errors | `command: "ALLEV?"` |
| `group` | Organize steps | `children: [/* steps */]` |
| `sweep` | Iterate values | `variableName: "voltage"`, `start: 0`, `stop: 10`, `step: 0.1` |

## Single Device Template

```json
{
  "name": "Single Device Template",
  "description": "Works with one device",
  "backend": "pyvisa",
  "steps": [
    { "id": "1", "type": "connect", "label": "Connect", "params": {} },
    { "id": "2", "type": "write", "label": "Configure", "params": { "command": "CH1:SCAle 1.0" } },
    { "id": "3", "type": "disconnect", "label": "Disconnect", "params": {} }
  ]
}
```

## Multi-Device Template

```json
{
  "name": "Multi-Device Template",
  "description": "Coordinates multiple devices",
  "backend": "pyvisa",
  "steps": [
    { 
      "id": "1", 
      "type": "connect", 
      "label": "Connect All", 
      "params": { "instrumentIds": [] } 
    },
    { 
      "id": "2", 
      "type": "write", 
      "label": "Configure SMU", 
      "params": { "command": "SOURce:VOLTage 1.0" },
      "boundDeviceId": "smu" 
    },
    { 
      "id": "3", 
      "type": "write", 
      "label": "Configure Scope", 
      "params": { "command": "CH1:SCAle 1.0" },
      "boundDeviceId": "scope" 
    },
    { 
      "id": "4", 
      "type": "disconnect", 
      "label": "Disconnect All", 
      "params": { "instrumentIds": [] } 
    }
  ]
}
```

## Device Binding

Use `boundDeviceId` to target specific devices:

```json
{
  "type": "write",
  "params": { "command": "SOURce:VOLTage 1.0" },
  "boundDeviceId": "smu"  // Uses device alias
}
```

## Connection Parameters

### Connect All Devices
```json
{
  "type": "connect",
  "params": {
    "instrumentIds": []  // Empty = all enabled devices
  }
}
```

### Connect Specific Devices
```json
{
  "type": "connect",
  "params": {
    "instrumentIds": ["scope", "smu"]  // Device aliases
  }
}
```

### Disconnect All
```json
{
  "type": "disconnect",
  "params": {
    "instrumentIds": []  // Empty = all
  }
}
```

## Backend-Specific Commands

### PyVISA (Standard)
```json
{ "command": "CH1:SCAle 1.0" }
```

### tm_devices
```json
{ "command": "scope.commands.ch[1].scale.write(1.0)" }
```

### TekHSI
```json
{ "command": "scope.ch[1].scale = 1.0" }
```

## Checklist

- [ ] Has `name` and `description`
- [ ] Starts with `connect` step
- [ ] Ends with `disconnect` step
- [ ] Specifies `backend` (recommended)
- [ ] Multi-device templates use `boundDeviceId`
- [ ] Commands use full SCPI syntax
- [ ] Query steps have `saveAs` names
- [ ] Labels are descriptive

## Common Patterns

### Pattern: Setup → Execute → Save
```json
[
  { "type": "connect" },
  { "type": "write", "params": { "command": "*RST" } },
  { "type": "sleep", "params": { "duration": 1.0 } },
  { "type": "write", "params": { "command": "ACQuire:STATE ON" } },
  { "type": "sleep", "params": { "duration": 0.5 } },
  { "type": "write", "params": { "command": "ACQuire:STATE OFF" } },
  { "type": "save_waveform", "params": { "source": "CH1", "filename": "data.bin" } },
  { "type": "disconnect" }
]
```

### Pattern: Group Organization
```json
[
  { "type": "connect" },
  {
    "type": "group",
    "label": "Setup",
    "children": [
      { "type": "write", "params": { "command": "*RST" } }
    ]
  },
  {
    "type": "group",
    "label": "Measurement",
    "children": [
      { "type": "query", "params": { "command": "*IDN?", "saveAs": "idn" } }
    ]
  },
  { "type": "disconnect" }
]
```

---

**See `TEMPLATE_GUIDELINES.md` for complete documentation.**
