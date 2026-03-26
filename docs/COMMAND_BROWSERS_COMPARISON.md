# Command Browser Quick Reference

## Two Types of Command Browsers in TekAutomate

TekAutomate provides **two separate command browsers** designed for different use cases:

### 1. SCPI Command Browser (Classic)

**Purpose:** Browse traditional SCPI command strings

**Access:** 
- In Builder: Click "Browse Commands" in Query/Write/Set+Query steps
- In Commands tab: Browse categories and search in the main view

**What it shows:**
- Flat list of SCPI command strings
- Categories and subcategories
- Command descriptions and examples
- Parameter options

**Output format:**
```
CH1:SCALE 1.0
HORIZONTAL:RECORDLENGTH 10000
ACQUIRE:MODE SAMPLE
```

**Use when:**
- Working with PyVISA backend
- Using raw SCPI commands
- Need to see exact SCPI syntax
- Working with older instruments

---

### 2. tm_devices Command Browser (Hierarchical)

**Purpose:** Navigate tm_devices Python API object graph

**Access:**
- In Builder: Add a **tm_devices Command** step → Click "Browse Commands"
- In Commands tab: Click the **tm_devices Browser** button (purple, ⚡ icon)

**What it shows:**
- Hierarchical tree structure
- Indexed nodes requiring explicit indices
- LEAF nodes (terminals)
- METHOD nodes (executable)

**Output format:**
```python
scope.commands.ch[1].scale.write(1.0)
afg.commands.source[1].frequency.write(1e6)
dmm.commands.read.query()
```

**Use when:**
- Working with tm_devices backend
- Need construction-based validation
- Want model-specific command lists
- Building complex indexed commands
- Learning tm_devices API structure

---

## Quick Comparison

| Feature | SCPI Browser | tm_devices Browser |
|---------|-------------|-------------------|
| **Backend** | PyVISA, VXI11 | tm_devices |
| **Output** | SCPI string | Python API call |
| **Structure** | Flat list | Hierarchical tree |
| **Validation** | Manual | Construction-based |
| **Indexed commands** | Manual typing | Explicit prompts |
| **Model-specific** | Filter by file | Select from dropdown |
| **Search** | Text search | Filter tree nodes |
| **Step type** | Query, Write, Set+Query | tm_devices Command |
| **Access in Builder** | Browse in step editor | Add tm_devices Command step |
| **Access in Commands** | Main view | tm_devices Browser button |

---

## When to Use Each

### Use SCPI Browser for:

✅ Quick SCPI command lookup  
✅ Learning SCPI syntax  
✅ PyVISA-based workflows  
✅ Simple instrument control  
✅ Cross-instrument compatibility  

### Use tm_devices Browser for:

✅ Complex tm_devices workflows  
✅ Model-specific commands  
✅ Indexed command paths (e.g., `ch[x]`)  
✅ Construction-based validation  
✅ Advanced instrument features  

---

## Example Workflows

### Example 1: Set Oscilloscope Scale (SCPI)

**Step type:** Write  
**Browser:** SCPI Command Browser  
**Command:** `CH1:SCALE 1.0`  
**Generated code:**
```python
scope.write('CH1:SCALE 1.0')
```

### Example 2: Set Oscilloscope Scale (tm_devices)

**Step type:** tm_devices Command  
**Browser:** tm_devices Command Browser  
**Navigation:** `ch[x]` → 1 → `scale` → `write()`  
**Generated code:**
```python
scope.commands.ch[1].scale.write(1.0)
```

---

## Mixing Both Approaches

You can combine both in the same workflow:

```python
# Connect via tm_devices
dm = DeviceManager()
scope = dm.add_scope("192.168.1.100")

# Use tm_devices commands
scope.commands.ch[1].scale.write(1.0)

# Mix with raw SCPI (when needed)
scope.visa_resource.write('*RST')

# Continue with tm_devices
scope.commands.acquire.state.write('RUN')

dm.close()
```

---

## Tips

### SCPI Browser Tips
- Use search to find commands quickly
- Check the "Arguments" section for parameter options
- Look at examples for usage patterns
- Filter by device family for relevant commands

### tm_devices Browser Tips
- Start at the root and explore the tree structure
- Pay attention to node badges (LEAF, METHOD, INDEXED)
- Use the breadcrumb path to track your location
- Preview generated code before adding
- Back button navigates up one level

---

## Documentation Links

- **SCPI Browser:** Built-in, no additional docs needed
- **tm_devices Browser:** [TM_DEVICES_COMMAND_BROWSER.md](./TM_DEVICES_COMMAND_BROWSER.md)
- **tm_devices API:** [TM_DEVICES_API_REFERENCE.md](./TM_DEVICES_API_REFERENCE.md)
- **Implementation:** [TM_DEVICES_BROWSER_IMPLEMENTATION.md](./TM_DEVICES_BROWSER_IMPLEMENTATION.md)

---

## Summary

| Question | Answer |
|----------|--------|
| Need SCPI strings? | Use **SCPI Browser** |
| Need tm_devices API calls? | Use **tm_devices Browser** |
| Working with PyVISA? | Use **SCPI Browser** |
| Working with tm_devices? | Use **tm_devices Browser** |
| Want command validation? | Use **tm_devices Browser** |
| Want quick lookup? | Use **SCPI Browser** |

Both browsers serve complementary purposes and excel in their respective domains.
