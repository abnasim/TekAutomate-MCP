# SCPI Parameter Selection Improvements

## Overview
Enhanced the SCPI command browser and parameter selection across the application to provide proper UI for selecting channels, modes, and other parameters - similar to how the Steps UI works.

## Issues Fixed

### 1. ✅ Query Mark (?) Appearing in SCPI Write Commands
**Problem**: Commands like `SOURce{ch}:SWEep:MODE {mode}` were being shown as `SOURce{ch}:SWEep:MODE {mode}?` in SCPI Write operations, which is incorrect syntax.

**Solution**: 
- Added logic to detect command type (set/query/both) from `manualEntry.commandType`
- Automatically removes `?` from SET commands when initializing the editor
- Applied in both CommandDetailModal and BrowseCommandsModal

**Files Modified**:
- `src/components/CommandDetailModal.tsx`
- `src/components/BrowseCommandsModal.tsx`

### 2. ✅ Missing Parameter Selection UI
**Problem**: Users saw commands like `SOURce{ch}:SWEep:MODE {mode}` but had no way to properly select values for `{ch}` (channel) and `{mode}` (AUTO/MANual) parameters.

**Solution**: Created a reusable `SCPIParameterSelector` component that:
- Automatically detects editable parameters (channels, modes, numeric values, enumerations)
- Provides dropdowns for parameters with predefined options (e.g., CH1-CH4, AUTO/MANual)
- Provides text inputs for numeric/custom parameters
- Enriches parameter information from command library metadata
- Works in both compact (modal) and full-size modes

**New Component**:
- `src/components/SCPIParameterSelector.tsx`

### 3. ✅ Enhanced Command Browser (BrowseCommandsModal)
**Problem**: Command browser showed basic info but didn't break down parameters like the Steps UI does.

**Solution**: 
- Added inline parameter editor in the command detail panel
- Shows "Edit Parameters" button when editable parameters are detected
- Provides live preview of the edited command
- Updates the command sent to Blockly/Steps with user-selected parameters

**Features Added**:
- Parameter detection using existing `parseSCPI()` and `detectEditableParameters()` utilities
- Inline editing panel with SCPIParameterSelector component
- Real-time command preview showing the updated command
- Proper handling of edited commands when adding to workspace

**Files Modified**:
- `src/components/BrowseCommandsModal.tsx`

### 4. ✅ Enhanced Command Detail Modal
**Problem**: Command detail modal showed syntax and examples but no interactive parameter editing.

**Solution**:
- Added "Edit Parameters" toggle button in the header
- Shows parameter editor section when parameters are detected
- Displays updated command preview
- Passes edited command to "Add to Flow" button

**Features Added**:
- Settings icon button to show/hide parameter editor
- Full parameter editing UI using SCPIParameterSelector
- Updated command preview box
- Tooltip on "Add to Flow" button showing the command that will be added

**Files Modified**:
- `src/components/CommandDetailModal.tsx`

### 5. ✅ Blockly Integration
**Problem**: Blockly SCPI blocks used the command browser but couldn't edit parameters before insertion.

**Solution**: 
- The enhanced BrowseCommandsModal (from fix #3) is already used by Blockly
- When user selects a command and edits parameters, the edited command is passed to the Blockly block
- No additional changes needed - the improvements automatically apply to Blockly!

**How It Works**:
1. User right-clicks SCPI Write/Query block → "Browse SCPI Commands"
2. BrowseCommandsModal opens with inline parameter editor
3. User selects command (e.g., `SOURce1:SWEep:MODE AUTO`)
4. User clicks "Edit Parameters" button
5. Selects desired channel (SOURce1-SOUrce4) and mode (AUTO/MANual)
6. Clicks "Add to Workspace"
7. Blockly block receives the fully configured command

## Technical Details

### SCPIParameterSelector Component

**Props**:
- `command`: Current SCPI command string
- `editableParameters`: Array of detected parameters
- `parsed`: Parsed SCPI structure
- `commandParams`: Command library metadata
- `onCommandChange`: Callback when command is edited
- `title`: Section title
- `className`: Additional CSS classes
- `compact`: Boolean for compact mode

**Features**:
- Automatically enriches parameters with library metadata
- Filters out type placeholders (`<NR1>`, `<QString>`) from dropdown options
- Shows appropriate labels (Channel, Mode, etc.) based on parameter type
- Handles both mnemonic parameters (CH1, MATH1) and argument parameters (AUTO, MANual)
- Provides tooltips with parameter descriptions

### Parameter Detection

Reuses existing utilities:
- `parseSCPI()` - Parses command structure
- `detectEditableParameters()` - Detects mnemonics (CH1, MATH1, B1) and arguments
- `replaceParameter()` - Updates command string with new parameter values

### Example Usage

**Before (incomplete info)**:
```
Set Sweep Mode
Command: SOURce{ch}:SWEep:MODE {mode}
Syntax: SOURce{ch}:SWEep:MODE {AUTO|MANual}
```

**After (with parameter editor)**:
```
Set Sweep Mode
Command: SOURce1:SWEep:MODE AUTO
[Edit Parameters] button

Parameters:
  Channel: [Dropdown: SOUrce1, SOUrce2, SOUrce3, SOUrce4]
  Mode: [Dropdown: AUTO, MANual]

Updated Command: SOURce1:SWEep:MODE AUTO
```

## User Experience Improvements

1. **Clarity**: Users immediately see what parameters need to be configured
2. **Ease of Use**: Dropdown selections instead of manual typing
3. **Error Prevention**: Only valid options are shown (no typos like "MANUEL" instead of "MANual")
4. **Consistency**: Same parameter editing experience across Blockly, Steps UI, and Command Browser
5. **Discoverability**: "Edit Parameters" button clearly indicates interactive editing is available

## Files Created
- `src/components/SCPIParameterSelector.tsx` (new reusable component)
- `docs/PARAMETER_SELECTION_IMPROVEMENTS.md` (this document)

## Files Modified
- `src/components/CommandDetailModal.tsx`
- `src/components/BrowseCommandsModal.tsx`

## Testing Recommendations

1. **Test in Blockly**:
   - Create SCPI Write block
   - Right-click → "Browse SCPI Commands"
   - Select a command with parameters (e.g., channel sweep commands)
   - Verify parameter editor appears
   - Edit parameters and add to workspace
   - Verify block shows edited command

2. **Test in Command Browser**:
   - Open command browser from toolbar
   - Select command with parameters
   - Click "Edit Parameters"
   - Verify dropdowns show correct options
   - Verify updated command preview
   - Add to workspace

3. **Test in Command Detail Modal**:
   - Click info icon on any command
   - Verify "Edit Parameters" button appears for commands with parameters
   - Toggle parameter editor
   - Edit parameters
   - Verify "Add to Flow" uses edited command

4. **Edge Cases**:
   - Commands with query mark (?) should have it removed for SET commands
   - Commands with multiple parameters should show all editors
   - Commands without parameters should not show parameter editor
   - Numeric parameters should show text input
   - Enumeration parameters should show dropdown with valid options

## Future Enhancements

Potential improvements for future consideration:
1. Add parameter validation (min/max for numeric values)
2. Show parameter descriptions as tooltips on labels
3. Add "Reset to Default" button to restore original command
4. Save recent parameter selections for quick reuse
5. Add parameter presets for common configurations
6. Show parameter dependencies (e.g., some parameters only valid for certain channels)

## Conclusion

These improvements provide a complete and intuitive parameter selection experience across the entire application, making SCPI command configuration much easier and less error-prone for users. The reusable SCPIParameterSelector component ensures consistency and can be easily extended to support new features in the future.
