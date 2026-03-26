# TekAcademy Knowledge Base - Preparation Guide

## Purpose
This guide explains how to prepare your TekAcademy documentation for upload to the TekAutomate Workflow Builder GPT.

---

## 📁 What to Include

### 1. Backend Usage Guides

**pyvisa_guide.md**
```markdown
# PyVISA Backend Guide

## When to Use
- Standard SCPI commands
- Maximum compatibility across all instruments
- Measurements, searches, histograms
- Any workflow NOT requiring high-speed data capture

## Example Workflow
```json
{
  "name": "Basic Measurement",
  "backend": "pyvisa",
  "steps": [
    {"type": "connect", "params": {}},
    {"type": "scpi_write", "params": {"command": "MEASU:MEAS1:TYPE FREQ"}},
    {"type": "scpi_query", "params": {"command": "MEASU:MEAS1:VAL?", "saveAs": "freq"}},
    {"type": "disconnect", "params": {}}
  ]
}
```

## Supported Features
- ✅ All SCPI commands
- ✅ Measurements (MEASU:)
- ✅ Search (SEARCH:)
- ✅ Histogram (HISTOGRAM:)
- ✅ Channel configuration
- ✅ Trigger setup
```

**tekhsi_guide.md**
```markdown
# TekHSI Backend Guide

## When to Use
- ⚠️ **ONLY for high-speed waveform data capture**
- FastFrame acquisition
- FastAcq mode
- Bulk waveform transfer
- Data-intensive applications

## When NOT to Use
- ❌ Measurements
- ❌ Search operations
- ❌ Histogram analysis
- ❌ General SCPI configuration
- ❌ Results table access

## Example: FastFrame 50 Frames
```json
{
  "name": "FastFrame 50 Frames",
  "backend": "tekhsi",
  "steps": [
    {"type": "connect", "params": {}},
    {"type": "python", "params": {
      "code": "# FastFrame setup\nscope.horizontal.fastframe.state = True\nscope.horizontal.fastframe.count = 50\n\n# Acquire frames\nfor i in range(50):\n    with scope.access_data():\n        waveform = scope.get_data('CH1')\n        # Process waveform..."
    }},
    {"type": "disconnect", "params": {}}
  ]
}
```

## Key Points
- Uses Python steps with TekHSI API
- Direct binary waveform access
- No SCPI command strings
- Optimized for speed
```

**tm_devices_guide.md**
```markdown
# tm_devices Backend Guide

## When to Use
- Modern scopes (MSO6B, MSO5, etc.)
- Want Python API instead of SCPI strings
- Need type safety and auto-completion

## ⚠️ Current Limitations in TekAutomate
Some tm_devices features are not yet fully implemented:
- Advanced measurements
- Complex triggering
- Some data export formats

For these, use PyVISA backend instead.

## Example: Basic Capture
```json
{
  "name": "tm_devices Capture",
  "backend": "tm_devices",
  "deviceDriver": "MSO6B",
  "steps": [
    {"type": "connect", "params": {}},
    {"type": "scpi_write", "params": {
      "command": "scope.commands.ch[1].scale.write(1.0)"
    }},
    {"type": "disconnect", "params": {}}
  ]
}
```
```

---

### 2. Feature-Specific Guides

**fastframe_complete_example.md**
```markdown
# FastFrame Complete Workflow Example

## Scenario
Capture 50 FastFrame frames, then use SCPI to:
- Open Search 1 results table
- Open Search 2 results table  
- Check for hits over 400

## Backend Choice
- **Data Capture**: TekHSI (for FastFrame waveforms)
- **Search/Analysis**: PyVISA (for SCPI search commands)

## ⚠️ Important
You CANNOT mix TekHSI waveform capture with SCPI search commands in the same workflow.

## Solution: Two-Workflow Approach

### Workflow 1: FastFrame Capture (TekHSI)
```json
{
  "name": "FastFrame 50 Frames",
  "backend": "tekhsi",
  "steps": [...]
}
```

### Workflow 2: Search Analysis (PyVISA)
```json
{
  "name": "Search Results Analysis",
  "backend": "pyvisa",
  "steps": [
    {"type": "connect", "params": {}},
    {"type": "scpi_write", "params": {"command": "SEARCH:SEARCH1:STATE ON"}},
    {"type": "scpi_write", "params": {"command": "SEARCH:SEARCH1:RESULTSTABLE:STATE ON"}},
    {"type": "scpi_write", "params": {"command": "SEARCH:SEARCH2:STATE ON"}},
    {"type": "scpi_write", "params": {"command": "SEARCH:SEARCH2:RESULTSTABLE:STATE ON"}},
    {"type": "scpi_query", "params": {
      "command": "SEARCH:SEARCH1:TOTAL?",
      "saveAs": "search1_hits"
    }},
    {"type": "python", "params": {
      "code": "if int(search1_hits) > 400:\n    print('Search 1 has over 400 hits!')"
    }},
    {"type": "disconnect", "params": {}}
  ]
}
```

## Alternative: All PyVISA (Simpler)
If you don't need TekHSI's speed, use PyVISA for everything:
```json
{
  "name": "FastFrame + Search (PyVISA)",
  "backend": "pyvisa",
  "steps": [
    {"type": "connect", "params": {}},
    // Setup FastFrame via SCPI
    {"type": "scpi_write", "params": {"command": "HOR:FASTFRAME:STATE ON"}},
    {"type": "scpi_write", "params": {"command": "HOR:FASTFRAME:COUNT 50"}},
    // Setup searches
    {"type": "scpi_write", "params": {"command": "SEARCH:SEARCH1:STATE ON"}},
    // ... rest of workflow
  ]
}
```
```

**measurement_search_histogram.md**
```markdown
# Measurements, Search, and Histogram Guide

## Backend Requirement
⚠️ **MUST use PyVISA backend** - TekHSI does not support these features

## Opening Results Tables
```json
// Search 1 results table
{"type": "scpi_write", "params": {"command": "SEARCH:SEARCH1:RESULTSTABLE:STATE ON"}}

// Search 2 results table
{"type": "scpi_write", "params": {"command": "SEARCH:SEARCH2:RESULTSTABLE:STATE ON"}}

// Histogram results
{"type": "scpi_write", "params": {"command": "HISTOGRAM:HISTOGRAM1:RESULTSTABLE:STATE ON"}}
```

## Checking Hit Counts
```json
// Query search hits
{"type": "scpi_query", "params": {
  "command": "SEARCH:SEARCH1:TOTAL?",
  "saveAs": "search1_hits"
}}

// Check threshold in Python step
{"type": "python", "params": {
  "code": "if int(search1_hits) > 400:\n    print(f'Warning: {search1_hits} hits found (threshold: 400)')"
}}
```
```

---

### 3. Common Mistakes Guide

**common_mistakes.md**
```markdown
# Common Workflow Mistakes

## 1. Using TekHSI for Non-Waveform Operations
❌ **Wrong:**
```json
{
  "backend": "tekhsi",
  "steps": [
    {"type": "scpi_write", "params": {"command": "MEASU:MEAS1:TYPE FREQ"}}
  ]
}
```

✅ **Correct:**
```json
{
  "backend": "pyvisa",
  "steps": [
    {"type": "scpi_write", "params": {"command": "MEASU:MEAS1:TYPE FREQ"}}
  ]
}
```

## 2. Missing Connect/Disconnect
❌ **Wrong:** No connect step
✅ **Correct:** Always start with connect, end with disconnect

## 3. Using Deprecated Step Types
❌ **Wrong:** `{"type": "sweep"}`
✅ **Correct:** `{"type": "python"}` with loop

## 4. Query Without saveAs
❌ **Wrong:** `{"type": "scpi_query", "params": {"command": "*IDN?"}}`
✅ **Correct:** Add `"saveAs": "idn"` to params
```

---

### 4. Real-World Examples

**workflow_library.md**
```markdown
# Tested Workflow Library

## 1. Basic Waveform Capture
**Backend**: PyVISA
**Tested**: MSO6B, MSO5, DPO7000
[Include full JSON]

## 2. FastFrame 100 Frames
**Backend**: TekHSI
**Tested**: MSO6B
[Include full JSON]

## 3. Multi-Search Analysis
**Backend**: PyVISA
**Tested**: MSO6B
[Include full JSON]

## 4. Voltage Sweep with SMU
**Backend**: PyVISA
**Tested**: MSO6B + Keithley 2400
[Include full JSON]
```

---

## 📤 How to Upload to GPT

### Step 1: Organize Files
```
TekAcademy/
├── backend_guides/
│   ├── pyvisa_guide.md
│   ├── tekhsi_guide.md
│   └── tm_devices_guide.md
├── feature_guides/
│   ├── fastframe_complete_example.md
│   ├── measurement_search_histogram.md
│   └── triggering_guide.md
├── common_mistakes.md
└── workflow_library.md
```

### Step 2: Upload to GPT
1. Open ChatGPT → Create Custom GPT
2. Go to "Configure" tab
3. Scroll to "Knowledge" section
4. Click "Upload files"
5. Select ALL markdown files from TekAcademy folder
6. GPT will process and index them

### Step 3: Test
Ask the GPT:
- "Create a FastFrame workflow with 50 frames and search analysis"
- Should now correctly suggest TWO workflows or PyVISA approach
- Should NOT suggest using TekHSI for search commands

---

## 📝 File Format Guidelines

### Use Clear Headers
```markdown
# Main Topic

## When to Use
[Clear criteria]

## When NOT to Use
[Clear restrictions]

## Example
[Complete, tested example]
```

### Include Code Blocks
Use proper JSON formatting:
```json
{
  "name": "Example",
  "backend": "pyvisa",
  "steps": [...]
}
```

### Add Warnings
Use emoji for visibility:
- ⚠️ for warnings
- ❌ for "don't do this"
- ✅ for "do this instead"

---

## 🎯 Expected Outcome

After uploading TekAcademy:

**Before:**
```
User: "Create FastFrame 50 frames with search analysis"
GPT: "Which backend: tm_devices or tekhsi?"
```

**After:**
```
User: "Create FastFrame 50 frames with search analysis"
GPT: "I recommend PyVISA backend for this workflow because:
- Search operations require SCPI commands
- TekHSI is for waveform capture only
- PyVISA can handle both FastFrame setup and search

Here's the complete workflow..."
```

---

## 💡 Pro Tips

1. **Be Specific**: Include exact SCPI commands that work
2. **Show Tested Examples**: Only include verified workflows
3. **Explain Limitations**: Make backend restrictions crystal clear
4. **Provide Alternatives**: Show multiple approaches
5. **Update Regularly**: As TekAutomate adds features, update docs

---

Last Updated: 2026-01-24
