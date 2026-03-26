# KNOWN_BUGS_AND_FIXES.md — TekAutomate Regression Matrix & Institutional Knowledge

> Every documented bug, root cause, fix, and lesson learned. Pure RAG gold for the AI assistant.
>
> **Last updated:** 2026-03-10

---

## Bug Index

| # | Severity | Category | Title | Status |
|---|----------|----------|-------|--------|
| 1 | CRITICAL | Screenshot | UnicodeDecodeError after `FILESYSTEM:READFILE` | ✅ Fixed |
| 2 | CRITICAL | Generator | Variable name corruption (Blockly ID vs name) | ✅ Fixed |
| 3 | CRITICAL | Generator | Float loop with `range()` — invalid Python | ✅ Fixed |
| 4 | CRITICAL | Generator | Device context lost inside loops | ✅ Fixed |
| 5 | CRITICAL | Converter | Sweep parameters mismatch (Blockly→Steps) | ✅ Fixed |
| 6 | HIGH | Roundtrip | `set_and_query` degradation (4975 commands at risk) | ✅ Fixed |
| 7 | HIGH | Generator | Literal `\n` in `python_code` blocks (fixed twice) | ✅ Fixed |
| 8 | HIGH | Template | `HARDCOPY:FORMAT ${format}` literal output | ✅ Fixed |
| 9 | HIGH | Generator | OPC query return type (`int` vs string) | ✅ Fixed |
| 10 | HIGH | Generator | Variables initialized to `None` | ✅ Fixed |
| 11 | HIGH | Generator | Missing cleanup section (asymmetric device close) | ✅ Fixed |
| 12 | HIGH | Generator | Verbose OPC polling pattern for tm_devices | ✅ Fixed |
| 13 | HIGH | Generator | Type hints default to `MSO6B` when unspecified | ✅ Fixed |
| 14 | HIGH | Generator | `acquire.stopafter` enum casing (`SEQUENCE` vs `SEQuence`) | ✅ Fixed |
| 15 | MEDIUM | GPT | Device context confusion (scope commands → SMU) | ⚠️ Mitigated |
| 16 | MEDIUM | GPT | Missing connection details in generated XML | ⚠️ Mitigated |
| 17 | MEDIUM | GPT | Wrong block types / missing mutations | ⚠️ Mitigated |
| 18 | MEDIUM | Converter | Loop index unavailable in `repeat N times` | ✅ Fixed |
| 19 | MEDIUM | Converter | File overwriting — same filename every iteration | ✅ Fixed |
| 20 | MEDIUM | UX | Comment block confused with executable code | 📝 Documented |
| 21 | MEDIUM | UI | Backend dropdown not restored on XML import | ✅ Fixed |
| 22 | MEDIUM | UI | Connection block color doesn't reflect backend | ✅ Fixed |
| 23 | LOW | Environment | `setup.bat` stops after Node.js detection | ✅ Fixed |
| 24 | LOW | Environment | ZIP missing nested files (commands/templates) | ✅ Fixed |
| 25 | LOW | Environment | Blockly API deprecation warnings (v12→v13) | ⚠️ Known |
| 26 | MEDIUM | Generator | OPC deduplication (single_acquisition + wait_for_opc) | ✅ Fixed |
| 27 | MEDIUM | Generator | Command-to-device validation missing | ✅ Fixed |
| 28 | LOW | Environment | `tm_devices_docstrings.json` fails to load | ⚠️ Known |

---

## Detailed Bug Reports

---

### BUG-001: UnicodeDecodeError on Screenshot Capture

**Severity:** CRITICAL  
**Category:** Screenshot / Binary Transfer  
**Date Fixed:** 2026-01-28  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts` lines 1213–1230, 1262–1283; `public/templates/basic.json`

**Symptom:**
```
UnicodeDecodeError: 'ascii' codec can't decode byte 0xe5 in position 2
```

**When:** After calling `scope.query('*OPC?')` following `FILESYSTEM:READFILE`.

**Root Cause:**  
The sequence was:
1. `scope.write('FILESYSTEM:READFILE "..."')` — sends command
2. `scope.read_raw()` — reads the PNG binary data ✅
3. `scope.write('FILESYSTEM:DELETE "..."')` — sends delete command
4. `scope.query('*OPC?')` — **tries to read `'1'` but gets leftover PNG data** ❌

PNG file data (binary bytes like `0xe5`) was being interpreted as ASCII text. `*OPC?` is a **query** — it sends a command then **reads** the response. After a binary file transfer, the communication buffer can have residual binary data or timing issues, so the query reads garbage instead of `"1"`.

**Code Before (BROKEN):**
```python
scope.write('HARDCOPY START')
scope.query('*OPC?')  # ❌ Tries to read response
time.sleep(0.5)
# ... file transfer ...
scope.write('FILESYSTEM:DELETE "..."')
scope.query('*OPC?')  # ❌ Reads leftover binary data = UnicodeDecodeError!
```

**Code After (FIXED):**
```python
scope.write('HARDCOPY START')
time.sleep(1.0)  # ✅ Just wait, don't read
# ... file transfer ...
scope.write('FILESYSTEM:DELETE "..."')
# ✅ No query after file operations — no error!
```

**Generator Change (pythonGenerators.ts lines 1262–1283, Legacy):**
```typescript
// BEFORE:
code += `${device}.query('*OPC?')  # Wait for hardcopy to complete\n`;
code += `time.sleep(0.5)  # Extra wait for file write\n`;
// ... file transfer ...
code += `${device}.query('*OPC?')\n`;

// AFTER:
code += `time.sleep(1.0)  # Wait for hardcopy to complete and file write\n`;
// ... file transfer ...
// (removed second OPC)
```

**Generator Change (pythonGenerators.ts lines 1213–1230, Modern):**
```typescript
// BEFORE:
code += `${device}.query('*OPC?')  # Wait for save to complete\n`;
// ... file transfer ...
code += `${device}.query('*OPC?')\n`;

// AFTER:
code += `time.sleep(1.0)  # Wait for save to complete\n`;
// ... file transfer ...
// (removed second OPC)
```

**Lesson:**  
Never use `*OPC?` after binary file operations (`FILESYSTEM:READFILE`, `HARDCOPY START`). Use `time.sleep()` instead. `*OPC?` is a query that reads from the buffer — after binary transfer, the buffer state is unpredictable.

---

### BUG-002: Variable Name Corruption (Blockly ID vs Name)

**Severity:** CRITICAL  
**Category:** Generator / Converter  
**Date Fixed:** 2026-01-21  
**Files Changed:** `src/components/BlocklyBuilder/converters/blockToStep.ts` (3 locations)

**Symptom:**  
Exported Steps UI code contained corrupted variable names:
```python
# BAD — Steps UI generated this:
N%hHHhp:Bg=T0!BWtnrB = 0
while N%hHHhp:Bg=T0!BWtnrB <= 4:
    o(s_~?vBNu5x*!/I9Y1! = (1 + (N%hHHhp:Bg=T0!BWtnrB * 0.5))
```

Should have been:
```python
# GOOD:
i = 0
while i <= 4:
    voltage = (1 + (i * 0.5))
```

**Root Cause:**  
Blockly stores variables with a unique **ID** (e.g., `N%hHHhp:Bg=T0!BWtnrB`) and a human-readable **name** (e.g., `i`). The converter was calling `block.getFieldValue('VAR')` which returns the **ID**, not the name.

**Code Before (BROKEN):**
```typescript
const varName = block.getFieldValue('VAR');  // Returns ID like "N%hHHhp:Bg=T0!BWtnrB"
```

**Code After (FIXED):**
```typescript
const varId = block.getFieldValue('VAR');
const varModel = block.workspace.getVariableById(varId);
const varName = varModel ? varModel.getName() : 'i';  // Returns "i"
```

**Three locations fixed in `blockToStep.ts`:**

1. **`controls_for` block** (~line 183):
   ```typescript
   const varId = block.getFieldValue('VAR') || 'i';
   const varModel = block.workspace.getVariableById(varId);
   const varName = varModel ? varModel.getName() : 'i';
   ```

2. **`variables_set` block** (~line 235):
   ```typescript
   const varId = block.getFieldValue('VAR');
   const varModel = block.workspace.getVariableById(varId);
   const varName = varModel ? varModel.getName() : 'var';
   ```

3. **`convertExpressionToPython` helper** (~line 277):
   ```typescript
   case 'variables_get': {
     const varId = block.getFieldValue('VAR');
     const varModel = block.workspace.getVariableById(varId);
     return varModel ? varModel.getName() : 'var';
   }
   ```

**Lesson:**  
Blockly `getFieldValue('VAR')` returns the internal ID, never the name. Always resolve through `workspace.getVariableById(id).getName()`.

---

### BUG-003: Float Loop with `range()` — Invalid Python

**Severity:** CRITICAL  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
Generator produced `for v in range(0.5, 2.5, 0.5):` which is invalid Python — `range()` only accepts integers.

**Root Cause:**  
The `controls_for` generator always used `range()` regardless of whether the start/stop/step values were floats.

**Code Before (BROKEN):**
```python
for v in range(0.5, 2.5, 0.5):  # TypeError: 'float' object cannot be interpreted as an integer
    ...
```

**Code After (FIXED):**
```python
v = 0.5
while v <= 2.5:
    # loop body
    v += 0.5
```

**Generator logic:**
```typescript
const needsFloatLoop = !Number.isInteger(fromValue) || !Number.isInteger(toValue) || !Number.isInteger(byValue);

if (needsFloatLoop) {
  // Generate while loop for floats
  loopCode = `${varName} = ${fromCode}\n`;
  loopCode += `while ${varName} <= ${toCode}:\n`;
  loopCode += branch;
  loopCode += `    ${varName} += ${byCode}\n`;
}
```

**Lesson:**  
Always check if loop parameters are floats. Python's `range()` is integer-only; use `while` loops for float iteration.

---

### BUG-004: Device Context Lost Inside Loops

**Severity:** CRITICAL  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
Measurement commands inside a `for` loop were sent to `smu` instead of `scope`, even when blocks had explicit `DEVICE_CONTEXT="(scope)"`.

**Root Cause:**  
The `getDeviceVariable()` function walked backwards through `getPreviousBlock()` to find device context. But blocks inside a loop's `<statement name="DO">` have **no previous blocks** — they're the first child of the loop body. The function fell through to `currentDeviceContext`, which happened to be `'smu'` (the last device set before the loop).

The explicit `DEVICE_CONTEXT` field was checked, but not with **absolute priority** — other fallback paths could override it.

**Code Before (BROKEN):**
```typescript
function getDeviceVariable(block: Blockly.Block): string {
  // Check previous blocks first...
  // Then check parent...
  // Then check DEVICE_CONTEXT field... (too late!)
  // Fallback to currentDeviceContext (wrong!)
}
```

**Code After (FIXED):**
```typescript
function getDeviceVariable(block: Blockly.Block): string {
  // FIRST AND MOST IMPORTANT: Check explicit DEVICE_CONTEXT field
  try {
    const deviceContext = block.getFieldValue('DEVICE_CONTEXT');
    if (deviceContext && 
        deviceContext.trim() !== '' && 
        deviceContext.trim() !== '(?)' && 
        deviceContext.trim() !== '()' &&
        !deviceContext.trim().startsWith('?')) {
      const cleanContext = deviceContext.replace(/[()]/g, '').trim();
      if (cleanContext && cleanContext.length > 0) {
        return cleanContext; // RETURN IMMEDIATELY — absolute priority
      }
    }
  } catch (e) {
    // Field doesn't exist, continue to fallback
  }
  
  // FALLBACK: Only if DEVICE_CONTEXT not present
  // Walk back through blocks, check parents, etc.
}
```

**Lesson:**  
Explicit block-level `DEVICE_CONTEXT` must have **absolute priority** over any inferred context. Blocks inside loop bodies cannot rely on `getPreviousBlock()` traversal.

---

### BUG-005: Sweep Parameters Mismatch (Blockly → Steps)

**Severity:** CRITICAL  
**Category:** Converter  
**Date Fixed:** 2026-01-21  
**Files Changed:** `src/components/BlocklyBuilder/converters/blockToStep.ts`

**Symptom:**  
Exporting Blockly workflows to Steps UI produced broken Python with undefined variables, wrong loop structures, no device connections, and generic device references instead of device-specific ones.

The Steps UI generated:
```python
while value <= 4:  # ❌ Wrong loop, undefined 'value'
    scope.write(...)  # ❌ Generic device reference
```

The Blockly direct export generated correctly:
```python
for i in range(5):  # ✅ Proper loop
    voltage = 1 + i * 0.5  # ✅ Variable calculation
    psu.write(f'VOLT {voltage}')  # ✅ Device-specific
```

**Root Cause:**  
The converter used `iterations` and `sweepType` params, but Steps UI expects `variableName`, `start`, `stop`, `step`, `saveResults`.

**Code Before (BROKEN):**
```typescript
// controls_repeat_ext / controls_repeat
params: {
  iterations,
  sweepType: 'repeat'
}

// controls_for
params: {
  iterations,
  sweepType: 'for',
  variable: varName,  // Wrong key name!
  start: fromValue,
  stop: toValue,
  step: byValue
}
```

**Code After (FIXED):**
```typescript
// controls_repeat_ext / controls_repeat
params: {
  variableName: 'i',
  start: 0,
  stop: iterations - 1,
  step: 1,
  saveResults: false
}

// controls_for
params: {
  variableName: varName,  // Correct key name
  start: fromValue,
  stop: toValue,
  step: byValue,
  saveResults: false
}
```

**How Steps UI generates sweep loops (from `App.tsx` lines 4466–4501):**
```python
# Sweep: variableName from start to stop step step
variableName = start
while variableName <= stop:
    # ... children commands ...
    variableName += step
```

**Lesson:**  
Converter output params must exactly match the consuming UI's expected schema. Key name differences (`variable` vs `variableName`) silently produce broken output.

---

### BUG-006: `set_and_query` Roundtrip Degradation (4975 Commands at Risk)

**Severity:** HIGH  
**Category:** Roundtrip / Converter  
**Date Fixed:** 2026-03-10  
**Files Changed:** `blockToStep.ts`, `stepToBlock.ts`, canary test added

**Symptom:**  
Commands with `set_and_query` semantics degraded to write-only after a Steps → Blockly → Steps roundtrip. The query half was silently dropped.

**Impact by instrument family:**

| Family | Total Commands | At-Risk |
|---|---:|---:|
| MSO_DPO_5k_7k_70K | 1,479 | 1,229 |
| mso_2_4_5_6_7 | 2,753 | 2,491 |
| rsa | 3,722 | 1,238 |
| tekexpress | 49 | 15 |
| afg | 65 | 2 |
| **Total at-risk** | | **4,975** |

**Root Cause:**  
- In `stepToBlock`, `set_and_query` was converted to `scpi_write`, dropping the query half.
- During Blockly → Steps export, the block conversion returned `write` type, not `set_and_query`.

**Fix:**
1. Preserve `set_and_query` metadata on imported `scpi_write` Blockly blocks.
2. Restore `set_and_query` type and params during Blockly → Steps export.
3. Generate write+query from Blockly when preserved metadata is present.
4. Added canary test: `e2e/set-and-query-canary.spec.ts`.

**Lesson:**  
Roundtrip conversions must preserve semantic metadata even when the intermediate representation doesn't natively support it. Canary tests should gate behaviors that affect thousands of commands.

---

### BUG-007: Literal `\n` in `python_code` Blocks (Fixed Twice)

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-21 (first fix), 2026-01-30 (second fix — reverted first fix)  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts` lines 1513–1518

**First Symptom (January 21):**  
`smu.source.function = "VOLT"\nsmu.output.enabled = True` — the `\n` was literal text in the generated Python, causing `SyntaxError`.

**First Fix:**
```typescript
// Convert literal \n to actual newlines
pythonCode = pythonCode.replace(/\\n/g, '\n');
```

**Second Symptom (January 30 — the first fix broke something else):**  
The `.replace(/\\n/g, '\n')` transformation now broke legitimate escape sequences in string literals:
```python
# BROKEN (after first fix):
f.write("Frame,Frequency_Hz,Vpp_V\n")  # \n was converted to actual newline!
# Became:
f.write("Frame,Frequency_Hz,Vpp_V
")  # SyntaxError — missing closing quote!
```

**Second Fix (reverted the first fix):**
```typescript
// REMOVED: pythonCode = pythonCode.replace(/\\n/g, '\n');
// \n now remains as an escape sequence in Python output — correct for string literals
```

**Lesson:**  
Don't blindly transform escape sequences in code strings. `\n` inside Python string literals is correct and must be preserved. The original "literal `\n`" issue was actually a Blockly input encoding problem, not a generator output problem.

---

### BUG-008: `HARDCOPY:FORMAT ${format}` Literal Output

**Severity:** HIGH  
**Category:** Template / Generator  
**Date Fixed:** 2026-01-28  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts` line 1264; `public/templates/basic.json`

**Symptom:**  
Generated Python contained the literal string `${format}` instead of the format value:
```python
scope.write('HARDCOPY:FORMAT ${format}')  # ❌ Literal ${format}
# Should be:
scope.write('HARDCOPY:FORMAT PNG')  # ✅ Actual value
```

**Root Cause:**  
The TypeScript code used a JavaScript template literal inside a Python string literal, but the `format` variable wasn't being interpolated because the surrounding string used single quotes (not backticks):
```typescript
// BROKEN:
code += `${device}.write('HARDCOPY:FORMAT ${format}')\n`;
// The ${device} is interpolated (backtick string), but ${format} inside single quotes is NOT
```

**Code After (FIXED):**
```typescript
code += `${device}.write('HARDCOPY:FORMAT ${format.toUpperCase()}')\n`;
```

**Template Fix:**  
Both Modern and Legacy templates in `public/templates/basic.json` were also updated from multi-step sequences to single `python` blocks containing complete, tested code.

**Lesson:**  
Be careful with nested template literal interpolation. When generating Python strings inside TypeScript backtick strings, ensure all `${}` expressions are at the TypeScript level, not embedded in Python string literals.

---

### BUG-009: OPC Query Return Type (`int` vs String)

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-21  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
`int()` conversion of OPC response sometimes failed because the response had trailing whitespace.

**Code Before (FRAGILE):**
```typescript
code += `if int(${device}.commands.opc.query()) == 1:\n`;
```
Generated Python:
```python
if int(scope.commands.opc.query()) == 1:  # Fails if response is "1\n"
```

**Code After (FIXED):**
```typescript
code += `if ${device}.commands.opc.query().strip() == "1":\n`;
```
Generated Python:
```python
if scope.commands.opc.query().strip() == "1":  # Handles "1", "1\n", " 1 "
```

**Lesson:**  
SCPI query responses often include trailing newlines or whitespace. Always `.strip()` before comparison. Prefer string comparison over `int()` conversion for `*OPC?` responses.

---

### BUG-010: Variables Initialized to `None`

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
Generated Python had unnecessary `None` initializations at the top:
```python
vpp = None
frame = None
hits = None
```

**Root Cause:**  
Blockly's default Python generator automatically initializes all variables declared in the `<variables>` XML section to `None`.

**Fix:**  
Overrode `variables_get` generator to prevent `None` initialization. Variables are now only assigned when explicitly set via `variables_set` blocks.

**Code After:**
```python
# No initialization — variables assigned when used:
vpp = float(scope.query(':MEASUREMENT:IMMED:VALUE?').strip())
```

**Lesson:**  
Blockly's default variable initialization behavior is meant for educational/visual programming. For production code generation, override the default to avoid unnecessary `None` assignments.

---

### BUG-011: Missing Cleanup Section (Asymmetric Device Close)

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`, `BlocklyBuilder.tsx`

**Symptom:**  
Only `scope` was being closed in cleanup, not `smu`. Or cleanup was missing entirely.

**Root Cause:**  
1. `disconnect` blocks were removing devices from the `connectedDevices` tracking array.
2. Cleanup code only closed devices still in the tracking array.
3. If a disconnect block appeared in the workflow, the device was removed from tracking before cleanup.

**Fix (two parts):**

1. **Disconnect blocks no longer remove from tracking:**
```typescript
pythonGenerator.forBlock['disconnect'] = function(block) {
  // Don't remove from connectedDevices — cleanup handles all
  return '';  // Generate nothing
};
```

2. **Cleanup always extracts device names from generated code:**
```typescript
// ALWAYS extract device names from generated code (most reliable)
const deviceNamesFromCode = new Set<string>();
if (usesTmDevicesForCleanup) {
  const addDevicePattern = /(\/w+)\s*=\s*device_manager\.add_(scope|smu|psu|dmm|afg|awg|device)\(/g;
  // ... extract all device names
} else {
  const openResourcePattern = /(\w+)\s*=\s*rm\.open_resource\(/g;
  // ... extract all device names
}
```

**Code After:**
```python
# Cleanup - close all devices
if 'scope' in locals():
    scope.close()
    print("Disconnected scope")
if 'smu' in locals():
    smu.close()
    print("Disconnected smu")
```

**Lesson:**  
Don't trust a mutable tracking array for cleanup. Parse the generated code itself to find all opened resources. Every opened device must have a corresponding close.

---

### BUG-012: Verbose OPC Polling Pattern for tm_devices

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
tm_devices backend generated an unnecessarily verbose OPC polling loop:
```python
start_time = time.time()
while time.time() - start_time < 30:
    if scope.query('*OPC?').strip() == '1':
        break
    time.sleep(0.1)
else:
    print("Warning: OPC timeout on scope")
```

**Root Cause:**  
Generator used the same polling pattern for all backends, even tm_devices which supports cleaner patterns.

**Code After (tm_devices):**
```python
# Wait for operation complete on scope
scope.write('*OPC?')
response = scope.read()
if response.strip() != '1':
    print("Warning: OPC did not return 1 on scope")
```

**Lesson:**  
Backend-specific code generation should produce idiomatic patterns for each backend, not one-size-fits-all.

---

### BUG-013: Type Hints Default to `MSO6B` When Unspecified

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
```python
scope: MSO6B = device_manager.add_scope("192.168.1.10")  # Type hint present even when not specified
```

**Root Cause:**  
Generator defaulted `DRIVER_NAME` to `'MSO6B'` when not explicitly set in XML.

**Fix:**  
Changed default from `'MSO6B'` to `''` (empty string). Type hints only added when `DRIVER_NAME` is explicitly provided.

**Code After:**
```python
# Without DRIVER_NAME in XML:
scope = device_manager.add_scope("192.168.1.10")

# With DRIVER_NAME="MSO6B" in XML:
scope: MSO6B = device_manager.add_scope("192.168.1.10")
```

**Lesson:**  
Defaults should be empty/absent, not assumed values. Let users explicitly opt into type hints.

---

### BUG-014: `acquire.stopafter` Enum Casing

**Severity:** HIGH  
**Category:** Generator  
**Date Fixed:** 2026-01-21  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
`scope.commands.acquire.stopafter.write("SEQUENCE")` — some tm_devices drivers rejected all-uppercase.

**Code Before:**
```typescript
code += `${device}.commands.acquire.stopafter.write("SEQUENCE")\n`;
```

**Code After:**
```typescript
code += `${device}.commands.acquire.stopafter.write("SEQuence")\n`;
```

**Lesson:**  
tm_devices drivers may enforce mixed-case SCPI mnemonics (the "short form" convention where capital letters are the abbreviated form). Use `SEQuence` not `SEQUENCE`.

---

### BUG-015: GPT Device Context Confusion

**Severity:** MEDIUM  
**Category:** GPT / Custom GPT  
**Date Mitigated:** 2026-01-24 (multiple instruction updates)  
**Files Changed:** `CUSTOM_GPT_INSTRUCTIONS.txt` (v6, 7,995/8,000 chars)

**Symptom:**  
The TekAutomate Script Generator GPT **consistently** generated XML with scope commands assigned to SMU context:
```xml
<!-- ❌ WRONG — Scope command with SMU context -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">CH1:SCAle 1.0</field>  <!-- This is a SCOPE command! -->
</block>

<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">ACQuire:STATE ON</field>  <!-- This is a SCOPE command! -->
</block>
```

Should be:
```xml
<!-- ✅ CORRECT -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(scope)</field>
  <field name="COMMAND">CH1:SCAle 1.0</field>
</block>
```

**Mitigation (GPT Instructions v6):**
Added explicit visual wrong/correct examples and command-prefix-to-device rules:
```
RULE: Command prefix determines context:
  CH1:|ACQuire:|MEASU:|DATa: → (scope)
  :SOURce:|:OUTPut:|:MEASure: → (smu)/(psu)

VALIDATE EVERY BLOCK before generating!
```

**Server-side mitigation:**  
Added `validateCommandDeviceMapping()` in the generator (see BUG-027) that catches and rejects these errors at generation time.

**Lesson:**  
GPTs cannot be fully trusted for multi-instrument context assignment. Server-side validation is mandatory. Fine-tuning or chain-of-thought prompting may be required for reliable multi-device XML generation.

---

### BUG-016: GPT Missing Connection Details

**Severity:** MEDIUM  
**Category:** GPT / Custom GPT  
**Date Mitigated:** 2026-01-24  
**Files Changed:** `CUSTOM_GPT_INSTRUCTIONS.txt`

**Symptom:**  
GPT-generated `connect_scope` blocks lacked IP addresses:
```xml
<block type="connect_scope">
  <field name="DEVICE_NAME">scope</field>
  <field name="BACKEND">pyvisa</field>
  <!-- MISSING: RESOURCE field with IP address! -->
</block>
```

**Mitigation:**  
Added mandatory IP address rule to GPT instructions:
```
connect_scope: DEVICE_NAME, IP, BACKEND
  - IP: ALWAYS REQUIRED (e.g., "192.168.1.100")
  - Include mutation: <mutation show_advanced="true" current_backend="pyvisa"></mutation>
```

---

### BUG-017: GPT Wrong Block Types / Missing Mutations

**Severity:** MEDIUM  
**Category:** GPT / Custom GPT  
**Date Mitigated:** 2026-01-25  
**Files Changed:** `CUSTOM_GPT_INSTRUCTIONS.txt`

**Symptom:**  
GPT-generated XML had `controls_for` blocks without the required mutation element:
```xml
<block type="controls_for" id="loop1">
  <field name="VAR">frame</field>
  <!-- MISSING: <mutation><variable>frame</variable></mutation> -->
```

**Impact:**  
Blockly may not properly track the loop variable. Variable scoping can break. Round-trip XML import/export is unstable.

**Mitigation:**  
Updated GPT instructions with explicit loop mutation requirement and working examples.

---

### BUG-018: Loop Index Unavailable in `repeat N times`

**Severity:** MEDIUM  
**Category:** Converter / UX  
**Date Fixed:** 2026-01-21  
**Files Changed:** Example XML files

**Symptom:**  
Using `repeat N times` block produced a loop without an index variable:
```python
for _ in range(5):
    psu.write('VOLT 1.0')  # Always 1.0! Can't sweep.
```

**Fix:**  
Guided users to use Blockly's built-in `controls_for` block which provides a named index:
```python
for i in range(5):
    voltage = 1.0 + (i * 0.5)
    psu.write(f'VOLT {voltage}')  # 1.0, 1.5, 2.0, 2.5, 3.0
```

Updated example XML files (`example_scope_psu_sweep.xml`) to use `controls_for` with `variables_set` blocks for calculations.

---

### BUG-019: File Overwriting — Same Filename Every Iteration

**Severity:** MEDIUM  
**Category:** Converter / UX  
**Date Fixed:** 2026-01-21  
**Files Changed:** Example XML files

**Symptom:**  
```python
for i in range(5):
    scope.write('SAVE:WAVEFORM CH1, "C:/Captures/capture.wfm"')  # Overwrites!
```

**Fix:**  
Example XML updated to use f-strings with loop index:
```python
for i in range(5):
    scope.write(f'SAVE:WAVEFORM CH1, "C:/Captures/capture_{i}.wfm"')  # Unique!
```

---

### BUG-020: Comment Block Confused with Executable Code

**Severity:** MEDIUM  
**Category:** UX / Documentation  
**Status:** 📝 Documented (not a code bug)

**Symptom:**  
User added a comment block saying `"Set PSU voltage (START_VOLTAGE + i * VOLTAGE_STEP)"` thinking it would calculate the voltage. It's just a comment — does nothing.

**Resolution:**  
Documented that comment blocks are non-executable. Users must use `python_code` blocks or `variables_set` blocks for calculations.

---

### BUG-021: Backend Dropdown Not Restored on XML Import

**Severity:** MEDIUM  
**Category:** UI  
**Date Fixed:** 2026-01-30  
**Files Changed:** `src/components/BlocklyBuilder/blocks/connectionBlocks.ts` lines 301–330, 348–365

**Symptom:**  
When importing XML with `tm_devices` backend, the mutation saved the backend internally but didn't update the dropdown field. The UI displayed "pyvisa" while the block was internally set to "tm_devices".

**Fix:**  
Added field value updates in both `domToMutation` and `loadExtraState`:
```typescript
setTimeout(() => {
  try {
    if (this.getField('BACKEND')) {
      this.setFieldValue(this.currentBackend_, 'BACKEND');
    }
  } catch (e) {
    console.warn('Could not restore backend field value:', e);
  }
}, 10);
```

**Lesson:**  
Blockly mutations load before fields are rendered. Use `setTimeout` to update field values after the rendering cycle completes.

---

### BUG-022: Connection Block Color Doesn't Reflect Backend

**Severity:** MEDIUM  
**Category:** UI  
**Date Fixed:** 2026-01-30  
**Files Changed:** `src/components/BlocklyBuilder/blocks/connectionBlocks.ts` lines 50–81

**Symptom:**  
All connection blocks were green (hue 120) regardless of backend. tm_devices blocks were visually indistinguishable from PyVISA blocks.

**Fix:**  
Added `updateColorForBackend_()` function with dynamic colors:
- **PyVISA:** Green (120)
- **tm_devices:** Purple (270)
- **TekHSI:** Orange (30)
- **Hybrid:** Yellow (60)
- **VXI-11:** Teal (180)

Colors update on dropdown change, XML import, and state load.

---

### BUG-023: `setup.bat` Stops After Node.js Detection

**Severity:** LOW  
**Category:** Environment / Setup  
**Date Fixed:** 2026-01-30  
**Files Changed:** `setup.bat`

**Symptom:**  
```
[2/4] Checking Node.js installation...
   ✓ Node.js found!
   Node.js version: v24.11.1
   npm version: 11.6.2
[Script stops here — never reaches step 3]
```

**Root Cause:**  
Version commands set an error level that stopped the script. The script used `%ERRORLEVEL%` variable (can be stale) instead of `errorlevel` checks.

**Fix:**
- Changed from `%ERRORLEVEL%` to `if errorlevel` checks
- Redirected stderr to prevent error messages from stopping the script
- Added explicit `goto :install_deps` jumps
- Captured npm exit codes in separate variables

---

### BUG-024: ZIP Missing Nested Files

**Severity:** LOW  
**Category:** Environment / Distribution  
**Date Fixed:** 2026-01-30  
**Files Changed:** `scripts/CREATE_DISTRIBUTION.bat`, new `scripts/VERIFY_ZIP.bat`

**Symptom:**  
After extracting the distribution ZIP, `public/commands/` or `public/templates/` folders were empty.

**Fix:**  
Updated distribution script to properly include nested files. Added verification script:
```batch
scripts\VERIFY_ZIP.bat
```

Expected output:
```
public/commands/: 17 files
public/templates/: 6 files
helper (raw socket utils): 3 files
```

---

### BUG-025: Blockly API Deprecation Warnings

**Severity:** LOW  
**Category:** Environment / Dependencies  
**Status:** ⚠️ Known — will break in Blockly v13

**Symptom:**
```
Blockly.Workspace.getVariableById was deprecated in v12 and will be deleted in v13.
Use Blockly.Workspace.getVariableMap().getVariableById instead.
```

**Impact:** All variable access calls (including BUG-002 fix) will break when Blockly is upgraded to v13.

**Fix needed:**  
Update all `workspace.getVariableById(id)` calls to `workspace.getVariableMap().getVariableById(id)`.

---

### BUG-026: OPC Deduplication (single_acquisition + wait_for_opc)

**Severity:** MEDIUM  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
`single_acquisition` and `wait_for_opc` blocks generated redundant, separate command sequences instead of combining them.

**Fix:**  
- `single_acquisition` detects if next block is `wait_for_opc` and defers
- `wait_for_opc` detects preceding `single_acquisition` and generates combined output

**Code After:**
```python
# Single acquisition and wait for completion on scope
scope.write('ACQUIRE:STOPAFTER SEQUENCE')
scope.write('ACQUIRE:STATE ON;*OPC?')
scope.read()  # Block until acquisition complete
```

---

### BUG-027: Command-to-Device Validation Missing

**Severity:** MEDIUM  
**Category:** Generator  
**Date Fixed:** 2026-01-25  
**Files Changed:** `src/components/BlocklyBuilder/generators/pythonGenerators.ts`

**Symptom:**  
Generator silently allowed semantically incorrect commands (e.g., sending scope commands to SMU) without any error.

**Fix:**  
Added `validateCommandDeviceMapping()` function:
```typescript
function validateCommandDeviceMapping(command: string, device: string, blockType: string): void {
  const scopeOnlyPatterns = [
    ':MEASUREMENT:', ':CH1:', ':CH2:', ':CH3:', ':CH4:',
    ':ACQUIRE:', ':HORIZONTAL:', ':TRIGGER:', ':SEARCH:', ':WAVEFORM:'
  ];
  
  const isScopeCommand = scopeOnlyPatterns.some(pattern => commandUpper.includes(pattern));
  if (isScopeCommand && deviceType !== 'SCOPE' && !deviceLower.includes('scope')) {
    throw new Error(`COMMAND-TO-DEVICE MAPPING ERROR\n\n` +
      `Command "${command}" is a scope-specific command, but target device is "${device}"`);
  }
  // ... similar check for SMU/PSU commands
}
```

The generator now **fails fast** with a clear error message if XML has wrong device context.

---

### BUG-028: `tm_devices_docstrings.json` Fails to Load

**Severity:** LOW  
**Category:** Environment  
**Status:** ⚠️ Known

**Symptom:**
```
Error loading tm_devices_docstrings.json: TypeError: Failed to fetch
```

**Impact:** Missing docstring hints for tm_devices blocks in Blockly editor. Non-blocking.

---

## Pattern Categories

### Binary Transfer Pitfalls

| Pattern | Why It Fails | Correct Approach |
|---------|-------------|------------------|
| `*OPC?` after `READFILE` | Buffer contains binary PNG, not `"1"` | Use `time.sleep()` instead |
| `FILESYSTEM:READFILE` via VISA | No length header, no terminator, no EOF | Raw TCP socket with timeout-based EOF |
| `HARDCOPY:DATA?` via SOCKET | Not supported on socket transport | Use VISA INSTR (VXI-11/HiSLIP) only |
| Missing pipeline priming | READFile silently returns nothing | Query `SAVE:IMAGe:*?` and `FILESystem:CWD?` first |
| PNG header misalignment | Socket may prepend stray ASCII | Scan for `\x89PNG\r\n\x1a\n` magic and realign |

**Critical insight from socket daemon reverse-engineering:**

> `FILESYSTEM:READFILE` is a **command** (not a query) that produces unframed binary output. It omits IEEE 488.2 block headers and is terminated only by EOI. VISA-based APIs cannot reliably consume this output. Raw TCP socket access with timeout-based EOF detection is required.

**Pipeline priming queries (must precede any `READFILE` on raw socket):**
```python
# These are NOT informational — they initialize the UI image subsystem
test_queries = [
    "SAVE:IMAGe:FILEFormat?",
    "SAVE:IMAGe:COMPosition?",
    "SAVE:IMAGe:VIEWTYpe?",
    "SAVE:IMAGe:INKSaver?",
    "SAVE:IMAGe:LAYout?",
    "FILESystem:CWD?",
]
for cmd in test_queries:
    send("*CLS")
    query(cmd)
    check_error()
```

**Hard reset pattern (`*CLS` between every step):**
```python
*CLS → query → *CLS → query
```
Forces status clear → event queue clear → UI handler reset. Keeps responses aligned and prevents binary contamination.

**Transport selection matrix (for AI agents):**

| Operation | Required Transport | Reason |
|-----------|-------------------|--------|
| Config, measurements, queries | PyVISA | Message-based |
| Screenshot (HARDCOPY:DATA?) | PyVISA INSTR only | Definite-length block |
| Screenshot (SAVE:IMAGE) | Raw socket | File-based |
| File transfer (READFILE) | Raw socket | Stream-based |
| Large waveform files | Raw socket (preferred) | Stream ambiguity |

### Code Generation Pitfalls

| Pattern | Bug # | What Goes Wrong |
|---------|-------|-----------------|
| Float in `range()` | 3 | `TypeError` — range is int-only |
| `None` initialization | 10 | Unnecessary, clutters output |
| Device context in loops | 4 | Block has no `previousBlock` in loop body |
| Literal escape sequences | 7 | `\n` in strings must not be transformed |
| `int()` on OPC response | 9 | Trailing whitespace causes ValueError |
| Default type hints | 13 | Assumes MSO6B when unspecified |
| Enum casing | 14 | `SEQUENCE` vs `SEQuence` |
| Asymmetric cleanup | 11 | Not all devices closed |
| Redundant OPC | 12, 26 | Verbose polling or duplicate patterns |

### Conversion / Roundtrip Pitfalls

| Pattern | Bug # | What Goes Wrong |
|---------|-------|-----------------|
| `set_and_query` → `scpi_write` | 6 | Query half silently dropped (4975 commands) |
| Wrong param key names | 5 | `variable` vs `variableName` |
| Variable ID vs name | 2 | Blockly ID (`N%hHH...`) used as Python variable |
| `repeat N times` | 18 | No loop index for sweeps |
| Static filenames in loops | 19 | Overwrites every iteration |

### GPT Generation Pitfalls

| Pattern | Bug # | What Goes Wrong |
|---------|-------|-----------------|
| Device context confusion | 15 | Scope commands assigned to SMU |
| Missing connection IPs | 16 | Blocks can't connect |
| Missing loop mutations | 17 | Variable scoping breaks |
| Comment vs code confusion | 20 | Users think comments execute |

**GPT command-prefix-to-device rules (must be enforced):**
```
CH1:|CH2:|ACQuire:|MEASU:|DATa:|HORizontal:|TRIGger: → (scope)
:SOURce:|:OUTPut:|:MEASure: → (smu)/(psu)
:SOURce:FREQuency → (afg)/(awg)
```

### Environment Pitfalls

| Pattern | Bug # | What Goes Wrong |
|---------|-------|-----------------|
| `%ERRORLEVEL%` in batch | 23 | Stale value stops script |
| ZIP nested files | 24 | Commands/templates missing |
| Blockly v12 → v13 | 25 | `getVariableById` deprecated |
| Docstrings JSON | 28 | 404 or TypeError on fetch |

---

## Regression Test Coverage

### Automated Tests

| Test | Covers Bugs | Description |
|------|-------------|-------------|
| `e2e/set-and-query-canary.spec.ts` | BUG-006 | Roundtrip preserves set_and_query metadata |
| Backend compatibility validation | BUG-015, BUG-027 | Rejects tm_devices + scpi_write combos |
| IP conflict detection | (enhancement) | Rejects duplicate IPs at generation time |
| `VERIFY_ZIP.bat` | BUG-024 | Confirms distribution ZIP contents |

### Manual Test Checklist

| Test | Covers Bugs | Steps |
|------|-------------|-------|
| Float sweep generation | BUG-003 | Create `controls_for` with 0.5→2.5 step 0.5, export Python, verify `while` loop |
| Multi-device loop | BUG-004, BUG-015, BUG-027 | scope + SMU workflow, verify commands target correct devices inside loop |
| Variable name roundtrip | BUG-002 | Export Blockly→Steps, verify no corrupted names |
| Sweep param export | BUG-005 | Export to Steps, verify `variableName`/`start`/`stop`/`step` keys |
| Screenshot (Legacy) | BUG-001, BUG-008 | Generate legacy screenshot code, verify no `*OPC?` after READFILE, no `${format}` |
| Screenshot (Modern) | BUG-001 | Generate modern screenshot code, verify `time.sleep()` not `*OPC?` |
| python_code with `\n` | BUG-007 | Add `f.write("data\n")` in python_code, verify `\n` preserved |
| OPC string comparison | BUG-009 | Generate tm_devices code with OPC check, verify `.strip() == "1"` |
| None initialization | BUG-010 | Generate code with variables, verify no `var = None` |
| Cleanup symmetry | BUG-011 | 2+ devices, verify all closed in cleanup |
| Backend dropdown import | BUG-021 | Import tm_devices XML, verify dropdown shows tm_devices |
| Block colors | BUG-022 | Select tm_devices backend, verify block turns purple |
| setup.bat full run | BUG-023 | Run setup.bat on clean machine, verify all 4 steps complete |

### Canary Tests (Continuous)

| Canary | What It Guards | Failure Means |
|--------|---------------|---------------|
| set_and_query roundtrip | BUG-006 | 4975 commands lose query semantics |
| Backend validation | BUG-027 | Wrong blocks pass silently |
| Device context priority | BUG-004 | Commands go to wrong instrument |

---

## Reference: Socket Daemon State Machine (Raw Socket Screenshots)

The following working implementation was reverse-engineered and validated on MSO48B/58B/68B (FW 2.20.8). **Do not modify without re-validation.**

```python
def capture_screenshot(host, port=4000, filename=None, max_retries=3, verbose=False):
    """
    Capture screenshot from MSO58B/MSO68B oscilloscope via raw TCP socket.
    
    CRITICAL: This implementation requires exact command ordering.
    The socket daemon is extremely state-sensitive.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10)
    sock.connect((host, port))
    
    # 1. IDENTIFY (validates connection, detects stale data)
    idn = query("*IDN?")
    if not idn.startswith("TEKTRONIX"):
        # Got stale data, retry
        ...
    
    # 2. PIPELINE PRIMING (not optional — initializes UI subsystems)
    send("*CLS")
    for cmd in ["SAVE:IMAGe:FILEFormat?", "SAVE:IMAGe:COMPosition?",
                "SAVE:IMAGe:VIEWTYpe?", "SAVE:IMAGe:INKSaver?",
                "SAVE:IMAGe:LAYout?", "FILESystem:CWD?"]:
        send("*CLS")
        query(cmd)
        check_error()
    
    # 3. CONFIGURE + CAPTURE
    for cmd in ["SAVE:IMAGe:FILEFormat PNG", "SAVE:IMAGe:COMPosition NORMal",
                "SAVE:IMAGe:VIEWTYpe FULLScreen", "SAVE:IMAGe:INKSaver OFF"]:
        send("*CLS")
        send(cmd)
    
    send(f'SAVE:IMAGe "{remote_path}"')
    opc = query("*OPC?")  # OK here — before binary transfer
    time.sleep(1)
    
    # 4. ONE-SHOT BINARY WINDOW (no queries during transfer!)
    send(f'FILESystem:READFile "{remote_path}"')
    sock.settimeout(5)
    data = bytearray()
    while True:
        try:
            chunk = sock.recv(65536)
            if chunk:
                data.extend(chunk)
            else:
                break
        except socket.timeout:
            if len(data) > 0:
                break  # Timeout = EOF for unframed binary
    
    # 5. PNG HEADER REALIGNMENT
    png_magic = b'\x89PNG\r\n\x1a\n'
    if data[:8] != png_magic:
        if png_magic in data:
            idx = data.find(png_magic)
            data = data[idx:]  # Discard leading garbage
    
    # 6. CLEANUP
    send(f'FILESystem:DELEte "{remote_path}"')
```

**Why this works and naive approaches fail:**

1. **Pipeline priming queries** are not informational — they initialize internal UI subsystems on the scope.
2. **`*CLS` between every step** forces status/event/UI handler reset, preventing response misalignment.
3. **One-shot binary window** — no SCPI traffic during file streaming. The daemon passes binary only in this exact state.
4. **PNG header realignment** — socket may prepend stray ASCII or partial responses. Scan for magic bytes.
5. **Timeout = EOF** — `READFILE` sends no length header, no terminator. Only silence signals completion.

> "Raw-socket screenshot capture requires exact pipeline priming. Do not reorder or remove queries." — Document this as an invariant.

---

## Appendix: IP Conflict Detection

The generator includes resource collision detection at lines 257–276 of `pythonGenerators.ts`:

```
IP Conflict: Multiple devices ("scope" and "smu") are configured to use 
the same IP address: 192.168.1.101.
Please configure different IP addresses for each device in your device settings.
```

This fires at **generation time**, not in the UI. A future enhancement should add visual warnings in the UI device configuration panel before the user attempts to generate.

---

## Appendix: Backend Compatibility Validation

The generator validates block-backend compatibility and produces actionable errors:

```
BACKEND CAPABILITY VIOLATION DETECTED

The following blocks are FORBIDDEN when using tm_devices backend:

Device "scope" (backend: tm_devices):
  ❌ scpi_write - Use tm_devices blocks instead (e.g., fastframe_enable, acquisition_reset)
  ❌ scpi_query - Use tm_devices blocks instead (e.g., search_query_total, measurement_immediate)

HOW TO FIX:
1. Replace scpi_write/scpi_query blocks with appropriate tm_devices blocks
2. Use tm_devices_save_screenshot instead of save_screenshot
3. For save_waveform, switch backend to PyVISA or remove the block

Generation aborted.
```

**Note:** `python_code` blocks bypass this validation intentionally — they allow raw SCPI inside tm_devices workflows as an escape hatch.

---

## Appendix: Export Filename Sanitization

Fixed in BUG pre-demo (2026-01-30). `BlocklyBuilder.tsx` lines 999–1036:

```typescript
function generateCleanFilename(baseName: string, extension: string): string {
  // Converts to snake_case, collapses underscores, adds timestamp
  // "my workflow-v2" → "my_workflow_v2_20260130_143022.xml"
}
```

Before: `my workflow-v2.xml`  
After: `my_workflow_v2_20260130_143022.xml`
