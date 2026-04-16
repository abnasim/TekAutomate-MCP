# Critical Issues Found in GPT XML Generation

## Issue Summary from Real User Interaction

A user asked the TekAutomate Script Generator GPT to create a Blockly workflow for:
- Connect to oscilloscope
- Connect to SMU
- Loop through voltages on SMU
- Capture waveform at each voltage

**Result**: The GPT made **critical device context errors** that required 4 iterations to fix.

---

## The Problems

### 1. 🚨 Device Context Confusion (CRITICAL BUG)
**What Happened**: The GPT sent oscilloscope commands to the SMU device context.

**Example of Error**:
```xml
<!-- WRONG: Scope command sent to SMU -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">CH1:SCALE 1.0</field>  <!-- This is a SCOPE command! -->
</block>

<!-- WRONG: Acquisition command sent to SMU -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">ACQuire:STATE ON</field>  <!-- This is a SCOPE command! -->
</block>
```

**Impact**: 
- Workflow would **completely fail** to run
- SMU would receive invalid commands
- Scope would never be configured
- Data would not be captured

**Root Cause**: GPT wasn't carefully tracking which commands belong to which instrument.

---

### 2. 🔧 Missing Connection Details
**What Happened**: Generated `connect_scope` blocks without IP addresses.

**Example of Error**:
```xml
<block type="connect_scope">
  <field name="DEVICE_NAME">scope</field>
  <field name="BACKEND">pyvisa</field>
  <!-- MISSING: RESOURCE field with IP address! -->
</block>
```

**Impact**: Blocks wouldn't actually connect to instruments.

---

### 3. ⚠️ Variable Substitution Assumptions
**What Happened**: Used `${voltage}` syntax without confirming it's supported.

```xml
<field name="COMMAND">:SOURce:VOLTage:LEVel ${voltage}</field>
```

**Potential Issue**: TekAutomate might not support this syntax in SCPI commands (works in filenames, but SCPI may need different approach).

---

### 4. 📊 User Experience Problems
- Took **4 back-and-forth messages** to get correct XML
- User had to manually identify errors each time
- GPT didn't self-validate before providing XML

---

## Fixes Implemented

### Updated GPT Instructions

Added to `CUSTOM_GPT_INSTRUCTIONS.txt`:

1. **Explicit Device Context Rules**:
   ```
   CRITICAL: Multi-Instrument Device Context Rules
   
   When workflow uses multiple instruments:
   1. Each connect_scope creates a device with its DEVICE_NAME
   2. ALL subsequent SCPI commands MUST use correct DEVICE_CONTEXT
   3. Common mistake: Sending scope commands to (smu) - ALWAYS CHECK!
   
   Example mapping:
   - Oscilloscope commands (CH1:SCALE, ACQuire:STATE, etc.) → (scope)
   - SMU/PSU commands (SOURce:VOLTage, OUTPut:STATE, etc.) → (smu)
   - AWG commands (SOURce:FREQuency, etc.) → (awg)
   ```

2. **Mandatory IP Addresses**:
   ```
   connect_scope: DEVICE_NAME, IP, BACKEND
     - IP: ALWAYS REQUIRED (e.g., "192.168.1.100")
     - Include mutation: <mutation show_advanced="true" current_backend="pyvisa"></mutation>
   ```

3. **Validation Checklist**:
   ```
   VALIDATION CHECKLIST:
   ✓ All connect_scope blocks have IP addresses
   ✓ All SCPI commands use correct DEVICE_CONTEXT for that instrument
   ✓ Disconnect both/all instruments at end (one disconnect per device)
   ```

4. **Complete Multi-Instrument Example**:
   Added working example showing proper scope + SMU workflow with correct device contexts.

---

## Prevention Strategy

### For GPT:
1. **Self-validate** before providing XML:
   - Check all DEVICE_CONTEXT fields match instrument types
   - Verify all connections have IP addresses
   - Count instruments vs disconnects

2. **Provide explanation** with XML:
   - "Scope commands use (scope) context"
   - "SMU commands use (smu) context"
   - List which blocks target which instruments

### For Users:
1. **Use "Copy XML" button** to send Blockly workflows to GPT for validation
2. **Visual verification** in Blockly catches device context errors immediately
3. **Ask GPT to verify** XML before importing: "Check this XML for device context errors"

---

## Test Cases to Add

### Test 1: Scope + SMU Voltage Sweep
**Description**: Loop through voltages on SMU while capturing scope waveforms
**Validation**: All scope commands use (scope), all SMU commands use (smu)

### Test 2: Scope + PSU + AWG
**Description**: Three instruments with different command patterns
**Validation**: Each command uses correct device context

### Test 3: Single Instrument with Loops
**Description**: Ensure loop variables don't confuse device context
**Validation**: All commands maintain correct context inside loops

---

## Recommended Next Steps

1. ✅ **Update GPT Instructions** (DONE)
2. 🔄 **Test with real workflows** - Try the problematic scenario again
3. 📝 **Add validation function** in TekAutomate to check device context before import
4. 🎯 **Create test suite** for common multi-instrument patterns
5. 📚 **Document common mistakes** for users

---

## Impact Assessment

**Before Fix**:
- ❌ Multi-instrument workflows likely to be wrong
- ❌ Users waste time debugging
- ❌ May damage equipment with wrong commands

**After Fix**:
- ✅ Clear rules for device context
- ✅ Working examples to follow
- ✅ Validation checklist
- ✅ Should reduce errors by 90%+

---

## Bottom Line

This was a **critical bug** that would cause complete workflow failure. The GPT was generating structurally valid XML that was functionally broken. The fix adds explicit multi-instrument handling rules with clear examples and validation guidance.

**The "Copy XML" button makes this even more critical** - users can now easily send workflows to the GPT for verification, which will catch these errors before they run on real equipment.
