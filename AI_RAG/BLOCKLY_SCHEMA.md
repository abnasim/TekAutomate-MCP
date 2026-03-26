# BLOCKLY_SCHEMA.md — Blockly Block Types, XML Schema & AI Validation Reference

> **Purpose**: Definitive reference for all valid Blockly block types, XML structure rules, field
> requirements, mutation patterns, device-context mappings, and common mistakes an AI must
> detect or avoid when generating/validating Blockly XML for TekAutomate.

---

## 1. XML Structure Requirements

### 1.1 Mandatory Envelope

Every Blockly XML document **must** follow this skeleton:

```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable>varName</variable>
  </variables>
  <block type="..." id="..." x="20" y="20">
    <!-- fields, mutations, children -->
  </block>
</xml>
```

| Rule | Detail |
|------|--------|
| **xmlns** | `https://developers.google.com/blockly/xml` — **MANDATORY on `<xml>`** |
| **Root block position** | First `<block>` must have `x="20" y="20"` |
| **Block IDs** | Every `<block>` must carry a unique `id` string |
| **Variables** | All variables referenced by any block must be declared inside `<variables>` |

### 1.2 Connection / Nesting Types

| Pattern | XML | When to Use |
|---------|-----|-------------|
| **Sequential** (next block) | `<next><block type="..." id="...">…</block></next>` | Chain blocks top-to-bottom |
| **Loop / statement body** | `<statement name="DO"><block>…</block></statement>` | Body of `controls_for`, `controls_repeat_ext`, `controls_if` |
| **Value input** | `<value name="NAME"><shadow type="math_number"><field name="NUM">5</field></shadow></value>` | Numeric / expression inputs (FROM, TO, BY, TIMES, IF0) |
| **Field** | `<field name="NAME">value</field>` | Simple text / dropdown / number values |

### 1.3 Golden-Rule Example

```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables>
    <variable>i</variable>
    <variable>voltage</variable>
  </variables>
  <block type="connect_scope" id="c1" x="20" y="20">
    <mutation show_advanced="false" current_backend="pyvisa"
             current_dev_type="SCOPE" current_conn_type="INSTR"></mutation>
    <field name="DEVICE_NAME">scope</field>
    <field name="BACKEND">pyvisa</field>
    <next>
      <block type="scpi_write" id="w1">
        <field name="DEVICE_CONTEXT">(scope)</field>
        <field name="COMMAND">*RST</field>
        <next>
          <block type="controls_for" id="loop1">
            <mutation><variable>i</variable></mutation>
            <field name="VAR">i</field>
            <value name="FROM"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
            <value name="TO"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
            <value name="BY"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <statement name="DO">
              <block type="scpi_write" id="w2">
                <field name="DEVICE_CONTEXT">(scope)</field>
                <field name="COMMAND">CH1:SCAle 1.0</field>
              </block>
            </statement>
            <next>
              <block type="disconnect" id="d1">
                <field name="DEVICE_CONTEXT">(scope)</field>
              </block>
            </next>
          </block>
        </next>
      </block>
    </next>
  </block>
</xml>
```

---

## 2. All Valid Block Types

### 2.1 Connection Blocks

| Block Type | Fields | Mutation Required | Notes |
|------------|--------|-------------------|-------|
| `connect_scope` | `DEVICE_NAME`, `BACKEND` (`pyvisa`\|`tm_devices`\|`tekhsi`\|`hybrid`\|`vxi11`), `DEV_TYPE` | **Yes** — `show_advanced`, `current_backend`, `current_dev_type`, `current_conn_type` | Usually the **first** block in a workflow. Backend drives color: PyVISA = green (120), tm_devices = purple (270), TekHSI = orange (30), Hybrid = yellow (60), VXI-11 = teal (180). |
| `disconnect` | `DEVICE_CONTEXT` | No | Typically the **last** block. Does not remove device from tracking (cleanup handles close). |
| `set_device_context` | `DEVICE` | No | Switches the active device for subsequent blocks that lack an explicit `DEVICE_CONTEXT`. |

### 2.2 SCPI Blocks

| Block Type | Fields | Notes |
|------------|--------|-------|
| `scpi_write` | `DEVICE_CONTEXT`, `COMMAND` | Standard SCPI write. **FORBIDDEN** with `tm_devices` backend — use tm_devices blocks instead. |
| `scpi_query` | `DEVICE_CONTEXT`, `COMMAND`, `VARIABLE` | `VARIABLE` stores result. **VARIABLE is required** — every query must save somewhere. **FORBIDDEN** with `tm_devices` backend. |
| `scpi_write_enhanced` | `DEVICE_CONTEXT`, `COMMAND` + dynamic parameter fields | Enhanced variant with auto-parsed parameter dropdowns. Same Python output as `scpi_write`. |
| `scpi_query_enhanced` | `DEVICE_CONTEXT`, `COMMAND`, `VARIABLE` + dynamic parameter fields | Enhanced variant with auto-parsed parameter dropdowns. Same Python output as `scpi_query`. |

### 2.3 Save / Recall Blocks

| Block Type | Fields | Notes |
|------------|--------|-------|
| `save_waveform` | `SOURCE`, `FILENAME`, `FORMAT` | `FORMAT`: `CSV` \| `BIN` \| `WFM` \| `MAT` |
| `save_screenshot` | `DEVICE_CONTEXT`, `FILENAME`, `SCOPE_TYPE` | `SCOPE_TYPE`: `MODERN` (MSO4/5/6) \| `LEGACY` (DPO/MSO 5K/7K/70K). **FORBIDDEN** with `tm_devices` backend. |
| `save` | `DEVICE_CONTEXT`, `SAVE_TYPE`, `FILE_PATH`, `SOURCE` | `SAVE_TYPE`: `SETUP` \| `SESSION` \| `WAVEFORM` \| `IMAGE` |
| `recall` | `DEVICE_CONTEXT`, `RECALL_TYPE`, `FILE_PATH`, `REFERENCE` | `RECALL_TYPE`: `FACTORY` (reset) \| `SETUP` (`.SET` = settings only) \| `SESSION` (`.TSS` = full session w/ waveforms) \| `WAVEFORM` (`.WFM` → REF) |

**File-type rule**: `.SET` = settings only, `.TSS` = full session restore, `.WFM` = waveform data.

### 2.4 Timing Blocks

| Block Type | Fields | Notes |
|------------|--------|-------|
| `wait_seconds` | `SECONDS` | Uses `<field>` (FieldNumber), **NOT** `<value>` with shadow. |
| `wait_for_opc` | `DEVICE_CONTEXT`, `TIMEOUT` | Sends `*OPC?` and blocks until `1` is returned. For binary ops, use `time.sleep()` instead. |

### 2.5 Acquisition Blocks

| Block Type | Fields | Notes |
|------------|--------|-------|
| `start_acquisition` | — | Start continuous acquisition. |
| `stop_acquisition` | — | Stop acquisition. |
| `single_acquisition` | — | Single acquisition + OPC wait. |
| `acquisition_reset` | `DEVICE_CONTEXT` | Sends `ACQuire:STATE OFF`. **Must precede** `start_acquisition` / `single_acquisition`. |

**Rule**: `acquisition_reset` → acquire → wait → then measurements are legal.

### 2.6 Channel Blocks

| Block Type | Fields | Notes |
|------------|--------|-------|
| `configure_channel` | `CHANNEL`, `SCALE`, `OFFSET`, `COUPLING`, `TERMINATION` | `TERMINATION`: `ONEMEG` (1 MΩ) \| `FIFTY` (50 Ω). Generates four SCPI writes. |
| `enable_channel` | `CHANNEL`, `STATE` | `STATE`: `ON` \| `OFF` |

### 2.7 tm_devices Blocks

These blocks are **preferred over `python_code`** when the backend is `tm_devices`.

| Block Type | Fields | Notes |
|------------|--------|-------|
| `fastframe_enable` | `STATE` | `ON` \| `OFF` |
| `fastframe_set_count` | `COUNT` | Number of frames (1–10 000) |
| `fastframe_select_frame` | `CHANNEL`, `FRAME` | Select specific frame for processing |
| `search_configure_edge` | `SEARCH_NUM`, `SOURCE`, `SLOPE` | `SLOPE`: `FALL` \| `RISE` |
| `search_query_total` | `SEARCH_NUM`, `VARIABLE` | Stores total search results |
| `measurement_immediate` | `TYPE`, `SOURCE`, `VARIABLE` | `TYPE`: `PK2PK`, `RMS`, `FREQUENCY`, etc. **Illegal until acquisition completes.** |
| `tm_devices_save_screenshot` | — | Use instead of `save_screenshot` with tm_devices backend |
| `tm_devices_recall_session` | — | Use instead of `recall` with tm_devices backend |
| `tm_devices_write` | — | tm_devices write command |
| `tm_devices_query` | — | tm_devices query command |

### 2.8 TekExpress Blocks

TekExpress uses **PyVISA SOCKET** on port 5000. Never use `socket.sendall()` — always use `tekexp_*` blocks.

| Block Type | Fields | Notes |
|------------|--------|-------|
| `connect_tekexpress` | `HOST`, `PORT`, `TIMEOUT` | Default port 5000 |
| `tekexp_write` | `COMMAND` | |
| `tekexp_query` | `COMMAND`, `VARIABLE` | |
| `tekexp_run` | — | Start test execution |
| `tekexp_wait_state` | `EXPECTED`, `POLL_INTERVAL`, `TIMEOUT` | Wait for specific state (e.g., `COMPLETE`) |
| `tekexp_popup` | `RESPONSE` | Handle popup dialogs |
| `tekexp_select_device` | (varies) | Select DUT device |
| `tekexp_select_test` | (varies) | Select/deselect tests |
| `tekexp_select_version` | (varies) | Select test version |
| `tekexp_set_mode` | (varies) | Set test mode |
| `tekexp_set_acquire_mode` | (varies) | `LIVE` \| `PRE-RECORDED` |
| `tekexp_set_value` | (varies) | Set parameter values (e.g., DUTID) |
| `tekexp_export_report` | (varies) | Export results |
| `tekexp_save_session` | (varies) | Save TekExpress session |
| `tekexp_query_result` | (varies) | Query test results |

### 2.9 Standard Blockly Blocks (Control / Variable / Math)

| Block Type | Fields / Inputs | Notes |
|------------|----------------|-------|
| `controls_for` | `VAR`, `FROM`, `TO`, `BY` + `<statement name="DO">` | **MUTATION REQUIRED** — see §4.1. Generator detects float values and emits `while` loop instead of `range()`. |
| `controls_repeat_ext` | `TIMES` + `<statement name="DO">` | Simple repeat N times |
| `controls_if` | `IF0` (value), `DO0` (statement) | Accepts **any type** (truthy) — Python truthiness behavior |
| `variables_set` | `VAR`, `VALUE` | **Important**: `VAR` field stores variable **ID**, not name. Use `workspace.getVariableById(id).getName()` to resolve. |
| `variables_get` | `VAR` | Same ID-vs-name caveat as `variables_set`. |
| `math_number` | `NUM` | |
| `math_arithmetic` | `OP`, `A`, `B` | `OP`: `ADD`, `MINUS`, `MULTIPLY`, `DIVIDE`, `POWER` |

### 2.10 Utility Blocks

| Block Type | Fields | Notes |
|------------|--------|-------|
| `python_code` | `CODE` | **USE SPARINGLY.** Max 2–3 lines. Prefer native blocks. `\n` must remain as escape sequence, not be converted to actual newlines. |

### 2.11 INVALID Block Types (Steps JSON Only — NOT Valid in Blockly XML)

| Invalid Type | Why |
|-------------|-----|
| `group` | Steps UI concept — no Blockly equivalent |
| `comment` | Steps UI concept — no Blockly equivalent |
| `error_check` | Steps UI concept — no Blockly equivalent |

**If these appear in Blockly XML, the document is malformed.**

---

## 3. DEVICE_CONTEXT Rules (MOST COMMON ERROR)

The `DEVICE_CONTEXT` field tells the generator which instrument variable to use.
The field value is wrapped in parentheses: `(scope)`, `(smu)`, `(psu)`, `(tekexp)`.

### 3.1 SCPI Prefix → Device Context Mapping

| SCPI Prefix Pattern | Correct Context | Example Commands |
|--------------------|----------------|------------------|
| `CH1:`, `CH2:`, `CH3:`, `CH4:` | `(scope)` | `CH1:SCAle 1.0`, `CH2:COUPLING DC` |
| `ACQuire:`, `ACQUIRE:` | `(scope)` | `ACQuire:STATE ON` |
| `MEASurement:`, `:MEASUREMENT:` | `(scope)` | `:MEASUREMENT:IMMED:TYPE FREQUENCY` |
| `SEARCH:` | `(scope)` | `SEARCH:SEARCH1:EDGE:SOURCE CH1` |
| `HORizontal:` | `(scope)` | `HORizontal:SCAle 1e-6` |
| `TRIGger:` | `(scope)` | `TRIGger:A:EDGE:SOURCE CH1` |
| `DISplay:` | `(scope)` | `DISplay:PLOTView1:CURSor:VBARs:DELTa?` |
| `:WAVEFORM:` | `(scope)` | `:WAVEFORM:SOURCE CH1` |
| `SELECT:` | `(scope)` | `SELECT:CH1 ON` |
| `SAVE:` | `(scope)` | `SAVE:WAVEFORM CH1,"file.wfm"` |
| `:SOURce:`, `:SENSe:`, `:MEASure:` (lowercase-colon style) | `(smu)` | `:SOURce:VOLTage 5.0` |
| `OUTPut`, `VOLTage`, `CURRent` (no leading colon) | `(psu)` | `OUTPut ON` |
| `TEKEXP:*` | `(tekexp)` | `TEKEXP:STATE RUN` |
| `*RST`, `*IDN?`, `*OPC?` | Any — matches connected device | Common IEEE-488.2 commands |

### 3.2 Priority Rule in Generator

`DEVICE_CONTEXT` field has **absolute priority** over block-chain traversal. If the field
contains a valid device name, the generator returns it immediately without walking the
block chain. This is critical for blocks inside loops whose `getPreviousBlock()` is null.

### 3.3 Common Mistakes

| Mistake | Why It's Wrong |
|---------|----------------|
| `CH1:SCAle` with `(smu)` | Scope command sent to SMU |
| `:SOURce:VOLTage` with `(scope)` | SMU command sent to scope |
| `TEKEXP:RUN` with `(scope)` | TekExpress command sent to scope |
| `:MEASUREMENT:IMMED:TYPE` with `(smu)` | Measurement command sent to SMU |

The generator includes `validateCommandDeviceMapping()` which will **abort generation** if
scope-only commands target non-scope devices (or vice versa).

---

## 4. Mutation Requirements

### 4.1 `controls_for` (CRITICAL — Most Frequently Broken)

The `<mutation>` element with `<variable>` child is **mandatory**. Without it, the
loop variable cannot be resolved.

```xml
<block type="controls_for" id="loop1">
  <mutation><variable>i</variable></mutation>
  <field name="VAR">i</field>
  <value name="FROM">
    <shadow type="math_number"><field name="NUM">0</field></shadow>
  </value>
  <value name="TO">
    <shadow type="math_number"><field name="NUM">4</field></shadow>
  </value>
  <value name="BY">
    <shadow type="math_number"><field name="NUM">1</field></shadow>
  </value>
  <statement name="DO">
    <!-- loop body blocks -->
  </statement>
</block>
```

**Float loop generation**: If any of FROM/TO/BY is non-integer, the Python generator
emits a `while` loop instead of `for … in range(…)` because `range()` doesn't accept floats.

```python
# Integer: for i in range(0, 5, 1):
# Float:   v = 0.5
#          while v <= 2.5:
#              ...
#              v += 0.5
```

### 4.2 `connect_scope`

```xml
<block type="connect_scope" id="c1">
  <mutation show_advanced="false" current_backend="pyvisa"
           current_dev_type="SCOPE" current_conn_type="INSTR"></mutation>
  <field name="DEVICE_NAME">scope</field>
  <field name="BACKEND">pyvisa</field>
</block>
```

The mutation drives:
- Which advanced fields are shown (`show_advanced`)
- Backend-specific color coding (`current_backend`)
- Device-type hints (`current_dev_type`)
- Connection string format (`current_conn_type`: `INSTR` \| `SOCKET`)

On XML import, `domToMutation` restores the backend and updates both the dropdown field
value and the block color via `setTimeout` to handle async rendering.

---

## 5. Block ↔ Step Type Mapping

### 5.1 Blockly Block → Steps UI Step

| Blockly Block | Steps Step Type | Conversion Notes |
|---------------|----------------|------------------|
| `connect_scope` | `connect` | `params.instrumentIds`, `params.printIdn` |
| `disconnect` | `disconnect` | |
| `scpi_write` | `write` | `params.command` |
| `scpi_query` | `query` | `params.command`, `params.saveAs` (REQUIRED) |
| `wait_seconds` | `sleep` | `params.duration` |
| `wait_for_opc` | `python` | Generates OPC Python code |
| `save_waveform` | `save_waveform` | |
| `save_screenshot` | `save_screenshot` | `params.filename`, `params.scopeType` |
| `recall` | `recall` | `params.recallType`, `params.filePath`, `params.reference` |
| `controls_for` | `sweep` | `params.variableName`, `params.start`, `params.stop`, `params.step`, `params.saveResults` |
| `controls_repeat_ext` | `sweep` | `params.variableName="i"`, `params.start=0`, `params.stop=N-1`, `params.step=1` |
| `variables_set` | `python` | Variable assignment as Python code |
| `set_device_context` | `comment` | Device switch recorded as comment |
| `python_code` | `python` | `params.code` |

### 5.2 Steps UI Step → Blockly Block

| Steps Step Type | Blockly Block | Conversion Notes |
|----------------|---------------|------------------|
| `connect` | `connect_scope` | Looks up device in `devices[]` for backend/IP/type |
| `disconnect` | `disconnect` | |
| `write` | `scpi_write` | |
| `query` | `scpi_query` | `saveAs` → `VARIABLE` |
| `set_and_query` | `scpi_write` + `scpi_query` | Split into two blocks |
| `sleep` | `wait_seconds` | |
| `python` | `python_code` | |
| `save_waveform` | `save_waveform` | |
| `save_screenshot` | `save_screenshot` | |
| `recall` | `recall` | |
| `sweep` | `controls_for` | Reverse of sweep → for-loop conversion |
| `comment` | (skipped or annotation) | No Blockly equivalent |
| `error_check` | (skipped) | No Blockly equivalent |
| `group` | (flattened) | Children extracted sequentially |

---

## 6. Backend Capability Rules

### 6.1 Backend Compatibility Matrix

| Backend | `scpi_write` / `scpi_query` | `save_screenshot` / `save_waveform` | tm_devices blocks | TekExpress blocks | Connection Types |
|---------|---------------------------|-------------------------------------|-------------------|-------------------|------------------|
| `pyvisa` | ✅ | ✅ | ❌ | ✅ (socket) | TCP/IP, Socket, USB, GPIB |
| `tm_devices` | ❌ **FORBIDDEN** | ❌ **FORBIDDEN** | ✅ | ❌ | TCP/IP, USB, GPIB |
| `tekhsi` | ❌ | ❌ | ❌ | ❌ | TCP/IP port 5000 only |
| `hybrid` | ✅ (SCPI part) | ✅ | ✅ | ❌ | TCP/IP, USB, GPIB |
| `vxi11` | ✅ | ✅ | ❌ | ❌ | TCP/IP only |

### 6.2 Enforcement

The generator includes backend validation that **aborts generation** when forbidden
block types are used with incompatible backends. The error message lists all violations
and provides "HOW TO FIX" guidance.

### 6.3 IP Conflict Detection

Multiple devices configured with the same IP address trigger an error at generation time.

---

## 7. Common XML Mistakes the AI Must Catch

| # | Mistake | Detection | Fix |
|---|---------|-----------|-----|
| 1 | Missing `xmlns` on `<xml>` | Check root element attributes | Add `xmlns="https://developers.google.com/blockly/xml"` |
| 2 | Missing `<mutation>` on `controls_for` | Check all `controls_for` blocks | Add `<mutation><variable>varName</variable></mutation>` |
| 3 | Wrong `DEVICE_CONTEXT` for command | Match SCPI prefix to device type | Use mapping table from §3.1 |
| 4 | Duplicate block IDs | Scan all `id` attributes | Ensure uniqueness |
| 5 | `scpi_write`/`scpi_query` with `tm_devices` backend | Check backend on connect block | Replace with `tm_devices_*` or `python_code` blocks |
| 6 | Missing `VARIABLE` on `scpi_query` | Check all query blocks | Add `VARIABLE` field |
| 7 | `python_code` where a native block exists | Audit code content against block catalog | Replace with native block (e.g., `fastframe_enable`) |
| 8 | `{variable}` in SCPI `COMMAND` field | Scan for `{…}` patterns in COMMAND | Variables are treated as literals — use `python_code` with f-string instead |
| 9 | Invalid block types (`group`, `comment`, `error_check`) | Check block type against valid list | Remove or convert |
| 10 | `wait_seconds` using `<value>` instead of `<field>` | Check child element type | Change to `<field name="SECONDS">value</field>` |
| 11 | Missing root block `x="20" y="20"` | Check first block attributes | Add position attributes |
| 12 | `\n` in `python_code` converted to actual newline | Check generator output | Keep `\n` as escape sequence in string literals |
| 13 | Missing `TERMINATION` on `configure_channel` | Check field presence | Add `<field name="TERMINATION">ONEMEG</field>` |
| 14 | `acquisition_reset` missing before acquisition start | Check block ordering | Insert `acquisition_reset` before `start_acquisition`/`single_acquisition` |
| 15 | `measurement_immediate` before acquisition completes | Check block ordering | Move after OPC wait |

---

## 8. `pythonGenerators.ts` Key Patterns

### 8.1 Float Detection for Loops
```typescript
const needsFloatLoop = !Number.isInteger(fromValue) ||
                       !Number.isInteger(toValue) ||
                       !Number.isInteger(byValue);
// Float → while loop; Integer → for … in range(…)
```

### 8.2 Device Context Extraction (Absolute Priority)
```typescript
function getDeviceVariable(block: Blockly.Block): string {
  // FIRST: Check explicit DEVICE_CONTEXT field
  const deviceContext = block.getFieldValue('DEVICE_CONTEXT');
  if (deviceContext && isValid(deviceContext)) {
    return deviceContext.replace(/[()]/g, '').trim(); // RETURN IMMEDIATELY
  }
  // FALLBACK: Walk block chain, check parents, use currentDeviceContext
}
```

### 8.3 OPC Wait Pattern
- After binary operations (e.g., screenshot save): use `time.sleep()`, NOT `*OPC?`
- After acquisition / state changes: use `*OPC?` (via `wait_for_opc` block)

### 8.4 Variable Name Resolution (Critical Bug Fix)
```typescript
// ❌ WRONG — returns UUID like "N%hHHhp:Bg=T0!BWtnrB"
const varName = block.getFieldValue('VAR');

// ✅ CORRECT — returns human-readable name like "i"
const varId = block.getFieldValue('VAR');
const varModel = block.workspace.getVariableById(varId);
const varName = varModel ? varModel.getName() : 'i';
```

This applies in three locations: `controls_for`, `variables_set`, and `variables_get` (inside `convertExpressionToPython`).

### 8.5 Import Deduplication
The generator tracks which imports have been added and deduplicates them.
`import pyvisa`, `import time`, `from tm_devices import DeviceManager`, etc.

### 8.6 Cleanup Code Generation
- Disconnect blocks generate **no Python code** (cleanup handles everything)
- Cleanup extracts device names from generated code using regex
- All opened devices are closed symmetrically:
```python
if 'scope' in locals():
    scope.close()
if 'smu' in locals():
    smu.close()
```

### 8.7 Backend-Specific Code Paths

| Block | PyVISA Output | tm_devices Output |
|-------|---------------|--------------------|
| `acquisition_reset` | `scope.write('ACQuire:STATE OFF')` | `scope.commands.acquire.state.write("OFF")` |
| `single_acquisition` | `scope.write('ACQUIRE:STOPAFTER SEQUENCE')` … | `scope.commands.acquire.stopafter.write("SEQuence")` … |
| `wait_for_opc` | `scope.query('*OPC?')` | `scope.commands.opc.query()` |

### 8.8 SCPI Sanitization
Newlines and leading/trailing whitespace are auto-removed from COMMAND fields.

### 8.9 Command-to-Device Validation
```typescript
function validateCommandDeviceMapping(command, device, blockType): void {
  // Scope-only patterns: :MEASUREMENT:, :CH1:, :ACQUIRE:, :HORIZONTAL:, etc.
  // SMU/PSU-only patterns: :SOURCE:, :OUTPUT
  // Mismatch → throw Error with clear guidance
}
```

---

## 9. SCPI ↔ tm_devices Conversion Reference

| SCPI Command | tm_devices Path | Method | Value |
|-------------|----------------|--------|-------|
| `CH1:SCALE 1.0` | `ch[1].scale` | `write` | `1.0` |
| `CH2:COUPLING DC` | `ch[2].coupling` | `write` | `DC` |
| `*IDN?` | `commands.idn` | `query` | — |
| `ACQUIRE:STATE?` | `acquire.state` | `query` | — |
| `MATH1:DEFINE "CH1+CH2"` | `math[1].define` | `write` | `"CH1+CH2"` |
| `:HORIZONTAL:FASTFRAME:STATE ON` | `horizontal.fastframe.state` | `write` | `ON` |

**Conversion rules**:
- Split by `:` → lowercase → join with `.`
- Indexed components: `CH1` → `ch[1]`, `MATH2` → `math[2]`
- `?` suffix → `query` method; presence of value → `write` method

---

## 10. Enhanced SCPI Block Parameter Types

When commands are added via the Browse Commands modal, enhanced blocks auto-parse
parameters into UI elements:

| Parameter Type | UI Element | Examples |
|---------------|-----------|----------|
| Channel (CH1–CH4) | Dropdown | `CH1`, `CH2`, `CH3`, `CH4` |
| Reference (REF1–REF4) | Dropdown | `REF1`, `REF2`, `REF3`, `REF4` |
| Math (MATH1–MATH4) | Dropdown | `MATH1`, `MATH2`, `MATH3`, `MATH4` |
| Source (SOUrce1–4) | Dropdown | `SOUrce1`, `SOUrce2`, etc. |
| Plot (PLOTView1–8) | Dropdown | `PLOTView1`–`PLOTView8` |
| Mode / Enumeration | Dropdown | `AUTO`, `MANual`, `ON`, `OFF`, etc. |
| Numeric values | Text input | `1.0`, `1e-6`, `100` |

Changes to parameter dropdowns update the COMMAND field bidirectionally.
Manual edits to COMMAND require right-click → "Refresh Parameters" to re-parse.

---

## 11. Device Naming Conventions

| Alias | Device Type | Color in Blockly |
|-------|-----------|------------------|
| `scope`, `scope1`, `scope2` | Oscilloscope | Blue shades |
| `psu` | Power Supply | Red |
| `smu` | Source Measure Unit | Red |
| `dmm` | Digital Multimeter | Green |
| `awg` | Arbitrary Waveform Generator | (default) |
| `sa` | Spectrum Analyzer | (default) |

SCPI blocks automatically change color based on the connected device context.

---

## 12. Validation Checklist (For AI-Generated XML)

1. ☐ `xmlns` present on `<xml>` root
2. ☐ All used variables declared in `<variables>` section
3. ☐ All block `id` attributes are unique
4. ☐ Root block has `x="20" y="20"`
5. ☐ Only valid block types used (no `group`/`comment`/`error_check`)
6. ☐ Workflow starts with `connect_scope`, ends with `disconnect`
7. ☐ Every `scpi_query` has a `VARIABLE` field
8. ☐ Every `controls_for` has `<mutation><variable>…</variable></mutation>`
9. ☐ `DEVICE_CONTEXT` matches the SCPI command prefix (§3.1)
10. ☐ Backend capability rules respected (§6.1)
11. ☐ `acquisition_reset` precedes acquisition blocks
12. ☐ `measurement_immediate` follows completed acquisition
13. ☐ No `{variable}` patterns in SCPI COMMAND fields
14. ☐ `wait_seconds` uses `<field>`, not `<value>`
15. ☐ `python_code` blocks are ≤ 3 lines; native block preferred
16. ☐ `configure_channel` includes `TERMINATION` field
17. ☐ No duplicate device IP addresses
18. ☐ `\n` in `python_code` remains as escape sequence
