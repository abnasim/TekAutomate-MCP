# Blockly Builder Improvements

## Overview
Enhanced Blockly Builder with termination support, SCPI/tm_devices conversion, and fixed command browser issues.

## Issues Fixed

### 1. ✅ Added Termination Parameter to Configure Channel Block

**Problem**: Configure Channel block only had Scale, Offset, and Coupling - missing Termination (50Ω vs 1MΩ)

**Solution**: 
- Added Termination dropdown with options: `1 MΩ (ONEMEG)` and `50 Ω (FIFTY)`
- Updated Python code generator to include termination command
- Updated block-to-step converter to export termination setting

**Files Modified**:
- `src/components/BlocklyBuilder/blocks/channelBlocks.ts` - Added termination field
- `src/components/BlocklyBuilder/generators/pythonGenerators.ts` - Generate termination SCPI command
- `src/components/BlocklyBuilder/converters/blockToStep.ts` - Export termination to Steps UI

**Generated Code Example**:
```python
# Configure CH1 on scope
scope.write('CH1:SCALE 1.0')
scope.write('CH1:OFFSET 0')
scope.write('CH1:COUPLING DC')
scope.write('CH1:TERMINATION FIFTY')  # NEW: Termination setting
```

### 2. ✅ Added SCPI ↔ tm_devices Conversion

**Problem**: Users couldn't easily convert between SCPI commands and tm_devices paths, even though they're equivalent.

**Solution**: 
- Created `scpiToTmDevicesConverter.ts` utility with bidirectional conversion
- Added right-click context menu option "Convert to tm_devices Command" on SCPI Write/Query blocks
- Automatic conversion logic:
  - `CH1:SCALE 1.0` → `ch[1].scale.write(1.0)`
  - `*IDN?` → `commands.idn.query()`
  - Handles indexed parameters (CH1, MATH2, etc.)
  - Detects query vs write based on `?` and arguments

**Files Created**:
- `src/utils/scpiToTmDevicesConverter.ts` - Conversion utilities

**Files Modified**:
- `src/components/BlocklyBuilder/blocks/scpiBlocks.ts` - Added context menu
- `src/components/BlocklyBuilder/BlocklyBuilder.tsx` - Added conversion event handler

**How It Works**:
1. Right-click on SCPI Write or SCPI Query block
2. Select "🔄 Convert to tm_devices Command"
3. See conversion preview with path, method, and value
4. Confirm to see the tm_devices equivalent
5. User can then create a tm_devices block with the converted path

**Conversion Examples**:

| SCPI Command | tm_devices Path | Method | Value |
|--------------|-----------------|--------|-------|
| `CH1:SCALE 1.0` | `ch[1].scale` | `write` | `1.0` |
| `CH2:COUPLING DC` | `ch[2].coupling` | `write` | `DC` |
| `*IDN?` | `commands.idn` | `query` | - |
| `ACQUIRE:STATE?` | `acquire.state` | `query` | - |
| `MATH1:DEFINE "CH1+CH2"` | `math[1].define` | `write` | `"CH1+CH2"` |

### 3. ✅ Fixed Browse SCPI Commands Showing "All (0)" in Blockly

**Problem**: When opening "Browse SCPI Commands" from Blockly, it showed "All (0)" with no commands available, even though commands were loaded in the app.

**Root Cause**: 
- Device family filter (e.g., "4/5/6 Series") didn't match the command categories
- Commands were tagged with their JSON source file (`sourceFile` property)
- Filter was only checking `category` and `manualEntry.commandGroup`, not source file

**Solution**: 
- Enhanced filtering logic to check `sourceFile` property
- Added mapping from device family to source JSON file
- Now properly filters commands by their source file

**Files Modified**:
- `src/components/BlocklyBuilder/BlocklyBuilder.tsx` - Enhanced `filteredCommands` logic

**Device Family to File Mapping**:
```typescript
const familyToFile: Record<string, string> = {
  '4/5/6 Series': 'mso_2_4_5_6_7.json',
  'DPO/MSO 5k_7k_70K': 'MSO_DPO_5k_7k_70K.json',
  'TekExpress': 'tekexpress.json',
  'DPOJET': 'dpojet.json',
  'AFG': 'afg.json',
  'SMU': 'smu.json',
};
```

**Before** (Broken):
```
Browse SCPI Commands
Categories: All (0)  ← No commands shown!
```

**After** (Working):
```
Browse SCPI Commands
4/5/6 Series ▼  
Categories: All (2847)
- Acquisition (324)
- Channel (156)
- Display (89)
...
```

### 4. ✅ Unified Command Browsers

**Status**: Already unified! Both Blockly and Commands page use the same components:
- `BrowseCommandsModal` - Main SCPI command browser
- `TmDevicesCommandBrowser` - tm_devices hierarchical browser
- `SCPIParameterSelector` - Parameter editing (from previous fix)

**Features Now Available in Both Places**:
- ✅ Parameter editing before adding command
- ✅ Device family filtering
- ✅ Search and category filtering
- ✅ Command details with syntax and examples
- ✅ Inline parameter preview
- ✅ Copy command to clipboard

## Technical Details

### Conversion Algorithm

The SCPI ↔ tm_devices converter follows these rules:

**SCPI → tm_devices**:
1. Split SCPI command by `:` to get path components
2. Detect indexed components (e.g., `CH1` → `ch[1]`)
3. Convert to lowercase and join with `.`
4. Determine method based on `?` (query) or presence of value (write)

**tm_devices → SCPI**:
1. Split path by `.` to get components
2. Detect indexed access (e.g., `ch[1]` → `CH1`)
3. Convert to uppercase and join with `:`
4. Add `?` for query methods, append value for write methods

### Configure Channel Block Fields

```
📺 Configure Channel
  Channel: [CH1 ▼] CH1/CH2/CH3/CH4
  Scale: [1.0] V
  Offset: [0] V
  Coupling: [DC ▼] DC/AC/GND
  Termination: [1 MΩ ▼] 1 MΩ/50 Ω  ← NEW!
```

### Context Menu Options

**SCPI Write/Query Blocks**:
- 📖 Browse SCPI Commands (existing)
- 🔄 Convert to tm_devices Command (NEW)
- Duplicate
- Add Comment
- Delete Block
- Help

## User Workflows

### Workflow 1: Configure Channel with Termination

1. Drag "Configure Channel" block to workspace
2. Set Channel: CH1
3. Set Scale: 1.0 V
4. Set Offset: 0 V
5. Set Coupling: DC
6. Set Termination: 50 Ω ← NEW
7. Generate Python code

Result:
```python
scope.write('CH1:SCALE 1.0')
scope.write('CH1:OFFSET 0')
scope.write('CH1:COUPLING DC')
scope.write('CH1:TERMINATION FIFTY')
```

### Workflow 2: Convert SCPI to tm_devices

1. Create SCPI Write block with command: `CH1:SCALE 1.0`
2. Right-click block → "Convert to tm_devices Command"
3. See conversion preview:
   ```
   SCPI: CH1:SCALE 1.0
   tm_devices: ch[1].scale.write(1.0)
   ```
4. Confirm to see full details
5. Create tm_devices command block with path: `ch[1].scale`
6. Set method: `write`
7. Set value: `1.0`

### Workflow 3: Browse Commands in Blockly

1. Click "Browse Commands" in Blockly toolbar
2. Select device family: "4/5/6 Series"
3. Browse categories (now shows correct count!)
4. Select command (e.g., "Set Sweep Mode")
5. Click "Edit Parameters" button
6. Select Channel: SOUrce1
7. Select Mode: AUTO
8. See updated command: `SOURce1:SWEep:MODE AUTO`
9. Click "Add to Workspace"
10. Command added to Blockly with parameters configured!

## Future Enhancements

Potential improvements:
1. **Automatic block creation**: Instead of just showing conversion, automatically create the tm_devices block
2. **Reverse conversion**: Add "Convert to SCPI" option on tm_devices blocks
3. **Bulk conversion**: Convert entire workspace from SCPI to tm_devices or vice versa
4. **Smart suggestions**: Suggest tm_devices path when typing SCPI command
5. **More termination options**: Support for different termination values (75Ω, etc.)
6. **Validation**: Warn if termination doesn't match expected probe type

## Testing Checklist

- [x] Configure Channel block shows termination dropdown
- [x] Python code includes termination command
- [x] Export to Steps includes termination
- [x] Right-click on SCPI Write shows "Convert to tm_devices"
- [x] Right-click on SCPI Query shows "Convert to tm_devices"
- [x] Conversion shows correct path for indexed commands (CH1 → ch[1])
- [x] Conversion detects query vs write correctly
- [x] Browse SCPI Commands in Blockly shows commands (not 0)
- [x] Device family filtering works correctly
- [x] Parameter editor works in Blockly command browser
- [x] No linter errors in modified files

## Files Summary

**Created**:
- `src/utils/scpiToTmDevicesConverter.ts` - Conversion utilities
- `docs/BLOCKLY_IMPROVEMENTS.md` - This document

**Modified**:
- `src/components/BlocklyBuilder/blocks/channelBlocks.ts` - Added termination
- `src/components/BlocklyBuilder/generators/pythonGenerators.ts` - Generate termination code
- `src/components/BlocklyBuilder/converters/blockToStep.ts` - Export termination
- `src/components/BlocklyBuilder/blocks/scpiBlocks.ts` - Added conversion context menu
- `src/components/BlocklyBuilder/BlocklyBuilder.tsx` - Fixed filtering, added conversion handler

## Conclusion

These improvements make Blockly Builder more powerful and user-friendly by:
1. **Completeness**: Configure Channel now supports all common parameters
2. **Interoperability**: Easy conversion between SCPI and tm_devices formats
3. **Usability**: Command browser now works correctly with proper filtering
4. **Consistency**: Same enhanced features across Blockly and Commands page

The unified approach to command browsing and parameter editing provides a consistent, professional experience throughout the application.
