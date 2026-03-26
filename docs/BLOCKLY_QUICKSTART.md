# Quick Start Guide - Blockly Builder

## 🎯 Which Tool Should I Use?

### Use **Blockly Builder** for:
- ✅ Automating **multiple instruments** (scope + PSU + DMM)
- ✅ Creating **portable Python scripts**
- ✅ **Visual programming** for non-coders
- ✅ **Complex workflows** with loops and variables
- ✅ **Clean, maintainable code**

### Use **Steps UI** for:
- ✅ **Single instrument** automation
- ✅ **Quick SCPI testing**
- ✅ **Browsing** the command library
- ✅ **Legacy workflows** (existing .json files)

---

## 🚀 Getting Started with Blockly

### 1. Open Blockly Builder
Click **"Flow Designer"** in the top navigation

### 2. Load the Example
1. Click **"Load File"**
2. Select `example_scope_psu_sweep.xml`
3. See the visual workflow!

### 3. Understand the Workflow
The example shows:
- **Connect to scope** (192.168.1.10)
- **Configure scope** (stop acquisition)
- **Connect to PSU** (192.168.1.15)
- **Loop 5 times**:
  - Calculate voltage: `1.0 + (i * 0.5)` → 1.0, 1.5, 2.0, 2.5, 3.0V
  - Set PSU voltage
  - Start scope acquisition
  - Wait for completion
  - Save waveform with unique filename
- **Disconnect devices**

### 4. Generate Python
Click **"Export Python"** → Get clean, working Python code!

---

## 📦 Block Categories

### 🔌 Connection
- **Connect to Instrument** - Open device connection
- **Disconnect** - Close current device
- **Use Device** - Switch context to different device

### 📺 SCPI
- **SCPI Write** - Send command
- **SCPI Query** - Query and save response
- **Custom Command** - Free-text SCPI

### 🔄 Control
- **Repeat N times** - Simple loop
- **For loop** - Loop with index variable
- **If/else** - Conditional logic (Blockly built-in)

### 🧮 Variables & Math
- **Set variable** - Create/assign variable
- **Get variable** - Use variable value
- **Math operations** - Add, subtract, multiply, divide

### ⏱️ Timing
- **Wait seconds** - Delay
- **Wait for OPC** - Wait for operation complete

### 💬 Utility
- **Comment** - Add annotation
- **Python Code** - Custom Python snippet

---

## 🎨 Visual Indicators

### Device Context Colors
- **Blue blocks** - Commands going to **scope**
- **Red blocks** - Commands going to **PSU**
- **Green blocks** - Commands going to **DMM**
- **Gray blocks** - Unknown/no device context

Each SCPI block shows `(device_name)` to indicate which instrument will receive the command.

---

## 💾 Save & Load

### Save Workspace
**"Save File"** → Downloads XML file with your workflow

### Load Workspace
**"Load File"** → Import XML file

### Import from Steps UI
**"Import from Steps"** → Convert existing Steps workflow to Blockly blocks

### Export to Steps UI
**"Export to Steps"** → Convert Blockly back to Steps (structure only)

---

## 🐍 Python Code Generation

Blockly generates clean Python with:
- ✅ Proper imports (`pyvisa`, `time`)
- ✅ Device-specific variables (`scope`, `psu`, `dmm`)
- ✅ Error handling (try/except)
- ✅ Connection management
- ✅ Automatic cleanup (close all devices)
- ✅ F-strings for variables in commands

### Example Output:
```python
#!/usr/bin/env python3
import time
import pyvisa

rm = pyvisa.ResourceManager()

# Connect to scope
scope = rm.open_resource('TCPIP::192.168.1.10::INSTR')
scope.timeout = 5000

# Connect to PSU
psu = rm.open_resource('TCPIP::192.168.1.15::INSTR')
psu.timeout = 5000

# Loop with variable
for i in range(5):
    voltage = 1 + i * 0.5
    psu.write(f'VOLT {voltage}')
    scope.write('ACQUIRE:STATE ON')
    # ... more commands

# Cleanup
for var_name in list(locals().keys()):
    try:
        obj = locals()[var_name]
        if hasattr(obj, 'close') and callable(obj.close):
            obj.close()
    except:
        pass
```

---

## 🔧 Tips & Tricks

### Creating a Loop with Variables
1. Add **"For loop"** block from Control category
2. Set range (e.g., 0 to 4)
3. Inside loop, add **"Set variable"** block
4. Use **Math** blocks to calculate values
5. In SCPI commands, use **Python Code** block with f-strings: `device.write(f'VOLT {voltage}')`

### Using Multiple Devices
1. **Connect to Instrument** for each device (give them unique names!)
2. Use **"Use Device"** block to switch context
3. Watch the `(device_name)` indicator update on SCPI blocks

### Dynamic Filenames
Use **Python Code** block:
```python
scope.write(f'SAVE:WAVEFORM CH1, "capture_{i}.wfm"')
```
This creates `capture_0.wfm`, `capture_1.wfm`, etc.

### Comments & Documentation
Add **Comment** blocks throughout to explain your workflow - these become Python comments!

---

## ⚠️ Known Limitations

### Steps UI Export
When you **"Export to Steps"**, the converter:
- ✅ Preserves structure (loops, steps, order)
- ✅ Converts blocks to Steps UI format
- ⚠️ Steps UI Python generation has limitations with multiple devices
- ✅ **Use Blockly Python for multi-device workflows!**

### Why?
Steps UI was designed for single-device workflows. For multi-device automation, **always export Python directly from Blockly** for best results.

---

## 📚 Example Files

### `example_scope_psu_sweep.xml`
Complete multi-device sweep example:
- Scope + PSU coordination
- Variable-driven voltage sweep
- Dynamic waveform capture
- Proper device context switching

Load this to see best practices!

---

## 🆘 Troubleshooting

### Blocks not connecting?
- Check block types - only compatible blocks snap together
- Look for the puzzle piece outline

### Device indicator shows `(?)`?
- No device context set yet
- Add **"Connect to Instrument"** or **"Use Device"** block above

### Variables showing as random characters?
- This was a bug - **now fixed!**
- Re-export your workspace if you see this

### Python code has undefined variables?
- Make sure you have **"Connect to Instrument"** blocks
- Check device names match in SCPI commands
- Use **Blockly's** Python export, not Steps UI

---

## 🎓 Learning Resources

### Start Simple
1. Load example
2. Modify one value
3. Export Python
4. Run it!

### Build Up
1. Add a simple loop
2. Add a variable
3. Use that variable in a command
4. Celebrate! 🎉

### Go Complex
1. Multiple devices
2. Nested loops
3. Conditional logic
4. Math calculations

---

## 🚀 Ready to Automate!

**Blockly Builder is your visual programming interface for instrument automation.**

- Intuitive drag-and-drop
- Multi-device support
- Clean Python generation
- Perfect for teams with mixed coding skills

**Happy Automating!** 🎯

---

*For advanced usage and limitations, see `BLOCKLY_LIMITATIONS.md`*
