# How to Run the Extraction Script

## Quick Start

The extraction script (`extract_fast.py`) has been **updated with the syntax fix** for commands like `BUS:B<x>:ARINC429A:SOUrce`.

### Prerequisites

1. **Python 3** installed
2. **python-docx** library installed:
   ```bash
   pip install python-docx
   ```
3. **Word document** in project root:
   - File: `4-5-6_MSO_Programmer_077189801_RevA (1).docx`
   - Location: Project root (same directory as `scripts/` folder)

### Run the Extraction

From the project root directory, run:

```bash
python scripts/extract_fast.py
```

Or from the scripts directory:

```bash
cd scripts
python extract_fast.py
```

### What It Does

1. **Finds the Word document** automatically (looks for `.docx` files in project root)
2. **Extracts all SCPI commands** with:
   - Syntax (now correctly splits set/query syntax)
   - Description
   - Arguments
   - Examples
   - Conditions
   - Group assignment
3. **Saves output** to: `public/commands/mso_commands_final.json`

### Output

The script will:
- Print progress messages
- Show how many commands were loaded from groups
- Display the output file path
- Show total commands and groups extracted

Example output:
```
Loaded 2952 commands from 34 groups
Loading: C:\Users\...\4-5-6_MSO_Programmer_077189801_RevA (1).docx
Loaded. 12345 paragraphs
...
Saving to ...\public\commands\mso_commands_final.json
Done! 1500 commands in 34 groups
```

### What's Fixed

The updated script now correctly extracts syntax for commands like:
- `BUS:B<x>:ARINC429A:SOUrce  {CH<x>|MATH<x>|REF<x>} BUS:B<x>:ARINC429A:SOUrce?`

**Before (broken):**
- `set`: `"BUS:B<x>:ARINC429A:SOUrce"` ❌ (missing arguments)
- `query`: `"BUS:B<x>:ARINC429A:SOUrce  {CH<x>|MATH<x>|REF<x>} BUS:B<x>:ARINC429A:SOUrce?"` ❌ (combined)

**After (fixed):**
- `set`: `"BUS:B<x>:ARINC429A:SOUrce {CH<x>|MATH<x>|REF<x>}"` ✅
- `query`: `"BUS:B<x>:ARINC429A:SOUrce?"` ✅

### After Running

1. **Check the output file**: `public/commands/mso_commands_final.json`
2. **Verify a command** like `BUS:B<x>:ARINC429A:SOUrce` has correct syntax
3. **Restart your app** to load the updated JSON file

### Troubleshooting

**Error: "No Word document found"**
- Make sure the `.docx` file is in the project root (not in `scripts/` folder)
- Check the file name matches: `4-5-6_MSO_Programmer_077189801_RevA (1).docx`

**Error: "python-docx not installed"**
- Run: `pip install python-docx`

**Error: "No module named 'command_groups_mapping'"**
- Make sure you're running from the project root or scripts directory
- The script should find `command_groups_mapping.py` in the `scripts/` folder



