# Blockly Current Issues & Fixes Needed

## ✅ FIXED:
1. **Redundant imports** - Now imports `pyvisa` and creates `rm` once at top
2. **Device naming** - Using `scope`, `psu` instead of `current_device`
3. **Device context visualization** - Shows (scope), (psu) in block labels

## 🔧 TO FIX:

### 1. **Loop Index Variable** (Critical)
**Problem**: The `repeat N times` block doesn't provide a loop index
```python
# Current (WRONG):
for _ in range(5):
    psu.write('VOLT 1.0')  # Always 1.0!
```

**Solution**: Need to use Blockly's built-in `controls_for` block with index:
```python
# Correct:
for i in range(5):
    voltage = 1.0 + (i * 0.5)
    psu.write(f'VOLT {voltage}')  # 1.0, 1.5, 2.0, 2.5, 3.0
```

### 2. **File Overwriting** (Critical)
**Problem**: Saves to same filename every loop iteration
```python
# Current (WRONG):
scope.write('SAVE:WAVEFORM CH1, "C:/Captures/capture.wfm"')  # Overwrites!
```

**Solution**: Append loop index to filename:
```python
# Correct:
scope.write(f'SAVE:WAVEFORM CH1, "C:/Captures/capture_{i}.wfm"')
```

### 3. **Comment vs Python Code** (User Confusion)
**Problem**: User added a comment block that says "Set PSU voltage (START_VOLTAGE + i * VOLTAGE_STEP)" thinking it would calculate the voltage, but it's just a comment - does nothing.

**Solution**: Replace comment with actual Python code block:
```python
# Instead of comment:
voltage = 1.0 + (i * 0.5)  # Real calculation
psu.write(f'VOLT {voltage}')
```

### 4. **No Command Browser**
**Problem**: Users can't search for SCPI commands to add
- In Steps UI, there's a command browser showing all SCPI commands from JSON files
- Blockly should have same feature

**Solution Options**:
a) Add a search panel on the right side
b) Add a "Browse Commands" button that opens a modal
c) Enhance existing blocks with command suggestions

### 5. **Groups Not Shown in Toolbox**
**Problem**: Steps UI has "groups" to organize commands. Blockly doesn't show these.

**Solution**: 
- Add a "Groups" category in left toolbox
- List available group templates
- Users can drag group templates into workspace

### 6. **Image Stays on Screen** (UI Bug)
**Problem**: When user closes toolbar, an image/element stays visible

**Need more info**: What image? Where exactly?

## Recommended Next Steps:

1. Create a proper example with:
   - `controls_for` loop (with index variable)
   - Python code block for voltage calculation
   - Dynamic filename with loop index

2. Add a "Variables" section to create START_VOLTAGE, VOLTAGE_STEP constants

3. Add command browser UI to search SCPI commands

4. Add groups support in toolbox
