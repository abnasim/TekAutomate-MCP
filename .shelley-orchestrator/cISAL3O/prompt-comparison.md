# Prompt Comparison: MCP Policy Files vs Uploaded Proven Prompts

**Generated:** Analysis of 5 MCP policy files vs 2 uploaded chat prompts  
**Goal:** Identify gaps and determine which MCP policies should be replaced or supplemented with content from the proven chat prompts.

---

## Source Files

| Source | Description |
|--------|-------------|
| `upload_bd8ff4f96adb4dfd.txt` | **Blockly+StepsJSON combined prompt** — covers Blockly XML generation AND Steps JSON in one doc |
| `upload_ca85a6eb69fe9b51.txt` | **Steps-only prompt** — focused purely on Steps UI JSON, with golden examples |
| `mcp-server/policies/response_format.v1.md` | MCP: output format + ACTIONS_JSON action types |
| `mcp-server/policies/steps_json.strict.v1.md` | MCP: Steps JSON structure + action shapes |
| `mcp-server/policies/scpi_verification.v1.md` | MCP: SCPI no-hallucination rules + search strategy |
| `mcp-server/policies/backend_taxonomy.v1.md` | MCP: Backend selection decision tree |
| `mcp-server/policies/blockly_xml.strict.v1.md` | MCP: Blockly XML structural rules |

---

## Section 1: Step Type Definitions & Params

### What MCP policies say (`steps_json.strict.v1.md`)
- Lists: `connect, disconnect, query, write, set_and_query, recall, sleep, python, save_waveform, save_screenshot, error_check, comment, group, tm_device_command`
- Structural rules present: `saveAs` required for query, groups need `params:{} AND children:[]`, recall file extensions
- `set_and_query` mentions `params.queryCommand` but **no example shown**
- `save_screenshot` includes `scopeType` but **method field** (`"pc_transfer"`) not mentioned
- `connect` params not documented inline (only shown in action examples)

### What the uploads say
**Upload bd8 (Blockly+Steps combined):**
- `connect: {instrumentIds:[], printIdn:true}` — explicit
- `query: {command:"*IDN?", saveAs:"var"}` with ⚠️ saveAs REQUIRED note
- `recall: {recallType:"FACTORY|SETUP|SESSION|WAVEFORM", filePath:"", reference:"REF1"}` — full param set
- `sleep: {duration:0.5}` — explicit
- `save_screenshot: {filename:"ss.png", scopeType:"modern"}` — explicit
- Lists `python` step type but no params shown

**Upload ca8 (Steps-only):**
- Adds `save_screenshot` with **method: "pc_transfer"** field (not in MCP policy)
- `set_and_query: {command:"CH1:SCALE", cmdParams:[], paramValues:{}}` — **completely different param shape than MCP's `queryCommand` field**
- `error_check: {command:"ALLEV?"}` — params documented (missing from MCP policy)
- `comment: {text:"Documentation note"}` — params documented (missing from MCP policy)
- `python: {code:"..."}` — params documented (missing from MCP policy)
- `tm_device_command: {code:"...", model:"MSO56", description:"..."}` — params documented (missing from MCP policy)
- Multi-device: `boundDeviceId` field documented — **completely absent from MCP policy**
- Group IDs: `"g1","g2"` pattern for groups — **absent from MCP policy**

### Gaps
- ❌ MCP policy missing `method: "pc_transfer"` on `save_screenshot`
- ❌ MCP policy `set_and_query` param shape (`queryCommand`) conflicts with upload's (`cmdParams`, `paramValues`)
- ❌ MCP policy missing params for `error_check`, `comment`, `python`, `tm_device_command`
- ❌ MCP policy missing `boundDeviceId` multi-device field
- ❌ MCP policy missing group ID naming convention (`g1`, `g2`)

---

## Section 2: SCPI No-Hallucination Rules

### What MCP policies say (`scpi_verification.v1.md`)
- **Strong and specific.** Mandates `search_scpi` or `get_command_by_header` tool call BEFORE emitting any SCPI command
- Clear failure text: "I could not verify this command in the uploaded sources."
- Explicit FastFrame, channel scale, and measurement disambiguation (MSO5/6 vs legacy)
- `MEASUrement:ADDMEAS` with exact enum (`FREQ`, `AMP`) — warns against `FREQUENCY`, `AMPLITUDE`
- Search strategy guidance: use specific operation-focused queries, not generic feature names
- Provenance: include `commandId + sourceFile` in results
- Handles the distinction: "do not say 'could not verify' when verified tool results ARE present"
- Hard rule: using commands not in verified results = **POLICY VIOLATION**

### What the uploads say
**Upload bd8 (Blockly+Steps combined):**
- "SOURCE OF TRUTH RULE": do not infer, guess, normalize, or invent from naming patterns
- Post-check pseudo-code: validates all generated SCPI against `load_command_library()` set — conceptual but not MCP-tool-aware
- `STRICT_MODE = true` flag concept
- "Every SCPI command must include a reference to the command entry in the command-library JSON"
- Does NOT mention `search_scpi` or `get_command_by_header` (chat context, not MCP)

**Upload ca8 (Steps-only):**
- Simpler rule: "Search the JSON knowledge files, Verify exact syntax from JSON"
- Failure: "Command not in verified database"
- Lists knowledge base files: `mso_2_4_5_6_7.json`, `MSO_DPO_5k_7k_70K.json`, `afg.json`, `awg.json`, `smu.json`, `dpojet.json`, `tekexpress.json`
- Explicitly names `tm_devices_full_tree.json`, `TM_DEVICES_USAGE_PATTERNS.json`, `TM_DEVICES_ARGUMENTS.json`
- Does NOT mention `search_scpi` or `get_command_by_header` (chat context, not MCP)

### Gaps
- ✅ MCP `scpi_verification.v1.md` is **already the strongest** of all sources for the MCP context (tool-aware)
- ⚠️ Upload's knowledge-base file listing (`mso_2_4_5_6_7.json` etc.) could be **added as comments** so model knows what files back the tools
- ⚠️ Upload bd8's "every command must include a reference to commandId + sourceFile" matches MCP policy but MCP policy could be more explicit about this in the output
- ⚠️ MCP policy lacks the "post-check" concept (verify all generated commands against library before output) — worth adding as a final validation step reminder

---

## Section 3: Output Format / ACTIONS_JSON Structure

### What MCP policies say (`response_format.v1.md` + `steps_json.strict.v1.md`)
**`response_format.v1.md`:**
- Shape: 1-2 sentences (max 400 chars prose) then `ACTIONS_JSON: {...}`
- JSON structure: `{"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}`
- Action types: `insert_step_after`, `set_step_param`, `remove_step`, `replace_flow`, `add_error_check_after_step`
- "If flow already valid and no changes needed: return `actions:[]`"
- "No analysis walls — max 2 sentences for build/edit operations"

**`steps_json.strict.v1.md`:**
- Reinforces: NEVER output steps in fenced code blocks
- Concrete action shape examples with actual SCPI commands shown inline

### What the uploads say
**Upload ca8 (Steps-only):**
- Rule 7 in validation checklist: **"Output JSON codeblocks as markdown code blocks"** — **CONTRADICTS** MCP policy ("NEVER output workflow steps in fenced code blocks")
- Rule 8: "If user shares Python code convert it back to JSON" — useful rule absent from MCP
- Does NOT use ACTIONS_JSON structure (chat context; outputs raw JSON codeblocks)
- Template structure: `{"name":"...","description":"...","backend":"pyvisa","deviceType":"SCOPE","steps":[...]}`  
  — note: `"description"` and `"deviceType"` top-level fields **absent from MCP `replace_flow` action**

**Upload bd8 (Blockly+Steps combined):**
- Does not document ACTIONS_JSON at all — operates in direct output mode

### Gaps
- ❌ Upload ca8 rule 7 (markdown code blocks) **directly contradicts** MCP response_format — the chat convention must NOT be imported
- ❌ MCP `replace_flow` action missing `"description"` and `"deviceType"` top-level flow fields that upload ca8 uses
- ❌ MCP policy does not document `ACTIONS_JSON` structure with a concrete visual example showing all 4 keys populated
- ⚠️ Upload ca8 rule 8 ("convert Python to JSON") is a useful user-intent rule — worth adding to MCP response_format

---

## Section 4: Backend Taxonomy

### What MCP policies say (`backend_taxonomy.v1.md`)
- Decision tree: pyvisa default → tm_devices (explicit request only) → TekHSI (grpc/tekhsi explicit) → TekExpress (SOCKET+port 5000+TEKEXP:* commands)
- TekHSI purpose well-defined: waveform acquisition only, not measurements
- tm_devices constraints: `tm_device_command` only, no raw write/query, no socket, requires known model
- TekExpress: pyvisa + SOCKET, TEKEXP:* commands, no *OPC? → use TEKEXP:STATE? polling — **excellent, unique detail**
- Hybrid: rare, multi-backend, explicit only
- "Preserve context" rule: don't change backend unless user asks

### What the uploads say
**Upload bd8 (Blockly+Steps combined):**
- Lists backends: `pyvisa, tm_devices, vxi11, tekhsi, hybrid` — adds **`vxi11`** not in MCP taxonomy
- Blockly-specific: `connect_scope` BACKEND field drives generation (not UI config) — Blockly-only concern
- tm_devices Blockly blocks listed: `tm_devices_write, tm_devices_query, tm_devices_save_screenshot, tm_devices_recall_session`

**Upload ca8 (Steps-only):**
- Lists: `pyvisa (default) | tm_devices | vxi11 | tekhsi | hybrid` — same as bd8
- No additional decision logic beyond the list

### Gaps
- ❌ MCP taxonomy missing `vxi11` as a named backend option (upload ca8 lists it; it may be a valid user request target)
- ✅ MCP TekExpress detail (`TEKEXP:STATE?` polling, port 5000) is **more detailed** than uploads — must preserve
- ✅ MCP Hybrid section is more precise than uploads — preserve
- ⚠️ MCP taxonomy could add: "vxi11 is used automatically by pyvisa when ::INSTR suffix is used" (clarification from upload ca8)

---

## Section 5: Blockly XML Rules

### What MCP policies say (`blockly_xml.strict.v1.md`)
- Root: `<xml xmlns="...">`, root block x="20" y="20"
- Allowed block types listed (clean, concise)
- Forbidden: `group`, `comment`, `error_check`
- Structural: unique IDs, `<next>` for sequence, `<statement name="DO">` for loops
- `scpi_query`: VARIABLE field must be non-empty
- `connect_scope`: must include IP, BACKEND fields — **wait**: upload bd8 shows `DEVICE_NAME` + `BACKEND` fields, no IP field in connect_scope
- Device context rules: SCPI prefix determines device context
- Backend rules: tm_devices → tm_devices_* blocks only

### What the uploads say
**Upload bd8 (Blockly+Steps combined):**
- More detailed `connect_scope` field spec: `DEVICE_NAME, BACKEND (pyvisa|tm_devices), DEV_TYPE` — **no IP field**; MCP policy says "IP" which may be wrong
- Full block type list with params for each type (more complete than MCP policy)
- `recall` block fields: `RECALL_TYPE, FILE_PATH, REFERENCE` — with valid values listed
- `save` block fields: `SAVE_TYPE, FILE_PATH, SOURCE` — with valid values listed
- `save_screenshot` fields: `FILENAME, SCOPE_TYPE (MODERN|LEGACY)`
- Sequence connection syntax clearly shown: `<next>` tag
- Value input syntax shown: `<value name="VALUE"><shadow type="math_number">...`
- `controls_if` accepts any type (Number/String/Boolean) — Python truthy behavior noted
- "INVALID (JSON only)": `group, comment, error_check` — matches MCP
- Template with `variables` block shown

**Concrete examples in upload bd8 not in MCP policy:**
- `recall` XML example block
- `save` XML example block

### Gaps
- ❌ MCP `blockly_xml.strict.v1.md` says `connect_scope` needs "IP" field — upload bd8 shows `DEVICE_NAME, BACKEND, DEV_TYPE`. This is a **factual discrepancy** — MCP may have wrong field name
- ❌ MCP policy missing `save` and `recall` block field specs
- ❌ MCP policy missing `save_screenshot` block field spec (`SCOPE_TYPE` values)
- ❌ MCP policy missing concrete XML examples for recall/save blocks
- ❌ MCP policy missing `controls_if` any-type behavior note
- ❌ MCP policy missing `<shadow type="math_number">` value input pattern
- ⚠️ MCP policy missing `DEV_TYPE` field on `connect_scope`

---

## Section 6: Validation Checklists

### What MCP policies say
**`steps_json.strict.v1.md`** (implied via rules, no explicit checklist):  
- Flow starts with connect, ends with disconnect  
- Query steps have saveAs  
- Group steps have params:{} AND children:[]  
- IDs unique  
- Correct file extensions for recall types  

**`blockly_xml.strict.v1.md`** (no explicit checklist):  
- Unique IDs  
- VARIABLE field non-empty for scpi_query  
- Device context validated per SCPI prefix  

### What the uploads say
**Upload bd8 (Blockly+Steps combined) — explicit checklist:**
1. xmlns present, variables declared, valid types (NO group/comment/error_check in XML)
2. Unique IDs, proper nesting, root x/y
3. Connect→...→Disconnect | Query has VARIABLE
4. DEVICE_CONTEXT matches command type
5. tm_devices backend: use tm_devices_* blocks only
6. `.TSS` for full session restore, `.SET` for settings only (final emphasis)

**Upload ca8 (Steps-only) — explicit VALIDATION CHECKLIST:**
1. Valid JSON syntax (no trailing commas!)
2. Starts with connect, ends with disconnect
3. All query steps have saveAs
4. All IDs unique strings
5. Groups have params:{} AND children:[]
6. Commands verified against knowledge files
7. Output JSON codeblocks as markdown code blocks (⚠️ chat-specific, do not import)
8. If user shares Python code convert it back to JSON

### Gaps
- ❌ MCP policies have **no explicit numbered validation checklist** — everything is buried in prose rules
- ❌ MCP missing "no trailing commas" reminder (JSON syntax check)
- ❌ MCP missing explicit "convert Python to JSON" rule
- ❌ MCP Blockly policy missing explicit checklist with all 5-6 items numbered
- ✅ Upload ca8 checklist items 1-6 are good additions to MCP steps_json policy (except item 7)

---

## Section 7: Examples / Golden Patterns

### What MCP policies say
**`steps_json.strict.v1.md`:**
- 2 concrete action-shape examples (insert_step_after, replace_flow, set_step_param)  
- The `replace_flow` example is minimal (3-step: connect→write→disconnect)
- Screenshot rule with CORRECT/FORBIDDEN patterns — good

**`scpi_verification.v1.md`:**
- Measurement examples: `MEASUrement:ADDMEAS FREQ/AMP`, source, results query pattern — concrete

**No golden workflow examples** showing multi-group, measurement flow, waveform save, etc.

### What the uploads say
**Upload ca8 (Steps-only) — 3 golden patterns:**
1. **Basic Connect-Query-Disconnect** — minimal 3-step
2. **Measurement with Groups** — 8-step flow with 2 groups, channel setup + trigger + acquisition + measurements
3. **Screenshot + Waveform** — 6-step flow combining save_screenshot + save_waveform

Also references `STEPSUI_GOLDEN_EXAMPLES.json` as a knowledge file.

**Upload bd8 (Blockly+Steps combined):**
- `recall` XML block example
- `save` XML block example

### Gaps
- ❌ MCP `steps_json.strict.v1.md` **missing golden workflow examples** — the measurement-with-groups pattern and screenshot+waveform pattern from ca8 are highly valuable
- ❌ MCP `blockly_xml.strict.v1.md` missing XML block examples for recall and save
- ❌ MCP policies do not reference `STEPSUI_GOLDEN_EXAMPLES.json` as a supplementary knowledge source

---

## Section 8: Device Types

### What MCP policies say
- **Not documented in any policy file.** Device types are not listed anywhere in the 5 policy files.
- `backend_taxonomy.v1.md` mentions: MSO4/5/6, DPO5K/7K, AWG, AFG, SMU (under tm_devices support)
- `scpi_verification.v1.md` mentions: MSO5/6, MSO4/5/6/7, 5k/7k/70k (as disambiguation context)
- No top-level `deviceType` enum defined

### What the uploads say
**Upload ca8 (Steps-only):**
- Explicit **DEVICE TYPES** section: `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
- Used as top-level `"deviceType"` field in the flow template

**Upload bd8 (Blockly+Steps combined):**
- No explicit device type list, but `connect_scope` block has `DEV_TYPE` field (implied same enum)
- `save_screenshot` block has `SCOPE_TYPE (MODERN|LEGACY)` — scope-specific distinction

### Gaps
- ❌ MCP policies **entirely missing device type enum** — `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
- ❌ MCP `replace_flow` action does not include `deviceType` in flow template
- ❌ MCP `blockly_xml.strict.v1.md` does not document valid values for `connect_scope` DEV_TYPE field

---

## Summary Table

| Topic | MCP Policy | Uploads | Winner | Gap Level |
|-------|-----------|---------|--------|-----------|
| Step type list | ✅ Complete | ✅ Complete | Tie | Low |
| Step params detail | ⚠️ Partial | ✅ Full | Uploads | Medium |
| set_and_query params | ❌ Wrong field name | ✅ Correct | Uploads | HIGH |
| boundDeviceId | ❌ Missing | ✅ Present | Uploads | Medium |
| SCPI no-hallucination | ✅ Tool-aware, strong | ✅ Strong but chat-only | MCP | Low |
| SCPI search strategy | ✅ Specific + examples | ⚠️ Generic | MCP | Low |
| ACTIONS_JSON structure | ✅ Defined | ❌ Not used | MCP | N/A |
| Output format | ✅ MCP-specific | ❌ Chat (code blocks) | MCP | N/A |
| Flow template fields | ⚠️ Missing description/deviceType | ✅ Has both | Uploads | Medium |
| Backend taxonomy | ✅ Detailed + TekExpress | ⚠️ List only | MCP | Low |
| vxi11 backend | ❌ Missing | ✅ Listed | Uploads | Low |
| Blockly connect_scope fields | ❌ Wrong (IP vs DEVICE_NAME) | ✅ Correct | Uploads | HIGH |
| Blockly recall/save blocks | ❌ Missing field specs | ✅ Documented | Uploads | HIGH |
| Blockly XML examples | ❌ None | ✅ recall + save | Uploads | High |
| Validation checklist | ❌ Implicit/prose | ✅ Numbered lists | Uploads | High |
| No-trailing-commas rule | ❌ Missing | ✅ Present | Uploads | Medium |
| Golden workflow examples | ❌ Missing | ✅ 3 patterns | Uploads | HIGH |
| Device type enum | ❌ Missing | ✅ Full list | Uploads | HIGH |
| deviceType in flow | ❌ Missing | ✅ Present | Uploads | Medium |
| tm_device_command params | ❌ Missing | ✅ Documented | Uploads | Medium |
| Python→JSON conversion rule | ❌ Missing | ✅ Present | Uploads | Medium |
| MCP tool-use rules (search_scpi) | ✅ MCP-only | ❌ Not present | MCP | Must Preserve |

---

## Recommendations

### 1. REPLACE Wholesale

**`blockly_xml.strict.v1.md`** → Replace with content from upload `bd8ff4f96adb4dfd.txt`, then layer the MCP structural rules on top.

**Reason:** The current MCP blockly policy has a factual error (`connect_scope` lists "IP" field, upload says `DEVICE_NAME`), is missing `recall` and `save` block field specs, missing `save_screenshot` field spec, missing concrete XML examples, and has no `DEV_TYPE` documentation. Upload bd8 is significantly more complete and operationally correct.

**What to add back after replacing:** Keep the "Backend Rules" section (tm_devices → tm_devices_* only) as it's MCP-relevant.

---

### 2. SUPPLEMENT (Preserve Core, Add From Uploads)

**`steps_json.strict.v1.md`** → Keep MCP structure/action-shapes, ADD from uploads:
- `set_and_query` correct param shape: `{command:"...", cmdParams:[], paramValues:{}}`  
- `save_screenshot` `method: "pc_transfer"` field
- `error_check`, `comment`, `python`, `tm_device_command` param specs
- `boundDeviceId` multi-device field
- Group ID naming convention (`"g1"`, `"g2"`)
- Device type enum: `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
- Add `"deviceType"` and `"description"` to `replace_flow` template
- Explicit numbered validation checklist (items 1-6 from upload ca8, **excluding** item 7)
- Python→JSON conversion rule
- "No trailing commas" JSON validity reminder
- Three golden workflow examples from upload ca8

**`response_format.v1.md`** → Supplement with:
- Rule: "If user shares Python code, convert it to JSON — never output Python unless explicitly requested"
- Make ACTIONS_JSON example more explicit (show all 4 keys populated with sample data)

**`backend_taxonomy.v1.md`** → Supplement with:
- Add `vxi11` as named backend: "vxi11 is used automatically by pyvisa when ::INSTR suffix is used; rarely needs explicit selection"

**`scpi_verification.v1.md`** → Supplement with:
- Add knowledge-file list as background context (mso_2_4_5_6_7.json, etc.) so model understands what backs the tools
- Add post-generation validation reminder: "After generating all steps, verify every SCPI command string appears in the tool results used during this session"

---

### 3. MCP-Specific Tool-Use Rules: MUST PRESERVE

These rules exist **only in the MCP policy** and have no equivalent in the chat prompts. They are critical and must not be lost:

| Rule | Location | Why Preserve |
|------|----------|--------------|
| `Call search_scpi or get_command_by_header BEFORE emitting any SCPI command` | `scpi_verification.v1.md` + `buildSystemPrompt()` hardcoded | Core MCP tool loop — chat has no equivalent |
| `If tool returns ok:true with non-empty data → commands ARE verified` | `scpi_verification.v1.md` | Prevents false "could not verify" responses when tool succeeds |
| `Use EXACT syntax from tool results: syntax.set / syntax.query / codeExamples[].scpi.code` | `scpi_verification.v1.md` | Maps tool output fields to command generation |
| `codeExamples[].tm_devices.code` for tm_devices backend | `scpi_verification.v1.md` | tm_devices code extraction from tool results |
| `commandId + sourceFile as provenance` | `scpi_verification.v1.md` | Traceability — chat prompts don't need this |
| `Do not say "I could not verify" when verified results ARE present` | `scpi_verification.v1.md` | Prevents false negatives after successful tool calls |
| `TekExpress: pyvisa + SOCKET port 5000, TEKEXP:* commands, no *OPC? → TEKEXP:STATE? polling` | `backend_taxonomy.v1.md` | TekExpress-specific behavior not in any upload |
| `ACTIONS_JSON output format` (vs raw code blocks) | `response_format.v1.md` | MCP UI expects this exact format — chat uses raw JSON |
| `insert_step_after, set_step_param, remove_step, replace_flow, add_error_check_after_step` action types | `response_format.v1.md` | MCP action dispatch — no chat equivalent |
| `targetStepId: null = insert at beginning` | `steps_json.strict.v1.md` | MCP action detail |
| `maxCalls = 4` tool loop budget (implicit) | `toolLoop.ts` | Not in prompts, but system invariant |

---

### 4. Specific File Changes Needed

#### `mcp-server/policies/blockly_xml.strict.v1.md`
**Action: REPLACE** (base on upload bd8, keep MCP backend rules)

Changes:
1. Fix `connect_scope` fields: `DEVICE_NAME, BACKEND (pyvisa|tm_devices), DEV_TYPE` (remove erroneous "IP" field)
2. Add `DEV_TYPE` valid values: `SCOPE | AWG | AFG | PSU | SMU | DMM | DAQ | MT | MF | SS`
3. Add `recall` block field spec: `RECALL_TYPE (FACTORY|SETUP|SESSION|WAVEFORM), FILE_PATH, REFERENCE`
4. Add `save` block field spec: `SAVE_TYPE (SETUP|SESSION|WAVEFORM|IMAGE), FILE_PATH, SOURCE`
5. Add `save_screenshot` block field spec: `FILENAME, SCOPE_TYPE (MODERN|LEGACY)`
6. Add `<shadow type="math_number">` value input pattern to structural rules
7. Add `controls_if` any-type behavior note
8. Add concrete recall and save XML examples section
9. Add explicit numbered validation checklist

#### `mcp-server/policies/steps_json.strict.v1.md`
**Action: SUPPLEMENT** (keep all MCP action shapes, add missing content)

Changes:
1. Fix `set_and_query` params: `{command:"...", cmdParams:[], paramValues:{}}` (not `queryCommand`)
2. Add `method: "pc_transfer"` to `save_screenshot` params
3. Document params for: `error_check {command:"ALLEV?"}`, `comment {text:"..."}`, `python {code:"..."}`, `tm_device_command {code:"...", model:"...", description:"..."}`
4. Add `boundDeviceId` documentation
5. Add group ID naming convention
6. Add device type enum section
7. Update `replace_flow` template to include `"deviceType"` and `"description"`
8. Add explicit numbered validation checklist (items 1-6 from upload ca8, excluding "output code blocks")
9. Add "If user shares Python code, convert to JSON" rule
10. Add "no trailing commas" reminder
11. Add 3 golden workflow examples (Connect-Query-Disconnect, Measurement with Groups, Screenshot+Waveform)

#### `mcp-server/policies/response_format.v1.md`
**Action: SUPPLEMENT** (minor additions)

Changes:
1. Add rule: "If user shares Python code → convert to JSON; do not output Python unless explicitly requested"
2. Add concrete populated ACTIONS_JSON example showing all 4 keys with sample data

#### `mcp-server/policies/backend_taxonomy.v1.md`
**Action: SUPPLEMENT** (one addition)

Changes:
1. Add `vxi11` entry: "vxi11 is used automatically by pyvisa with ::INSTR suffix; rarely needs explicit selection by user"

#### `mcp-server/policies/scpi_verification.v1.md`
**Action: SUPPLEMENT** (two additions)

Changes:
1. Add knowledge-file reference list as background context for what backs the tools
2. Add post-generation check: "After building all steps, scan every SCPI command string — each must have been returned in a tool result during this session; if not, call search_scpi before finalizing"

---

### 5. Priority Order

| Priority | File | Action | Impact |
|----------|------|--------|--------|
| 🔴 P0 | `blockly_xml.strict.v1.md` | REPLACE | Fixes factual error + adds missing block specs |
| 🔴 P0 | `steps_json.strict.v1.md` | SUPPLEMENT | Fixes set_and_query + adds golden examples + device types |
| 🟡 P1 | `scpi_verification.v1.md` | SUPPLEMENT | Adds knowledge-file context + post-gen check |
| 🟡 P1 | `response_format.v1.md` | SUPPLEMENT | Python→JSON rule + better example |
| 🟢 P2 | `backend_taxonomy.v1.md` | SUPPLEMENT | vxi11 clarification |

