# Quick Start - Extract SCPI Commands from PDF

## Prerequisites

1. **Install PyMuPDF** (if not already installed):
   ```bash
   pip install PyMuPDF
   ```

2. **Place the PDF file** in the project root directory:
   - File name: `4-5-6_MSO_Programmer_077189801_RevA.pdf`
   - Location: Same directory as `scripts/` folder

## Run the Extraction

### Option 1: Run the Enhanced Script (Recommended)

This script uses the command groups mapping for validation and automatic group assignment:

```bash
python scripts/extract_scpi_enhanced.py
```

**Output:** `mso_commands_enhanced.json` in the project root

**Features:**
- ✅ Automatic group assignment using mapping
- ✅ Validates groups against 34 command groups
- ✅ Extracts all fields (description, syntax, arguments, examples, related commands)
- ✅ Handles alphabetical listing format

### Option 2: Run the Fixed PyMuPDF Script

If you prefer the original fixed version:

```bash
python scripts/extract_scpi_pymupdf_fixed.py
```

**Output:** `mso_commands_clean.json` in the project root

## What Happens

1. Script opens the PDF
2. Scans all pages for SCPI commands
3. Extracts command sections:
   - Command header (SCPI string)
   - Description
   - Group (validated/assigned using mapping)
   - Syntax
   - Arguments
   - Examples
   - Related Commands
   - Conditions
4. Validates groups against the 34 command groups mapping
5. Saves to JSON file

## Output Format

The JSON file will have this structure:

```json
{
  "category": "All",
  "instruments": ["MSO4", "MSO5", "MSO6", "MSO7"],
  "commands": [
    {
      "scpi": "ACQuire:STATE",
      "description": "Starts, stops, or returns acquisition state.",
      "group": "Acquisition",
      "syntax": ["ACQuire:STATE {ON|OFF|RUN|STOP}", "ACQuire:STATE?"],
      "arguments": null,
      "examples": "ACQuire:STATE RUN",
      "relatedCommands": ["ACQuire:STOPAfter"],
      "conditions": null,
      "returns": null
    }
  ],
  "metadata": {
    "total_commands": 2500,
    "command_groups_count": 34,
    "extraction_date": "2024"
  }
}
```

## Troubleshooting

**Error: "File not found"**
- Make sure the PDF file is in the project root (same level as `scripts/` folder)
- Check the filename matches exactly: `4-5-6_MSO_Programmer_077189801_RevA.pdf`

**Error: "ModuleNotFoundError: No module named 'fitz'"**
- Install PyMuPDF: `pip install PyMuPDF`

**Error: "ModuleNotFoundError: No module named 'command_groups_mapping'"**
- Make sure you're running from the project root
- The script should be able to import from `scripts/command_groups_mapping.py`

## Next Steps After Extraction

1. **Review the output JSON** to check extraction quality
2. **Run cleanup script** if needed: `python scripts/cleanup_mso_commands.py`
3. **Analyze results**: `python scripts/analyze_json.py mso_commands_enhanced.json`
4. **Use in TekAutomate** - import the JSON for command database

## Expected Results

- **Total commands**: ~2,500-7,500 (depending on PDF structure)
- **Commands with groups**: Should be high (90%+) with enhanced script
- **Commands with syntax**: Varies by PDF structure
- **Commands with examples**: Varies by PDF structure










