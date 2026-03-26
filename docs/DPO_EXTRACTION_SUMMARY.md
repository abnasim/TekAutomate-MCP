# DPO Series Command Extraction Summary

## Overview
Successfully extracted **1,481 SCPI commands** from the MSO/DPO5000/B, DPO7000/C, DPO70000/B/C/D/DX/SX, DSA70000/B/C/D, and MSO70000/C/DX Series Programmer Manual.

## Extraction Process

### 1. Font-Aware Extraction
- **Script**: `scripts/extract_scpi_from_word_font_aware_DPO.py`
- **Input**: `MSO-DPO5000-B-DPO7000-C-DPO70000.docx`
- **Output**: `public/commands/MSO_DPO_5k_7k_70K.json`

### 2. Font Detection
The script uses font-based detection to identify command structure:
- **Command Headers**: Arial Narrow, Bold
- **NOTE Sections**: Arial Narrow, Italic
- **Syntax Lines**: Lucida Console
- **Section Headers**: Arial Narrow, Bold
- **Descriptions**: Times New Roman

### 3. Command Group Mapping
- **Source**: Pages 22-116 of the manual (Command Groups tables)
- **Parser**: `scripts/parse_dpo_command_groups.py`
- **Mapping File**: `scripts/command_groups_mapping_DPO.py`
- **Commands Mapped**: 912 commands from manual tables

## Command Grouping Improvements

### Initial State
- **Miscellaneous**: 511 commands (34.5% of all commands)
- Many commands incorrectly categorized

### After Improvements
- **Miscellaneous**: 21 commands (1.4% of all commands)
- **490 commands** properly re-categorized

### Improvements Made
1. **Parent Command Matching**: Commands like `AUXIn:PRObe:DEGAUSS:STATE?` now match parent `AUXIn:PRObe:DEGAUSS` (Vertical group)
2. **Enhanced Prefix Matching**: Added 20+ prefix patterns for better categorization
3. **Special Handling**: MARK and SELect commands properly routed to "Search and Mark"

## Final Command Distribution

| Group | Commands | Percentage |
|-------|----------|------------|
| Search and Mark | 357 | 24.1% |
| Trigger | 298 | 20.1% |
| Error Detector | 137 | 9.3% |
| Bus | 87 | 5.9% |
| Mask | 85 | 5.7% |
| Measurement | 65 | 4.4% |
| Horizontal | 54 | 3.6% |
| Low Speed Serial Trigger | 47 | 3.2% |
| Display control | 46 | 3.1% |
| Cursor | 38 | 2.6% |
| Diagnostics | 28 | 1.9% |
| Vertical | 28 | 1.9% |
| Waveform Transfer | 27 | 1.8% |
| Zoom | 27 | 1.8% |
| Limit Test | 22 | 1.5% |
| E-mail | 21 | 1.4% |
| Miscellaneous | 21 | 1.4% |
| Acquisition | 16 | 1.1% |
| Save On | 14 | 0.9% |
| Save and Recall | 13 | 0.9% |
| Hard copy | 11 | 0.7% |
| File system | 10 | 0.7% |
| Histogram | 10 | 0.7% |
| Calibration | 7 | 0.5% |
| Alias | 6 | 0.4% |
| Digital | 5 | 0.3% |
| Math | 1 | 0.1% |

**Total**: 1,481 commands across 27 groups

## Remaining Miscellaneous Commands

The 21 remaining "Miscellaneous" commands are system-level commands that don't fit standard categories:
- `APPLication:*` - Application control
- `AUXout:*` - Auxiliary output
- `FPANel:*` - Front panel control
- `IDNMultiscope:*` - Instrument identification
- `ROSc:*` - Reference oscillator
- `USBTMC:*` - USB TMC interface
- `VISual:*` - Visual settings
- `SETUp:*` - Setup management

These are appropriately categorized as "Miscellaneous".

## Files Created/Modified

1. **`scripts/extract_scpi_from_word_font_aware_DPO.py`**
   - Main extraction script with DPO-specific font detection
   - Improved command grouping with parent matching
   - Enhanced fallback logic

2. **`scripts/parse_dpo_command_groups.py`**
   - Parser for Command_groups_DPOx.txt
   - Extracts command-to-group mappings from manual tables

3. **`scripts/command_groups_mapping_DPO.py`**
   - Generated mapping file with 912 commands
   - 27 command groups defined

4. **`scripts/check_command_mapping.py`**
   - Diagnostic script to verify command categorization

5. **`public/commands/MSO_DPO_5k_7k_70K.json`**
   - Final output with all 1,481 commands properly categorized

## Key Features

✅ **Font-aware extraction** - Correctly identifies commands by font formatting  
✅ **Command group mapping** - Uses manual's golden key tables (pages 22-116)  
✅ **Parent command matching** - Handles sub-commands correctly  
✅ **Enhanced fallback logic** - 20+ prefix patterns for categorization  
✅ **Proper syntax splitting** - Handles combined set/query syntax  
✅ **Parameter extraction** - Detects command arguments and options  

## Usage

To re-extract commands:
```bash
python scripts/extract_scpi_from_word_font_aware_DPO.py
```

Output will be saved to: `public/commands/MSO_DPO_5k_7k_70K.json`

## Notes

- The extraction found 1,481 commands vs. 912 in the mapping tables, indicating some commands may be variations or not listed in the tables
- Parent command matching successfully categorized many sub-commands
- The remaining 21 "Miscellaneous" commands are appropriate for that category



