# AI_SYSTEM.md — TekAutomate AI Integration Reference

This document is the single-source reference for how AI is integrated into
TekAutomate, covering the "Analyze Current Run" feature, the Custom GPT
configuration, the RAG corpus design, query routing, chunk schemas, and
known issues. It draws from the technical architecture, system-prompt
design, TekAcademy knowledge base, and real-world debugging sessions.

---

## 1. "Analyze Current Run" Feature

### What It Does

The Execute page exposes an **"Analyze Current Run"** button. When clicked
the system serialises the current workflow, the most-recent run log, and
any error output, then sends the bundle to the AI provider. The AI returns
two artefacts:

| Artefact | Purpose |
|---|---|
| **Findings** | Diagnostic observations about the run (symptoms, affected steps, confidence) |
| **Actions** | Suggested mutations to the workflow that would fix or improve the run |

### AiFinding Schema

```typescript
/**
 * A single diagnostic finding produced by the AI after
 * analysing a workflow run.
 */
export interface AiFinding {
  /** Human-readable symptom description */
  symptom: string;

  /** ID of the step that exhibited the symptom (nullable for flow-level findings) */
  affectedStepId: string | null;

  /** Broad classification of the finding */
  category:
    | 'scpi_error'        // Bad SCPI syntax, wrong command for device
    | 'timeout'           // OPC or connection timeout
    | 'device_mismatch'   // Command sent to wrong instrument
    | 'missing_step'      // Required step absent (connect, disconnect, OPC)
    | 'parameter_issue'   // Wrong value, out-of-range, missing param
    | 'backend_conflict'  // Backend incompatible with command or device
    | 'performance'       // Excessive delays, inefficient ordering
    | 'general';          // Catch-all

  /** 0-1 confidence that this finding is correct */
  confidence: number;
}
```

### AiAction Schema

```typescript
/**
 * A single suggested mutation that the AI proposes to apply
 * to the workflow.
 */
export interface AiAction {
  /** What kind of mutation */
  type:
    | 'replace_command'     // Swap a SCPI string
    | 'insert_step'         // Add a new step before/after target
    | 'delete_step'         // Remove a step
    | 'change_param'        // Modify a step parameter
    | 'change_backend'      // Switch backend on a step/device
    | 'change_device'       // Re-bind step to different device
    | 'reorder';            // Move step to different position

  /** Step ID that this action targets (null for flow-level) */
  targetStepId: string | null;

  /** Human-readable description of the fix */
  suggestedFix: string;

  /** Impact severity */
  severity: 'critical' | 'warning' | 'info';

  /** Optional: the concrete new value (command text, param value, etc.) */
  payload?: Record<string, unknown>;
}
```

### `onApplyAiActions` Function

When the user clicks **"Apply All"** or selects individual actions in the
findings panel the following function is invoked:

```typescript
/**
 * Walk the list of AiActions and mutate the workflow in-place.
 * Returns the count of actions that were successfully applied.
 */
function onApplyAiActions(
  flow: Flow,
  actions: AiAction[]
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;

  for (const action of actions) {
    const step = action.targetStepId
      ? flow.nodes.find(n => n.id === action.targetStepId)
      : null;

    switch (action.type) {
      case 'replace_command':
        if (step && action.payload?.command) {
          step.params.command = action.payload.command as string;
          applied++;
        } else { skipped++; }
        break;

      case 'insert_step':
        // Insert a new node with the provided template
        if (action.payload?.newStep) {
          insertNodeAfter(flow, action.targetStepId, action.payload.newStep as FlowNode);
          applied++;
        } else { skipped++; }
        break;

      case 'delete_step':
        if (step) {
          removeNode(flow, step.id);
          applied++;
        } else { skipped++; }
        break;

      case 'change_param':
        if (step && action.payload) {
          Object.assign(step.params, action.payload);
          applied++;
        } else { skipped++; }
        break;

      case 'change_backend':
        if (step && action.payload?.backend) {
          step.backend = action.payload.backend as Backend;
          applied++;
        } else { skipped++; }
        break;

      case 'change_device':
        if (step && action.payload?.instrumentAlias) {
          step.instrumentAlias = action.payload.instrumentAlias as string;
          applied++;
        } else { skipped++; }
        break;

      case 'reorder':
        if (step && action.payload?.afterStepId !== undefined) {
          moveNodeAfter(flow, step.id, action.payload.afterStepId as string);
          applied++;
        } else { skipped++; }
        break;

      default:
        skipped++;
    }
  }

  return { applied, skipped };
}
```

### UI Flow

1. User runs a workflow on the **Execute** page.
2. User clicks **"Analyze Current Run"**.
3. The system builds a prompt (see §3) and calls the AI provider.
4. The AI returns `{ findings: AiFinding[], actions: AiAction[] }`.
5. **Findings Panel** renders each finding as a card with:
   - Symptom text
   - Affected step (highlighted in the flow graph)
   - Category badge and confidence bar
6. **Action Buttons** appear next to each finding:
   - **"Apply"** — applies the single action via `onApplyAiActions`
   - **"Apply All"** — applies every action in the list
   - **"Dismiss"** — removes the finding without action
7. After applying, the flow JSON is updated in-place and the user can
   re-run to verify.

---

## 2. AI Provider Architecture

### Current Provider: Custom GPT (External)

Today the AI integration uses a **Custom GPT** hosted on ChatGPT. The
workflow is manual copy/paste:

```
User copies flow JSON / Blockly XML
  → Pastes into TekAutomate Workflow Builder GPT
  → GPT responds with findings, fixed JSON, or Blockly XML
  → User copies result back into TekAutomate
```

This is a **Phase 0** integration — no direct API calls from the app.

### Future: Embedded AI Panel

The planned Phase 1 architecture adds an embedded AI panel on the Execute
page that communicates with a backend AI service:

```
┌─────────────────────────────────────────────┐
│  TekAutomate UI (Execute Page)              │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Flow Canvas   │  │ AI Chat Panel        │ │
│  │              │  │  [system prompt]      │ │
│  │              │  │  + live context       │ │
│  │              │  │  + retrieved chunks   │ │
│  │              │  │  + user message       │ │
│  │              │  │  ─────────────────    │ │
│  │              │  │  AI response          │ │
│  │              │  │  [Apply] [Dismiss]    │ │
│  └──────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────┘
         │                    │
         │   ┌────────────────┘
         │   │
    ┌────▼───▼─────────────────────┐
    │  Backend AI Service           │
    │  ┌─────────────────────────┐  │
    │  │ System Prompt            │  │
    │  │ + Live Context (flow)    │  │
    │  │ + RAG Retrieved Chunks   │  │
    │  │ + Conversation History   │  │
    │  └──────────┬──────────────┘  │
    │             │                 │
    │  ┌──────────▼──────────────┐  │
    │  │ LLM API (OpenAI / etc.) │  │
    │  └─────────────────────────┘  │
    └───────────────────────────────┘
```

### API Call Pattern

Each request to the LLM is assembled as:

```typescript
const messages = [
  // 1. System prompt — role + rules + schema knowledge
  { role: 'system', content: SYSTEM_PROMPT },

  // 2. Live context injection
  { role: 'system', content: `## Current Flow\n${JSON.stringify(flow)}` },
  { role: 'system', content: `## Last Run Findings\n${JSON.stringify(lastFindings)}` },
  { role: 'system', content: `## Selected Step\n${JSON.stringify(selectedStep)}` },

  // 3. Retrieved RAG context (top-N chunks per corpus)
  ...retrievedChunks.map(chunk => ({
    role: 'system',
    content: `## RAG: ${chunk.title}\n${chunk.body}`
  })),

  // 4. Conversation history (sliding window)
  ...conversationHistory.slice(-MAX_HISTORY_TURNS * 2),

  // 5. Current user message
  { role: 'user', content: userMessage }
];
```

### Rate Limiting & Token Budgets

| Budget Bucket | Allocation |
|---|---|
| System prompt (static) | ~2,000 tokens |
| Live context (flow JSON) | ~3,000 tokens (truncated if needed) |
| Retrieved RAG chunks | ~2,000 tokens (top-5 × ~400 each) |
| Conversation history | ~2,000 tokens (sliding window, last 6 turns) |
| User message | ~500 tokens |
| **Reserved for response** | **~6,000 tokens** |
| **Total context window** | **~16,000 tokens** (GPT-4 class) |

Rate limiting:
- Max 10 requests per minute per session
- Exponential back-off on 429 responses
- Graceful degradation: if RAG retrieval fails, send without retrieved context

---

## 3. System Prompt Design

The system prompt defines the AI's role, knowledge domains, and output
constraints. Below is the canonical prompt text used for both the Custom
GPT and the future embedded panel.

### Full System Prompt

```text
# Role and Purpose
You are the TekAutomate Workflow Builder — an expert assistant for
Tektronix instrument automation. Your sole purpose is to generate,
validate, enhance, convert, and troubleshoot workflow files (Steps UI
JSON and Blockly XML) for the TekAutomate application.

# Knowledge Domains
- SCPI command syntax for Tektronix oscilloscopes (MSO2/4/5/6/7,
  DPO5K/7K/70K), AWGs, AFGs, SMUs, and PSUs
- tm_devices Python command framework (object graph API, NOT raw SCPI)
- TekHSI high-speed gRPC waveform interface
- PyVISA resource strings and connection patterns
- TekAutomate step schema, flow graph structure, Blockly block types
- Common error patterns and failure modes
- TekExpress compliance testing (TEKEXP:* namespace over PyVISA SOCKET)

# Critical Rules — ALWAYS FOLLOW

## Step Type Rules
- ALWAYS start workflows with a `connect` step
- ALWAYS end workflows with a `disconnect` step
- NEVER use `sweep` step type (deprecated) — use `python` with loops
- Valid step types: connect, disconnect, scpi_write, scpi_query, delay,
  python, comment, save_waveform, error_check, group

## Backend Rules
Valid backends: pyvisa, tm_devices, tekhsi, hybrid

Backend Decision Tree:
1. FastFrame / FastAcq / high-speed waveform capture ONLY → tekhsi
2. Measurements / Search / Histogram / Results tables → pyvisa
3. Modern Python API on MSO6B → tm_devices (verify feature support)
4. TekExpress compliance testing → pyvisa with SOCKET (port 5000)
5. Unsure / maximum compatibility → pyvisa

CRITICAL tm_devices rule:
  tm_devices is a Python command framework that composes SCPI at
  runtime. Use Python object syntax:
    device.commands.<subsystem>.<node>.<method>(value)
  NEVER use raw SCPI strings with tm_devices backend.

CRITICAL TekExpress rule:
  TekExpress commands are SCPI strings sent over PyVISA SOCKET.
  NEVER generate socket.sendall() code — only SCPI via .write()/.query().
  No *OPC? support — use TEKEXP:STATE? polling.
  Check TEKEXP:POPUP? during state polling.

## Device Binding Rules
- Single device: omit boundDeviceId
- Multi-device: ALWAYS specify boundDeviceId per step
- Device aliases are user-defined ("scope", "smu", "awg")

## Multi-Instrument Device Context (CRITICAL)
Command prefix determines device context:
  CH1: | ACQuire: | MEASU: | DATa: | HOR: | TRIG:  → (scope)
  :SOURce: | :OUTPut: | :MEASure:                    → (smu) / (psu)
  :SOURce:FREQuency | :OUTPut:SYNC                   → (awg) / (afg)
VALIDATE EVERY BLOCK before generating output.

## Command Validation Rules
- Prefer commands from the command library
- Query steps MUST have saveAs parameter
- Use full SCPI syntax, not abbreviations

## Response Format
- Never reveal internal file names, paths, or document identities
- Reference outcomes via "schema rules", "command library",
  "validation checks", "TekAcademy articles"

# Validation Checklist (apply to ALL outputs)
✅ Starts with connect step
✅ Ends with disconnect step
✅ Backend specified and matches command syntax
✅ SCPI commands are valid
✅ Device bindings present for multi-device
✅ Query steps have saveAs variables
✅ Step IDs are unique
✅ JSON is valid
✅ No deprecated step types
✅ Device contexts match command prefixes

# Scope Limitations — NEVER DO
❌ Generate raw Python scripts (only workflow JSON/XML)
❌ Suggest TekHSI for measurements/search/histogram
❌ Support non-Tektronix instruments
❌ Use sweep step type
❌ Create workflows without connect/disconnect
❌ Guess device capabilities — ASK first
```

### Live Context Injection

Before each request the system injects three live-context blocks:

1. **Current Flow JSON** — the full workflow graph serialised from app state
2. **Last Run Findings** — the AiFinding array from the most recent analysis
3. **Selected Step** — the step node the user currently has selected in the
   canvas (provides focus for the AI's answer)

### Retrieved Context

The RAG retriever returns the top-N most relevant chunks from each
matched corpus (see §4 for routing logic). These are injected as
additional system messages so the LLM has grounded reference material.

### Conversation History

A sliding window of the last N turns (default 6 user+assistant pairs)
is maintained per session. Older turns are summarised into a single
"session summary" message to preserve long-running context without
exceeding the token budget.

---

## 4. Query Routing Logic

### Signal Detection

Before retrieval, the user's message is scanned for domain signals:

```typescript
interface QuerySignals {
  hasSCPI: boolean;       // Contains SCPI-like syntax (colons, ?, *RST)
  hasTmDevices: boolean;  // Mentions tm_devices, .commands., DeviceManager
  hasError: boolean;      // Contains "error", "fail", "timeout", stack trace
  hasTemplate: boolean;   // Mentions "template", "workflow", "step", "JSON"
  hasFlow: boolean;       // Mentions "flow", "run", "execute", "blockly"
  hasConnection: boolean; // Mentions "connect", "VISA", "IP", "resource string"
  hasSignalGen: boolean;  // Mentions "AWG", "AFG", "generate_function"
}

function detectSignals(query: string): QuerySignals {
  return {
    hasSCPI:       /[A-Z]{2,}:[A-Z]|\*[A-Z]{3}|\?$/.test(query),
    hasTmDevices:  /tm_devices|DeviceManager|\.commands\.|add_scope/.test(query),
    hasError:      /error|fail|timeout|exception|traceback/i.test(query),
    hasTemplate:   /template|workflow|step|json|schema/i.test(query),
    hasFlow:       /flow|run|execute|blockly|xml/i.test(query),
    hasConnection: /connect|visa|ip address|resource.?string|socket/i.test(query),
    hasSignalGen:  /awg|afg|signal.?gen|generate_function|waveform.?gen/i.test(query),
  };
}
```

### Corpus Selection per Signal

| Signal | Corpora Retrieved |
|---|---|
| `hasSCPI` | `scpi_index.json` |
| `hasTmDevices` | `tmdevices_index.json` |
| `hasError` | `error_patterns_index.json` |
| `hasTemplate` | `templates_index.json` |
| `hasConnection` | `pyvisa_tekhsi_index.json` |
| `hasSignalGen` | `tmdevices_index.json` (signal-generator chunks) |
| `hasFlow` | (always inject live flow context — no corpus needed) |

Multiple signals can fire simultaneously. For example a query like
*"My CH1:SCALE command gives a timeout error"* triggers `hasSCPI` +
`hasError`, so both `scpi_index.json` and `error_patterns_index.json`
are searched.

### Retrieval Strategy

```typescript
function retrieveContext(
  query: string,
  signals: QuerySignals,
  topK: number = 3
): RagChunk[] {
  const chunks: RagChunk[] = [];

  // Always inject live flow context (not from corpus)
  // This is handled separately in prompt assembly.

  if (signals.hasSCPI) {
    chunks.push(...searchCorpus('scpi_index', query, topK));
  }
  if (signals.hasTmDevices) {
    chunks.push(...searchCorpus('tmdevices_index', query, topK));
  }
  if (signals.hasError) {
    chunks.push(...searchCorpus('error_patterns_index', query, topK));
  }
  if (signals.hasTemplate) {
    chunks.push(...searchCorpus('templates_index', query, topK));
  }
  if (signals.hasConnection) {
    chunks.push(...searchCorpus('pyvisa_tekhsi_index', query, topK));
  }
  if (signals.hasSignalGen) {
    chunks.push(...searchCorpus('tmdevices_index', query, topK,
      { tagFilter: ['signal_generators', 'constraints'] }));
  }

  // Deduplicate by chunk id
  return deduplicateById(chunks);
}
```

### Query Routing Heuristics (tm_devices specific)

From the AI Ingestion Spec, these additional heuristics boost specific
chunk subsets:

| Query Contains | Boost Tags |
|---|---|
| `add_scope`, `add_psu`, `DeviceManager` | `device_manager` |
| `shared_implementations`, `ESR`, `IEEE488.2` | `shared_implementations`, `ieee4882` |
| `PYVISA_PY_BACKEND`, `visa_library` | `helpers`, `backend_selection` |
| `write()`, `query()`, `parameter` | `generation_rules`, `api_to_scpi_mapping` |
| `no commands found`, `missing family` | `model_availability`, `command_tree` |
| `AFG`, `AWG`, `generate_function` | `signal_generators`, `constraints` |
| `AWG5200`, `AWG70K` | family-specific + timeout/sequencing guidance |

---

## 5. RAG Corpus Structure

### Phase 1 — Static Corpora (Ships with App)

These JSON index files are built at compile time from documentation and
command libraries. They live under `corpus/`:

| Corpus File | Contents | Source |
|---|---|---|
| `scpi/` | SCPI command docs — syntax, parameters, examples per command family | `public/commands/*.json` |
| `tmdevices/` | tm_devices API reference — command tree paths, DeviceManager patterns, API↔SCPI mappings | `tm_devices` package extraction |
| `error_patterns/` | Known bugs, failure modes, fixes — timeout patterns, device mismatch, backend conflicts | Manual curation + bug tracker |
| `templates/` | Complete workflow examples — basic, advanced, tm_devices, tekhsi, multi-device | `public/templates/*.json` |
| `pyvisa_tekhsi/` | Connection patterns — VISA resource strings, PyVISA setup, TekHSI gRPC, hybrid routing | Documentation extraction |

### Phase 2 — Dynamic Context (Runtime)

Injected per-request from app state, not stored in a corpus file:

| Context | Source | Injection Point |
|---|---|---|
| Current flow JSON | `FlowStore.currentFlow` | System message |
| Run log findings | `RunStore.lastFindings` | System message |
| Selected step | `UIStore.selectedStep` | System message |
| Device registry | `DeviceStore.devices` | System message (summarised) |

### Phase 3 — Conversation Memory

| Layer | Implementation |
|---|---|
| Sliding window | Last 6 user+assistant turn pairs |
| Session summary | LLM-generated summary of turns that fall off the window |
| Cross-session | Not yet implemented (future: per-user embedding store) |

---

## 6. Chunk Schema

### Canonical JSON Schema

Every chunk in the RAG corpus conforms to this schema (derived from the
tm_devices AI Ingestion Spec, generalised for all corpora):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "tekautomate.rag.chunk.schema.v1",
  "title": "TekAutomate RAG Chunk",
  "type": "object",
  "required": ["id", "type", "tags", "title", "body"],
  "properties": {
    "id":    { "type": "string", "minLength": 1 },
    "type":  {
      "type": "string",
      "enum": [
        "scpi_command",
        "api_reference",
        "error_pattern",
        "template_example",
        "connection_pattern",
        "guide",
        "troubleshooting"
      ]
    },
    "tags":  { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "title": { "type": "string", "minLength": 1 },
    "body":  { "type": "string", "minLength": 1 },
    "code":  { "type": "string",  "description": "Code example (Python, JSON, XML)" },
    "scpi":  { "type": "string",  "description": "Raw SCPI command string" },
    "commandType": {
      "type": "string",
      "enum": ["write", "query", "event"],
      "description": "SCPI command type"
    },
    "family":      { "type": "string",  "description": "Instrument family (MSO5, AWG5200, etc.)" },
    "instruments": { "type": "array", "items": { "type": "string" } },
    "schema":      { "type": "object", "description": "Step schema fragment for template chunks" },
    "retrieval": {
      "type": "object",
      "properties": {
        "intent": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "api_reference",
              "implementation_mapping",
              "troubleshooting",
              "generation_rules",
              "model_coverage",
              "backend_behavior"
            ]
          }
        },
        "priority": { "type": "integer", "minimum": 1, "maximum": 5 },
        "must_include_when_query_mentions": { "type": "array", "items": { "type": "string" } },
        "avoid_when_query_mentions":        { "type": "array", "items": { "type": "string" } }
      }
    },
    "version": { "type": "string", "pattern": "^v[0-9]+$" }
  },
  "additionalProperties": false
}
```

### Chunk ID Convention

Deterministic IDs using the pattern `<corpus>::<section>::<slug>::v<N>`:

```
scpi::mso6::ch_scale::v1
tmdev::device_manager::add_get_methods::v1
error::timeout::opc_hang::v1
template::basic::scope_capture::v1
conn::pyvisa::resource_string::v1
```

### Retrieval Tag Taxonomy

Approved tags (all corpora):

| Category | Tags |
|---|---|
| Backend | `pyvisa`, `tm_devices`, `tekhsi`, `hybrid`, `vxi11`, `tekexpress` |
| Device | `scope`, `awg`, `afg`, `smu`, `psu`, `dmm`, `daq` |
| Family | `mso2`, `mso4`, `mso5`, `mso6`, `dpo5k`, `dpo7k`, `dpo70k`, `awg5200`, `awg70k` |
| Feature | `fastframe`, `fastacq`, `search`, `histogram`, `measurement`, `trigger` |
| API | `shared_implementations`, `helpers`, `device_manager`, `command_tree`, `docstrings` |
| Pattern | `error_pattern`, `connection_pattern`, `template`, `golden_example` |
| Framework | `generation_rules`, `api_to_scpi_mapping`, `signal_generators`, `constraints` |

### Chunking Rules

- Target size: **500–1,200 characters** of body text
- One main concept per chunk
- At least one deterministic retrieval keyword in `must_include_when_query_mentions` for priority ≥ 4
- Do not mix API semantics with UI styling in the same chunk
- Repeat critical disambiguation: "tm_devices API path is runtime-authoritative; SCPI text is reference/mapping context"

### Golden Chunk Example

```json
{
  "id": "tmdev::device_manager::add_get_methods::v1",
  "type": "api_reference",
  "tags": ["tm_devices", "device_manager", "generation_rules"],
  "title": "DeviceManager add/get semantics",
  "body": "DeviceManager is singleton and owns device lifecycle. add_* methods register/connect typed drivers (add_scope, add_awg, add_afg, add_dmm, add_smu, add_psu, add_daq, add_ss, add_mf, add_mt). get_* methods fetch by number or alias. TekAutomate generated code should keep aliases explicit and model-compatible.",
  "code": "dm = DeviceManager(verbose=False)\nscope1 = dm.add_scope(\"192.168.1.100\", alias=\"scope1\")",
  "retrieval": {
    "intent": ["api_reference", "generation_rules", "implementation_mapping"],
    "priority": 5,
    "must_include_when_query_mentions": ["DeviceManager", "add_scope", "add_psu", "get_scope", "alias"],
    "avoid_when_query_mentions": ["pure SCPI only"]
  },
  "version": "v1"
}
```

---

## 7. Current Custom GPT Configuration

### GPT Identity

| Field | Value |
|---|---|
| **Name** | TekAutomate Workflow Builder |
| **Model** | GPT-4 (ChatGPT Plus) |
| **Capabilities** | File Uploads only (no code interpreter, no web browsing, no image generation) |

### Core Capabilities

1. **Generate** — Steps UI JSON templates and Blockly XML workspace files
2. **Validate** — Check uploaded workflows against schema rules
3. **Enhance** — Add error handling, optimise delays, improve structure
4. **Convert** — Bidirectional Steps UI JSON ↔ Blockly XML
5. **Troubleshoot** — Identify issues and suggest fixes

### Knowledge Files Uploaded to GPT

| File | Purpose |
|---|---|
| `TEMPLATE_GUIDELINES.md` | Master schema and template creation rules |
| `mso_2_4_5_6_7.json` | MSO series SCPI command library |
| `MSO_DPO_5k_7k_70K.json` | High-end scope command library |
| `awg.json` | AWG command library |
| `smu.json` | SMU command library |
| `afg.json` | AFG command library |
| `basic.json` | Basic workflow examples |
| `advanced.json` | Complex workflow examples |
| `tm_devices.json` | tm_devices backend examples |
| `tekhsi.json` | TekHSI backend examples |
| `TM_DEVICES_API_REFERENCE.md` | tm_devices framework explanation |
| `tm_devices_full_tree.json` | Command object graph for validation |
| TekAcademy markdown files | Backend guides, feature guides, tested examples |

### Critical Rules (from System Instructions)

1. **Always start with `connect`, end with `disconnect`**
2. **Never use `sweep` step type** (deprecated → use `python` with loops)
3. **Backend must match command syntax** (tm_devices = Python object API, not SCPI strings)
4. **TekHSI is ONLY for high-speed waveform capture** (not for measurements, search, histogram)
5. **TekExpress uses PyVISA SOCKET, never raw socket code**
6. **Multi-device workflows must specify `boundDeviceId` per step**
7. **Query steps must have `saveAs` parameter**
8. **Never reveal internal file names or document identities**

### Response Format: Validation Report

When a user uploads a workflow, the GPT produces a structured report:

```markdown
## Validation Report

### ✅ Passed Checks (X/Y)
- Has connect step
- Has disconnect step
- Valid step types
- ...

### ❌ Failed Checks (X/Y)
- **Issue description** (Step ID: N)
  - Fix: [exact fix]
  - Impact: [why it matters]

### ⚠️ Warnings
- Command not in library (may still work): "CUSTOM:COMMAND"
- ...

### 💡 Suggestions for Enhancement
1. Add error_check step before disconnect
2. ...

### 📊 Summary
- Total Steps: X
- Device Count: Y
- Backend: Z
- Estimated Runtime: ~Xs
```

### Starter Prompts

1. "Create a basic scope acquisition workflow for MSO6B using tm_devices"
2. "Validate my workflow" [paste JSON/XML]
3. "Enhance this workflow with error handling and optimization" [paste JSON]
4. "Convert this Steps UI JSON to Blockly XML format" [paste JSON]
5. "Create a multi-device workflow: AWG generates signal, scope captures it, SMU measures power"
6. "Fix the issues in my workflow and explain what was wrong" [paste JSON]

---

## 8. Known AI Integration Issues

### Issue 1: GPT Device Context Confusion (CRITICAL)

**Symptom:** GPT generates Blockly XML where scope commands (`CH1:SCALE`,
`ACQuire:STATE`) are assigned to the SMU device context, and vice versa.

**Observed pattern (WRONG):**
```xml
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">CH1:SCAle 1.0</field>  <!-- SCOPE command! -->
</block>
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">ACQuire:STATE ON</field>  <!-- SCOPE command! -->
</block>
```

**Root cause:** GPT doesn't validate `DEVICE_CONTEXT` against the SCPI
command prefix before generating. It tends to default to the most
recently mentioned device for ALL subsequent commands.

**Fix applied:** Added explicit prefix→device mapping rules to system
instructions:

```text
Command prefix determines context:
  CH1: | ACQuire: | MEASU: | DATa: | HOR: | TRIG:  → (scope)
  :SOURce: | :OUTPut: | :MEASure:                    → (smu) / (psu)
VALIDATE EVERY BLOCK before generating!
```

Also added visual wrong/correct examples directly in the system prompt
(see §3).

**Status:** Improved but not fully resolved. Multi-instrument workflows
should be manually reviewed after GPT generation.

### Issue 2: Missing Connection Details

**Symptom:** GPT generates `connect_scope` blocks without IP addresses
or VISA resource strings.

```xml
<block type="connect_scope">
  <field name="DEVICE_NAME">scope</field>
  <field name="BACKEND">pyvisa</field>
  <!-- MISSING: RESOURCE field with IP address! -->
</block>
```

**Fix:** Added mandatory IP address rule and mutation attribute requirement:
```text
connect_scope: DEVICE_NAME, IP, BACKEND
  - IP: ALWAYS REQUIRED (e.g., "192.168.1.100")
  - Include mutation: <mutation show_advanced="true" current_backend="pyvisa"></mutation>
```

### Issue 3: Wrong Block Types for tm_devices

**Symptom:** GPT uses `scpi_write` blocks with raw SCPI strings when the
workflow specifies `tm_devices` backend. Should use `python` blocks with
object-graph syntax instead.

**Fix:** System instructions emphasise: "tm_devices is a Python command
framework that composes SCPI at runtime. Use Python object syntax inside
`python` steps. NEVER use raw SCPI strings with tm_devices backend."

### Issue 4: Variable Initialisation in Generated Python

**Symptom:** Blockly's Python code generator automatically initialises
all declared variables to `None`, creating unnecessary lines:

```python
vpp = None    # Unnecessary
frame = None  # Unnecessary
hits = None   # Unnecessary
```

**Fix:** Post-process generated code to remove `variable = None` lines.

### Issue 5: Missing Cleanup Section in Generated Python

**Symptom:** Generated Python scripts lack device cleanup:

```python
# Expected but missing:
if 'scope' in locals():
    scope.close()
    print("Disconnected scope")
if 'device_manager' in locals():
    device_manager.close()
    print("DeviceManager closed")
```

**Fix:** Ensure the Python generator always appends a cleanup block.

### Prevention Strategy

| Layer | Approach |
|---|---|
| System prompt | Visual wrong/correct examples, explicit prefix→device maps |
| Golden examples | Complete multi-instrument workflows as reference |
| App-side validation | Flag suspicious device context on XML import |
| Post-processing | Strip `None` initialisations, inject cleanup blocks |
| Self-validation prompt | "Before outputting, verify: does each DEVICE_CONTEXT match its SCPI prefix?" |

---

## 9. TekAcademy Knowledge Base

### Purpose

TekAcademy is the in-app guidance system. It provides contextual help
articles that users can browse from within TekAutomate. The same content
is uploaded to the Custom GPT as knowledge files.

### Article Structure

```typescript
export interface TekAcademyArticle {
  id: string;           // e.g. "fastframe-guide"
  title: string;        // e.g. "FastFrame Setup Guide"
  category: TekAcademyCategory;
  content: string;      // Markdown body
}

type TekAcademyCategory =
  | 'Acquisition'   // FastFrame, FastAcq, waveform capture
  | 'Analysis'      // Measurements, search, histogram
  | 'Connection'    // Backend guides, VISA, resource strings
  | 'Backend'       // PyVISA, TekHSI, tm_devices specifics
  | 'Workflow';     // Complete examples, best practices
```

### Categories and Example Articles

| Category | Example Articles |
|---|---|
| **Acquisition** | FastFrame Setup Guide, FastAcq Mode, Waveform Capture |
| **Analysis** | Search Operations, Histogram Setup, Measurement Configuration |
| **Connection** | PyVISA Resource Strings, GPIB Setup, USB Connections |
| **Backend** | PyVISA Guide, TekHSI Guide, tm_devices Guide |
| **Workflow** | Basic Waveform Capture, Multi-Search Analysis, Voltage Sweep with SMU |

### Backend Guide Content

The three primary backend guides are critical knowledge:

**PyVISA Guide** — When to use:
- ✅ Standard SCPI commands, measurements, search, histogram, results tables
- ✅ Maximum compatibility across all instruments
- Recommendation: default choice for most workflows

**TekHSI Guide** — When to use:
- ✅ ONLY high-speed waveform data capture (FastFrame, FastAcq, bulk transfer)
- ❌ NOT for measurements, search, histogram, general SCPI

**tm_devices Guide** — When to use:
- ✅ Modern scopes (MSO6B) with Python API
- ⚠️ Some features not yet implemented in TekAutomate
- Use Python object syntax, not SCPI strings

### Extracting Articles for GPT Upload

To extract the TypeScript `TekAcademyArticles` array into individual
markdown files for GPT upload:

```javascript
// extract-tekacademy.js
const fs = require('fs');
const { TekAcademyArticles } = require('./TekAcademy');

TekAcademyArticles.forEach(article => {
  const dir = `TekAcademy/${article.category}`;
  fs.mkdirSync(dir, { recursive: true });
  const content = `# ${article.title}\n\nCategory: ${article.category}\n\n${article.content}`;
  fs.writeFileSync(`${dir}/${article.id}.md`, content);
});
```

Resulting structure:
```
TekAcademy/
├── Acquisition/
│   ├── fastframe-guide.md
│   ├── fastacq-setup.md
│   └── ...
├── Analysis/
│   ├── search-operations.md
│   ├── histogram-setup.md
│   └── ...
├── Connection/
│   └── ...
├── Backend/
│   ├── pyvisa-guide.md
│   ├── tekhsi-guide.md
│   └── tm_devices-guide.md
└── Workflow/
    ├── basic-waveform-capture.md
    └── ...
```

### How TekAcademy Improves GPT Responses

**Before TekAcademy upload:**
```
User:  "Create FastFrame 50 frames with search analysis"
GPT:   "Which backend: tm_devices or tekhsi?"  ← Wrong question
```

**After TekAcademy upload:**
```
User:  "Create FastFrame 50 frames with search analysis"
GPT:   "I recommend PyVISA backend because search operations
        require SCPI commands that TekHSI doesn't support.
        Here's the complete workflow..."  ← Correct!
```

---

## 10. AI-Assisted Workflow Patterns

### Pattern 1: Create in Blockly → Verify with GPT → Import Back

```
1. Build workflow visually in Blockly Builder
2. Click "Copy XML" button → XML copied to clipboard
3. Paste into TekAutomate Workflow Builder GPT
4. Ask: "Verify this workflow and suggest improvements"
5. GPT returns validated/enhanced XML
6. Copy enhanced XML → "Load File" in Blockly
```

**Example prompt:**
```
Here's my Blockly workflow XML. Can you verify it's correct
and suggest any improvements?

[paste XML]
```

### Pattern 2: Create in GPT → Import to Blockly

```
1. Describe workflow to GPT in natural language
2. GPT generates Blockly XML with proper block types
3. Copy XML from GPT response
4. In Blockly Builder: "Load File" → paste XML
5. Visually verify and fine-tune
```

**Example prompt:**
```
Generate Blockly XML for a workflow that connects to an MSO6B
at 192.168.1.10, loops 10 times setting CH1 scale from 1V to
10V, and saves each waveform.
```

### Pattern 3: Validate Existing Workflow → Get Improvement Suggestions

```
1. Export workflow as JSON from Steps UI
2. Paste into GPT: "Validate my workflow"
3. GPT produces Validation Report (see §7 format)
4. Review findings: ✅ passed, ❌ failed, 💡 suggestions
5. Ask GPT to generate fixed version
6. Import fixed JSON back into Steps UI
```

### Pattern 4: Troubleshoot Runtime Errors → Get Fix Recommendations

```
1. Workflow fails during execution
2. Copy error output + workflow JSON
3. Paste into GPT: "This workflow failed with this error. Fix it."
4. GPT identifies root cause and produces:
   - Diagnosis (which step, why it failed)
   - Fixed workflow JSON/XML
   - Prevention tips
5. Import fixed workflow, re-run
```

### Pattern 5: Format Conversion

```
Steps UI JSON → Blockly XML:
  1. Paste JSON → Ask GPT to convert to Blockly XML
  2. GPT maps step types to block types:
     connect     → connect_scope block
     scpi_write  → scpi_write block
     scpi_query  → scpi_query block
     delay       → sleep block
     python      → python_code block
     group       → nested blocks with label
  3. Validates conversion, provides import instructions

Blockly XML → Steps UI JSON:
  1. Paste XML → Ask GPT to convert to Steps UI JSON
  2. GPT extracts blocks → maps to steps
  3. Assigns sequential IDs, preserves parameters
  4. Validates output JSON
```

### Pattern 6: Iterative Enhancement Loop

```
1. Create simple workflow (Blockly or GPT)
2. Copy XML → GPT: "Add error handling"
3. Import enhanced version → GPT: "Optimize delays"
4. Import optimised version → GPT: "Add verification queries"
5. Final workflow has:
   - Error checks before critical operations
   - Optimised timing (reduced unnecessary delays)
   - Verification queries after critical writes
   - Descriptive comments
```

### Tips for AI-Assisted Workflows

1. **Always verify GPT output** — import into Blockly to visually confirm structure
2. **Use descriptive aliases** — `"scope"`, `"smu"`, `"awg"` help GPT assign correct device context
3. **Specify the instrument model** — "MSO6B", "Keithley 2400" to get model-appropriate commands
4. **Iterate** — start simple, enhance incrementally
5. **Save versions** — use "Save File" in Blockly before applying GPT changes
6. **Review device contexts** — especially in multi-instrument workflows (see §8 Issue 1)

---

## Appendix A: Key TypeScript Interfaces from Technical Architecture

These interfaces define the core data structures referenced throughout
the AI integration.

### DeviceEntry

```typescript
interface DeviceEntry {
  id: string;                        // Unique identifier
  alias: string;                     // User-friendly name (e.g., "scope1")
  deviceType: 'SCOPE' | 'AWG' | 'AFG' | 'SMU' | 'PSU' | 'DMM';
  backend: 'pyvisa' | 'tm_devices' | 'tekhsi' | 'hybrid' | 'vxi11';
  connectionType: 'tcpip' | 'socket' | 'usb' | 'gpib';
  host?: string;                     // IP address or hostname
  port?: number;                     // Port number
  enabled: boolean;                  // Whether device is active
  usbVendorId?: string;
  usbProductId?: string;
  usbSerial?: string;
  gpibBoard?: number;
  gpibAddress?: number;
}
```

### Flow & FlowNode

```typescript
interface Flow {
  flow_id: string;
  name: string;
  trigger: { type: 'manual' | 'schedule' | 'event' };
  nodes: FlowNode[];
  variables?: Record<string, any>;
}

interface FlowNode {
  id: string;
  type: 'trigger' | 'group' | 'condition' | 'loop' | 'delay'
      | 'verify' | 'python' | 'terminate';
  instrumentId?: string;             // DeviceEntry.id
  instrumentAlias?: string;          // DeviceEntry.alias
  instrumentIds?: string[];          // Multiple devices
  params: Record<string, any>;
  next?: string;                     // Next node ID
  nextTrue?: string;                 // For conditions
  nextFalse?: string;                // For conditions
}
```

### CommandLibraryItem

```typescript
interface CommandLibraryItem {
  name: string;              // Display name
  scpi: string;              // SCPI command (may contain ${placeholders})
  description: string;
  category: string;
  params?: CommandParam[];   // Parameter definitions
  example?: string;
  tekhsi?: boolean;          // TekHSI-specific command
}
```

### VISA Resource String Generation

```typescript
function getVisaResourceString(device: DeviceEntry): string {
  if (device.connectionType === 'tcpip') {
    return `TCPIP::${device.host}::INSTR`;
  } else if (device.connectionType === 'socket') {
    return `TCPIP::${device.host}::${device.port}::SOCKET`;
  } else if (device.connectionType === 'usb') {
    const serial = device.usbSerial ? `::${device.usbSerial}` : '';
    return `USB::${device.usbVendorId}::${device.usbProductId}${serial}::INSTR`;
  } else if (device.connectionType === 'gpib') {
    return `GPIB${device.gpibBoard}::${device.gpibAddress}::INSTR`;
  }
  return 'Unknown';
}
```

---

## Appendix B: Backend Compatibility Matrix

| Backend | TCP/IP | Socket | USB | GPIB | Device Support |
|---------|--------|--------|-----|------|----------------|
| PyVISA | ✅ | ✅ | ✅ | ✅ | All devices |
| tm_devices | ✅ | ❌ | ✅ | ✅ | MSO4/5/6, DPO5K/7K |
| VXI-11 | ✅ | ❌ | ❌ | ❌ | All (TCP/IP only) |
| TekHSI | ✅ (port 5000) | ❌ | ❌ | ❌ | MSO5/6, DPO7K only |
| Hybrid | ✅ | ❌ | ✅ | ✅ | MSO5/6, DPO7K only |

---

## Appendix C: Command Type Detection Logic

```typescript
// Determine whether a command string is SCPI, tm_devices API, or TekHSI

const isTmDevicesCommand = cmd.includes('.commands.') ||
                           cmd.includes('.add_') ||
                           cmd.includes('.save_') ||
                           cmd.includes('.turn_') ||
                           cmd.includes('.set_and_check');

const isTekHSI = (cmd.startsWith('scope.') && !isTmDevicesCommand) ||
                 cmd.startsWith('#');

// Otherwise → standard SCPI command
```

### Backend Resolution Algorithm

When executing a command, the effective backend is resolved in priority
order:

1. Command-level backend (`cmd.backend`)
2. Command's instrument backend (via `cmd.instrumentAlias` → device lookup)
3. Group-level backend
4. Device's default backend (from `DeviceEntry.backend`)

```typescript
const cmdAlias = cmd.instrumentAlias || groupAlias;
const cmdInstrument = devices.find(d => d.alias === cmdAlias);
const effectiveBackend = cmd.backend ||
                         cmdInstrument?.backend ||
                         groupBackend ||
                         defaultBackend;
```

---

## Appendix D: Ingestion Quality Gates

Before publishing RAG chunk embeddings, the ingestion pipeline must
verify:

- ✅ All chunks validate against the canonical schema (§6)
- ✅ No duplicate `id` values across the entire corpus
- ✅ At least one `must_include_when_query_mentions` token for chunks with priority ≥ 4
- ✅ All `repo_path` / `source` values reference existing files
- ✅ All tags come from the approved taxonomy
- ✅ Body text is 500–1,200 characters
- ✅ No mixed concerns (API semantics + UI styling) in a single chunk
