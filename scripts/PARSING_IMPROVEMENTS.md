# PDF Parsing Improvements with Command Groups Mapping

## Overview

With the complete command groups mapping (34 groups, 2,952 commands), we can now significantly improve the PDF extraction process.

## Key Improvements

### 1. Group Validation and Assignment

The enhanced extraction script (`extract_scpi_enhanced.py`) now:

- **Imports the command groups mapping** to validate extracted groups
- **Automatically assigns groups** to commands using the mapping
- **Validates extracted groups** against the canonical mapping
- **Handles command variants** (e.g., `{A|B}`, `<x>` placeholders)

**Benefits:**
- Ensures 100% accurate group assignment
- Catches misaligned data from PDF parsing
- Provides fallback when PDF group extraction fails

### 2. Enhanced Field Extraction

The script now better handles:

- **Syntax**: Multiple syntax lines per command
- **Related Commands**: Comma-separated or newline-separated lists
- **Examples**: Multi-line example blocks
- **Arguments**: Detailed argument descriptions
- **Conditions**: Special requirements or prerequisites
- **Returns**: Return value descriptions for query commands

### 3. Alphabetical Listing Format

The script is optimized for the alphabetical command listing section which contains:

- Command header (SCPI string)
- Short description
- Group assignment (validated against mapping)
- Syntax (one or more variations)
- Arguments (when present)
- Examples (when present)
- Related Commands (when present)
- Conditions (when present)

### 4. Important Notes Captured

The extraction now preserves:

- "Note: Some of the following commands may not be available on your instrument model."
- "Also, some of the following commands are only available if your instrument has the associated option installed."

These notes are included in the metadata and command descriptions.

## Usage

```python
from scripts.extract_scpi_enhanced import extract_mso_commands

# Extract commands with group validation
commands = extract_mso_commands("4-5-6_MSO_Programmer_077189801_RevA.pdf")

# Commands will have validated groups assigned
for cmd in commands:
    print(f"{cmd['scpi']} -> {cmd['group']}")
```

## Command Structure

Each extracted command follows this structure:

```json
{
  "scpi": "ACQuire:STATE",
  "description": "Starts, stops, or returns acquisition state.",
  "group": "Acquisition",  // Validated against mapping
  "syntax": [
    "ACQuire:STATE {ON|OFF|RUN|STOP}",
    "ACQuire:STATE?"
  ],
  "arguments": null,
  "examples": "ACQuire:STATE RUN",
  "relatedCommands": ["ACQuire:STOPAfter", "ACQuire:MODe"],
  "conditions": null,
  "returns": "Returns current acquisition state when queried"
}
```

## Group Assignment Logic

1. **Primary**: Use group extracted from PDF if present
2. **Validation**: Check extracted group against mapping
3. **Fallback**: If no group extracted, use mapping to assign
4. **Normalization**: Handle command variants (`{A|B}`, `<x>`, query marks)

## Benefits for TekAutomate

1. **Accurate Grouping**: Commands are correctly categorized
2. **Better Navigation**: Users can browse by functional area
3. **Academy Content**: Group descriptions provide rich educational material
4. **Validation**: Ensures data quality and consistency
5. **Discovery**: Helps users find related commands

## Next Steps

1. Run the enhanced extraction script on the full PDF
2. Validate extracted commands against the mapping
3. Generate statistics on extraction quality
4. Use group information for UI organization in TekAutomate
5. Create Academy articles from group descriptions










