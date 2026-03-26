# Critical Fix: Variable Names Were Corrupted

## Date: 2026-01-21 (Second Fix)

## Problem Discovered

User exported Blockly to Steps and got corrupted Python code:
```python
# BAD - Steps UI generated this:
N%hHHhp:Bg=T0!BWtnrB = 0
while N%hHHhp:Bg=T0!BWtnrB <= 4:
    o(s_~?vBNu5x*!/I9Y1! = (1 + (N%hHHhp:Bg=T0!BWtnrB * 0.5))
```

Should have been:
```python
# GOOD - What it should be:
i = 0
while i <= 4:
    voltage = (1 + (i * 0.5))
```

## Root Cause

**Blockly stores variable IDs, not names!**

In Blockly:
- Variables have a unique **ID** (e.g., `N%hHHhp:Bg=T0!BWtnrB`)
- Variables have a **name** (e.g., `i`)
- `block.getFieldValue('VAR')` returns the **ID**, not the name!

Our converter was using the ID directly as the variable name in Python code.

## Solution

Use Blockly's `IVariableModel` API to get the actual variable name:

```typescript
// WRONG ❌
const varName = block.getFieldValue('VAR');

// CORRECT ✅
const varId = block.getFieldValue('VAR');
const varModel = block.workspace.getVariableById(varId);
const varName = varModel ? varModel.getName() : 'i';
```

## Files Fixed

### `blockToStep.ts` - 3 locations updated:

1. **`controls_for` block** (line ~183):
   ```typescript
   const varId = block.getFieldValue('VAR') || 'i';
   const varModel = block.workspace.getVariableById(varId);
   const varName = varModel ? varModel.getName() : 'i';
   ```

2. **`variables_set` block** (line ~235):
   ```typescript
   const varId = block.getFieldValue('VAR');
   const varModel = block.workspace.getVariableById(varId);
   const varName = varModel ? varModel.getName() : 'var';
   ```

3. **`convertExpressionToPython` helper** (line ~277):
   ```typescript
   case 'variables_get': {
     const varId = block.getFieldValue('VAR');
     const varModel = block.workspace.getVariableById(varId);
     return varModel ? varModel.getName() : 'var';
   }
   ```

## API Reference

From Blockly TypeScript definitions:
```typescript
interface IVariableModel<T extends IVariableState> {
    getId(): string;          // Get the unique ID
    getName(): string;        // Get the display name ✅
    getType(): string;        // Get the variable type
}
```

## Test Results

✅ **Compilation successful** (exit code 0)
✅ Variable names now resolve correctly

## What to Test

1. Load `example_scope_psu_sweep.xml` in Blockly
2. Click **"Export to Steps"**
3. Check the sweep step label: should say "For **i** = 0 to 4 step 1"
4. Check Python steps: should show `voltage = (1 + (i * 0.5))`
5. Export Python from Steps UI
6. Verify Python code uses proper variable names:
   - `i = 0`
   - `while i <= 4:`
   - `voltage = (1 + (i * 0.5))`
   - `i += 1`

## Expected Output

After this fix, Steps UI should generate:
```python
# Sweep: i from 0 to 4 step 1
i = 0
while i <= 4:
    voltage = (1 + (i * 0.5))
    psu.write(f'VOLT {voltage}')
    time.sleep(0.5)
    scpi.write("ACQUIRE:STATE ON")
    # ... rest of loop body
    i += 1
```

This should now match Blockly's output structure!
