# Programmer's Manual Translation Guide

## Overview
This document provides instructions for translating the Tektronix Programmer's Manual PDF into structured JSON format for use in the Tek Automator application.

## Purpose
The translated JSON will be used to:
- Provide contextual help for SCPI commands
- Enable intelligent parameter detection (CH1→CH2, REF1, etc.)
- Display command structure breakdowns
- Show examples and usage information
- Link commands to their documentation

## JSON Structure

### File Organization
Create separate JSON files for each command group/category:
- `public/manual/acquisition.json`
- `public/manual/channels.json`
- `public/manual/data.json`
- `public/manual/display.json`
- `public/manual/measurement.json`
- `public/manual/trigger.json`
- etc.

If a vendor-translated source dump is malformed but the real SCPI is known from the manual, add a small supplemental override file in `public/commands/` (for example `mso_manual_overrides.json` for modern MSO or `legacy_scope_manual_overrides.json` for MSO/DPO 5K/7K/70K) with a clean command record instead of burying a one-off fix inside application code. MCP retrieval should prefer these override records as source-of-truth JSON alongside the main command library.

### Root Structure
Each JSON file should contain a single object with:
- `category`: Command group name (e.g., "Data", "Acquisition", "Channels")
- `instruments`: Array of supported instrument families
- `commands`: Array of command entries

## Command Entry Schema

Each command entry should follow this structure:

```json
{
  "command": "DATa:SOUrce",
  "header": "DATa:SOUrce",
  "mnemonics": ["DATa", "SOUrce"],
  "commandType": "set|query|both",
  "description": "Full description from manual",
  "shortDescription": "Brief one-line description",
  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "models": ["MSO44", "MSO46", "MSO54", "MSO56", "MSO64", "MSO66", "MSO68", "MSO74", "MSO76"],
    "exclusions": []
  },
  "arguments": [
    {
      "name": "source",
      "type": "mnemonic|enumeration|numeric|quoted_string|block",
      "required": true,
      "position": 0,
      "description": "Waveform source specification",
      "mnemonicType": "channel",
      "validValues": {
        "type": "mnemonic_range",
        "pattern": "CH<x>|REF<x>|MATH<x>|BUS<x>",
        "examples": ["CH1", "CH2", "CH3", "CH4", "REF1", "REF2", "MATH1", "MATH2"],
        "range": {
          "channels": { "min": 1, "max": 4 },
          "references": { "min": 1, "max": 4 },
          "math": { "min": 1, "max": 4 }
        }
      },
      "defaultValue": "CH1"
    }
  ],
  "queryResponse": {
    "type": "string|numeric|enumeration|block",
    "format": "Returns the current source as a string",
    "example": "CH1"
  },
  "examples": [
    {
      "description": "Set data source to channel 1",
      "command": "DATa:SOUrce CH1",
      "python": "scope.write('DATa:SOUrce CH1')",
      "result": null
    },
    {
      "description": "Query current data source",
      "command": "DATa:SOUrce?",
      "python": "source = scope.query('DATa:SOUrce?')",
      "result": "CH1"
    }
  ],
  "relatedCommands": [
    "DATa:ENCdg",
    "DATa:WIDth",
    "DATa:STARt",
    "DATa:STOP"
  ],
  "commandGroup": "Data",
  "subGroup": "Data Source",
  "backwardCompatibility": {
    "legacyCommands": [],
    "notes": null
  },
  "notes": [
    "The source must be an active channel, reference, or math waveform",
    "If the specified source is not active, the command may fail or activate it automatically"
  ],
  "manualReference": {
    "section": "Data Commands",
    "page": 123,
    "subsection": "DATa:SOUrce"
  },
  "concatenation": {
    "canConcatenate": true,
    "requiresColon": true,
    "example": "DATa:SOUrce CH1;:DATa:ENCdg RIBinary"
  },
  "dynamicActivation": {
    "implicitlyActivates": false,
    "requiresActiveSource": true
  }
}
```

## Field Descriptions

### Required Fields

#### `command`
- **Type**: string
- **Description**: The full SCPI command header (e.g., "DATa:SOUrce", "CH1:SCAle")
- **Format**: Use the exact format from the manual (case-sensitive, with colons)

#### `header`
- **Type**: string
- **Description**: Same as command, the base command header
- **Note**: For commands with mnemonics like CH<x>, use the pattern (e.g., "CH<x>:SCAle")

#### `mnemonics`
- **Type**: array of strings
- **Description**: Array of mnemonic components separated by colons
- **Example**: `["DATa", "SOUrce"]` for "DATa:SOUrce"
- **Note**: For variable mnemonics like CH<x>, include the pattern: `["CH<x>", "SCAle"]`

#### `commandType`
- **Type**: enum ("set" | "query" | "both")
- **Description**: Whether this is a set command, query command, or both
- **Note**: If both, include separate entries or mark as "both"

#### `description`
- **Type**: string
- **Description**: Full description from the manual explaining what the command does

#### `shortDescription`
- **Type**: string
- **Description**: Brief one-line description (50-100 characters)

#### `instruments`
- **Type**: object
- **Description**: Which instruments support this command
- **Fields**:
  - `families`: Array of instrument families (e.g., ["MSO4", "MSO5", "MSO6"])
  - `models`: Array of specific models (e.g., ["MSO44", "MSO46"])
  - `exclusions`: Array of models/families that don't support this command

### Arguments Array

Each argument object should contain:

#### `name`
- **Type**: string
- **Description**: Parameter name (e.g., "source", "scale", "position")

#### `type`
- **Type**: enum
- **Values**: 
  - `"mnemonic"` - Variable mnemonic like CH<x>, REF<x>, MATH<x>
  - `"enumeration"` - Fixed set of text values (e.g., "NORMal", "AUTO")
  - `"numeric"` - Numeric value (integer or float)
  - `"quoted_string"` - Text string in quotes
  - `"block"` - Binary data block

#### `required`
- **Type**: boolean
- **Description**: Whether this argument is required

#### `position`
- **Type**: number
- **Description**: Position of argument (0-based)

#### `description`
- **Type**: string
- **Description**: What this argument represents

#### `mnemonicType` (for mnemonic arguments)
- **Type**: enum
- **Values**: `"channel" | "bus" | "measurement" | "math" | "reference" | "cursor" | "zoom" | "search" | "plot" | "view"`
- **Description**: Type of mnemonic variable

#### `validValues` (structure depends on type)

**For mnemonic type:**
```json
{
  "type": "mnemonic_range",
  "pattern": "CH<x>|REF<x>|MATH<x>",
  "examples": ["CH1", "CH2", "REF1", "MATH1"],
  "range": {
    "channels": { "min": 1, "max": 4 },
    "references": { "min": 1, "max": 4 },
    "math": { "min": 1, "max": 4 }
  }
}
```

**For enumeration type:**
```json
{
  "type": "enumeration",
  "values": ["NORMal", "AUTO", "MANual"],
  "caseSensitive": false
}
```

**For numeric type:**
```json
{
  "type": "numeric",
  "format": "NR1|NR2|NR3",
  "min": 0,
  "max": 100,
  "unit": "volts|seconds|hertz",
  "default": 1.0
}
```

**For quoted_string type:**
```json
{
  "type": "quoted_string",
  "maxLength": 1000,
  "description": "File path or name"
}
```

### Examples Array

Each example should include:
- `description`: What the example demonstrates
- `codeExamples`: Object containing code examples for different languages/libraries
  - `scpi`: Raw SCPI command example
    - `code`: The SCPI command string
    - `library`: "SCPI"
    - `description`: Brief explanation
  - `python`: Python/PyVISA example (if applicable)
    - `code`: Python code snippet
    - `library`: "PyVISA"
    - `description`: Brief explanation
  - `tm_devices`: TM Devices library example (if applicable)
    - `code`: tm_devices code snippet
    - `library`: "tm_devices"
    - `description`: Brief explanation
  - `c`, `labview`, `matlab`: Optional - only include if relevant
- `result`: Expected result/response (for queries) - can be null for set commands
- `resultDescription`: Explanation of what the result means (especially useful for queries)

### Related Commands
- **Type**: array of strings
- **Description**: Array of command headers that are related or commonly used together

### Manual Reference
- **Type**: object
- **Fields**:
  - `section`: Section name from manual
  - `page`: Page number
  - `subsection`: Subsection name (optional)

### Backward Compatibility
- **Type**: object
- **Fields**:
  - `legacyCommands`: Array of legacy command names that map to this command
  - `notes`: Any notes about compatibility

## Special Cases

### Concatenated Commands
If commands can be concatenated with semicolons, include:
```json
"concatenation": {
  "canConcatenate": true,
  "requiresColon": true,
  "example": "DATa:SOUrce CH1;:DATa:ENCdg RIBinary"
}
```

### Dynamic Commands
For commands that create dynamic objects (MEAS<x>, MATH<x>, etc.):
```json
"dynamicActivation": {
  "implicitlyActivates": true,
  "createsObject": "measurement",
  "defaultType": "Period"
}
```

### Query-Only Commands
For commands that only have query form:
```json
{
  "command": "DATa:SOUrce?",
  "commandType": "query",
  "queryResponse": {
    "type": "string",
    "format": "Returns current source",
    "example": "CH1"
  }
}
```

## Translation Process

1. **Identify Command Group**: Determine which category the command belongs to
2. **Extract Command Header**: Get the exact command header from the manual
3. **Parse Mnemonics**: Break down the header into mnemonic components
4. **Identify Arguments**: List all arguments with their types and constraints
5. **Extract Description**: Get the full description from the manual
6. **Find Examples**: Extract any examples from the manual
7. **Check Instrument Support**: Note which instruments support the command
8. **Check Backward Compatibility**: Look for legacy command mappings
9. **Identify Related Commands**: Find commands in the same section/group

## Quality Checklist

Before finalizing each command entry, verify:
- [ ] Command header matches manual exactly (case-sensitive)
- [ ] All mnemonics are correctly parsed
- [ ] All arguments are documented with correct types
- [ ] Valid values/ranges are accurate
- [ ] Instrument support is correct
- [ ] Examples are valid and tested
- [ ] Related commands are included
- [ ] Manual reference (page/section) is accurate
- [ ] Description is clear and complete

## Notes

- Use consistent naming conventions (camelCase for JSON keys)
- Preserve exact SCPI syntax from manual (case, colons, etc.)
- Include all variations (set/query) as separate entries or mark as "both"
- For commands with variable mnemonics (CH<x>), use the pattern notation
- Include all examples from the manual
- Note any special behaviors (implicit activation, dynamic objects, etc.)
