# Policy Upgrades Applied

**Commit:** `d5e4167`  
**Message:** Upgrade policy files from proven chat prompts — fix blockly fields, add golden examples, device types, validation checklists  
**Date:** Applied from prompt-comparison.md gap analysis  
**Source prompts:** `upload_bd8ff4f96adb4dfd.txt` (Blockly+Steps combined), `upload_ca85a6eb69fe9b51.txt` (Steps-only)  

---

## FILE 1: `blockly_xml.strict.v1.md` — REPLACED (rebuilt)

### Factual Fix: connect_scope field names
**BEFORE (WRONG):**
```
connect_scope must include IP, BACKEND fields
```
**AFTER (CORRECT):**
```
connect_scope: DEVICE_NAME, BACKEND (pyvisa|tm_devices), DEV_TYPE
connect_scope must include DEVICE_NAME and BACKEND fields (DEVICE_NAME is the instrument alias, NOT an IP address)
```
Rationale: Upload bd8 (proven working prompt) shows `DEVICE_NAME` not `IP`. The field holds the instrument alias string, never an IP address.

### Additions
- Added `DEV_TYPE` field to `connect_scope`: valid values `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
- Added `recall` block field spec: `DEVICE_CONTEXT, RECALL_TYPE (FACTORY|SETUP|SESSION|WAVEFORM), FILE_PATH, REFERENCE`
- Added `save` block field spec: `DEVICE_CONTEXT, SAVE_TYPE (SETUP|SESSION|WAVEFORM|IMAGE), FILE_PATH, SOURCE`
- Added `save_screenshot` block field spec: `DEVICE_CONTEXT, FILENAME, SCOPE_TYPE (MODERN|LEGACY)`
- Added `<shadow type="math_number">` value input pattern to structural rules
- Added `controls_if` any-type behavior note (accepts Number/String/Boolean — Python truthy)
- Added concrete XML examples: recall block, save block, save_screenshot block, full sequential flow
- Added explicit numbered 6-item validation checklist
- Added File Extension Reference (.TSS / .SET / .WFM)
- Added full Template section at top
- **PRESERVED:** Backend rules section (tm_devices → tm_devices_* blocks only)
- **PRESERVED:** Device context rules (SCPI prefix → device context mapping)

---

## FILE 2: `steps_json.strict.v1.md` — SUPPLEMENTED

### Factual Fix: set_and_query params
**BEFORE (WRONG):**
```
set_and_query: params.command = SCPI set string, params.queryCommand = query string
```
**AFTER (CORRECT):**
```
set_and_query: {command:"CH1:SCALE", cmdParams:[], paramValues:{}}  — NOT queryCommand
```
Rationale: Upload ca8 shows the actual param shape with `cmdParams` and `paramValues`, not `queryCommand`.

### Additions
- Added `method: "pc_transfer"` to `save_screenshot` params
- Documented params for all previously undocumented steps:
  - `error_check`: `{command:"ALLEV?"}`
  - `comment`: `{text:"Documentation note"}`
  - `python`: `{code:"..."}` (with explicit-request-only note)
  - `tm_device_command`: `{code:"...", model:"MSO56", description:"..."}`
- Added `boundDeviceId` multi-device field documentation
- Added group ID naming convention: `"g1"`, `"g2"` pattern
- Added **Device Types** section: `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
- Updated `replace_flow` template to include `"description"` and `"deviceType"` fields
- Added Python → JSON conversion rule
- Added 3 golden workflow examples:
  1. Basic Connect-Query-Disconnect
  2. Measurement with Groups (2 groups, acquire, measure)
  3. Screenshot + Waveform Save
- Added explicit 8-item validation checklist:
  1. No trailing commas
  2. connect/disconnect bookends
  3. saveAs on all queries
  4. Unique IDs / g1,g2 group pattern
  5. Groups have params:{} AND children:[]
  6. Commands verified via tool
  7. Output ACTIONS_JSON (NOT code blocks — overrides chat item 7)
  8. Python → JSON conversion
- **PRESERVED:** All MCP action shapes (insert_step_after, replace_flow, set_step_param, etc.)
- **PRESERVED:** targetStepId:null rule, screenshot rule with CORRECT/FORBIDDEN patterns
- **PRESERVED:** Backend rules, recall rules, deprecated sweep warning

---

## FILE 3: `response_format.v1.md` — SUPPLEMENTED

### Additions
- Added **Python → JSON Rule** section: convert Python to JSON; never output Python unless explicitly requested
- Added **Concrete ACTIONS_JSON Example** showing all 4 keys populated:
  - `summary`, `findings`, `suggestedFixes`, `actions` — each with sample data
  - Example uses a complete replace_flow with connect/query/disconnect
- **PRESERVED:** All existing MCP action types, output shape rules, no-code-blocks rules

---

## FILE 4: `backend_taxonomy.v1.md` — SUPPLEMENTED

### Addition
- Added **`vxi11`** backend section:
  > vxi11 is used automatically by pyvisa when the resource string ends with `::INSTR` suffix. Rarely needs explicit selection by the user — pyvisa handles it transparently. Valid backend value; accept it if user requests it explicitly.
- **PRESERVED:** All existing pyvisa, tm_devices, TekHSI, TekExpress, Hybrid, Preserve Context sections
- **PRESERVED:** TekExpress TEKEXP:STATE? polling rule and port 5000 detail

---

## FILE 5: `scpi_verification.v1.md` — SUPPLEMENTED

### Additions
- Added **Knowledge Base Files** section at top listing all 10 backing files:
  - `mso_2_4_5_6_7.json`, `MSO_DPO_5k_7k_70K.json`, `afg.json`, `awg.json`, `smu.json`
  - `dpojet.json`, `tekexpress.json`
  - `tm_devices_full_tree.json`, `TM_DEVICES_USAGE_PATTERNS.json`, `TM_DEVICES_ARGUMENTS.json`
- Added **Post-Generation Verification Check (MANDATORY)** section:
  > After building all steps, scan every SCPI command string in the generated output. Each command must have been returned in a tool result during this session. If any command was NOT returned by a tool call, call `search_scpi` before finalizing.
- **PRESERVED:** All MCP tool-use rules (search_scpi, get_command_by_header)
- **PRESERVED:** HARD RULES (policy violation wording, do not say "could not verify" when tools succeeded)
- **PRESERVED:** Key disambiguations (FastFrame, channel scale MSO4/5/6/7)
- **PRESERVED:** MEASUrement:ADDMEAS rules and enum validation
- **PRESERVED:** Search Strategy section

---

## What Was NOT Imported (Chat-Specific Rules Deliberately Excluded)

| Chat Rule | Why Excluded |
|-----------|-------------|
| "Output JSON as markdown code blocks" (ca8 checklist item 7) | Directly contradicts MCP `response_format.v1.md` — MCP uses ACTIONS_JSON, never raw code blocks |
| Raw JSON template output (ca8 pattern) | MCP uses ACTIONS_JSON action dispatch; raw template output is wrong format |
| `STEPSUI_GOLDEN_EXAMPLES.json` reference | Chat context only; MCP tools use `search_scpi`/`get_command_by_header` instead |

---

## TypeScript Sanity Check

- Pre-existing TS errors: **4** (in `ragIndex.ts`, `getCommandGroup.ts`, `tools/index.ts`)
- Post-change TS errors: **4** (identical — no new errors introduced)
- Policy `.md` files are not TypeScript and do not affect compilation
- Command: `cd mcp-server && npx tsc --noEmit 2>&1 | grep -c "error TS"` → `4` (both before and after)
