# Blockly to Steps Export - Fixed Issues

## Date: 2026-01-21

## Problems Identified

### 1. **Sweep Parameters Mismatch**
- **Issue**: Blockly converter was using `iterations` and `sweepType` params
- **Expected**: Steps UI expects `variableName`, `start`, `stop`, `step`, `saveResults`
- **Impact**: Generated Python had undefined variables and incorrect loop structure

### 2. **Generated Python Code Issues**
From the exported Steps Python (`tek_automation (85).py`):
- ❌ Undefined variables: `psu`, `voltage`, `current_device`, `i`
- ❌ Wrong loop: `while value <= 4:` instead of proper for loop
- ❌ No device connections generated
- ❌ No variable calculations
- ❌ Generic device references instead of device-specific (`scope.write`, `psu.write`)

From Blockly Python (`blockly_automation (8).py`): ✅ Correct!
- ✅ Proper `for i in range(5):` loop
- ✅ Variable calculation: `voltage = 1 + i * 0.5`
- ✅ Device-specific references: `scope.write()`, `psu.write()`
- ✅ Unique filenames: `capture_{i}.wfm`

## Fixes Applied

### 1. Fixed `blockToStep.ts` Converter

#### `controls_repeat_ext` / `controls_repeat` blocks:
```typescript
// OLD (WRONG)
params: {
  iterations,
  sweepType: 'repeat'
}

// NEW (CORRECT)
params: {
  variableName: 'i',      // Steps UI needs this
  start: 0,               // Steps UI needs this
  stop: iterations - 1,   // Steps UI needs this
  step: 1,                // Steps UI needs this
  saveResults: false      // Steps UI needs this
}
```

#### `controls_for` blocks:
```typescript
// OLD (WRONG)
params: {
  iterations,
  sweepType: 'for',
  variable: varName,  // Wrong key name
  start: fromValue,
  stop: toValue,
  step: byValue
}

// NEW (CORRECT)
params: {
  variableName: varName,  // Correct key name
  start: fromValue,
  stop: toValue,
  step: byValue,
  saveResults: false
}
```

### 2. Updated Example XML Files
Both `example_scope_psu_sweep.xml` and `example_scope_psu_sweep_CORRECT.xml` now have:
- ✅ `controls_for` loop with variable tracking (`i`)
- ✅ `variables_set` block: `voltage = 1 + (i * 0.5)`
- ✅ `python_code` blocks for device-specific commands
- ✅ F-string usage: `psu.write(f'VOLT {voltage}')`
- ✅ Dynamic filenames: `scope.write(f'SAVE:WAVEFORM CH1, "C:/Captures/capture_{i}.wfm"')`

## How Steps UI Generates Sweep Loops

From `App.tsx` lines 4466-4501:
```python
# Sweep: variableName from start to stop step step
variableName = start
while variableName <= stop:
    # ... children commands ...
    variableName += step
```

### Requirements:
1. `params.variableName` - The loop variable name
2. `params.start` - Starting value
3. `params.stop` - Ending value (inclusive)
4. `params.step` - Increment per iteration
5. `params.saveResults` - Whether to collect results
6. `children[]` - Steps to execute in loop

## Testing Checklist

- [x] Compile successful (no TypeScript errors)
- [ ] Load `example_scope_psu_sweep.xml` in Blockly
- [ ] Export to Steps - verify sweep structure
- [ ] Generate Python from Steps - compare with Blockly Python
- [ ] Verify:
  - [ ] Loop structure matches
  - [ ] Variable calculations present
  - [ ] Device-specific commands (`scope.write`, `psu.write`)
  - [ ] Dynamic filenames with loop index

## Known Limitations

1. **Device Context**: Steps UI doesn't have per-step device binding like Blockly
   - Blockly tracks device context per block
   - Steps UI uses global device connection
   - Workaround: `set_device_context` blocks converted to comments

2. **Complex Expressions**: Steps UI relies on Python steps for calculations
   - Variable assignments → `python` steps
   - Math operations → `python` steps with calculated expressions

3. **Connection Parameters**: Steps needs at least one device configured in the main UI
   - Export creates connect steps but doesn't auto-populate device list

## Next Steps

User should:
1. Load the corrected XML example
2. Test "Export to Steps" button
3. Verify generated Python matches expectations
4. Check if device connections need manual selection
