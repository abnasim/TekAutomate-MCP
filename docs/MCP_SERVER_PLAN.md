# TekAutomate MCP Server Plan

Date: 2026-03-13
Owner: TekAutomate AI Integration
Status: Final — ready to build

---

## 1. What's already working (do not rebuild)

```
✅ TekAutomate React app (browser + Electron)
✅ code_executor — local HTTP server (POST /run, action:"run_python")
✅ TekScopePC / real scope — connected via pyvisa or tm_devices
✅ Full Python venv on user's machine (pyvisa, tm_devices, vxi11 installed)
✅ Logs panel — stdout, stderr, audit, exit code, duration already generated
✅ Predefined action chips — Build Flow, Command Lookup, Validate Flow, etc.
✅ BYOK AI panel — provider/model/key selector
✅ onApplyAiActions() — apply pipeline untouched
✅ public/commands/*.json — full SCPI command library
✅ public/rag/*.json — RAG shards already built
✅ public/templates/*.json — workflow templates
✅ AI_RAG/*.md — knowledge corpus
```

---

## 2. Why the current AI approach failed

The current path (`contextAssembler.ts` + client-side BM25) fails because:

1. **Command truth is probabilistic** — top 3-5 BM25 chunks, not guaranteed lookup.
   The right SCPI command may not be in the retrieved set.
2. **Flow context is token-trimmed** — backend, host/IP, model dropped under budget pressure.
3. **One-shot prompting** — model guesses instead of fetching what it needs.
4. **Policy and retrieval conflated** — one giant prompt tries to be both instruction
   set and knowledge base. Both suffer.
5. **Behavioral drift** — no structural enforcement. Model hallucinates SCPI,
   defaults to TekHSI for any waveform request, asks pointless questions,
   dumps analysis walls, replaces steps with Python blocks.
6. **Log output ignored** — Logs panel has real stdout/stderr/audit but AI never sees it.

---

## 3. Design goals

1. Move RAG to AI-side tool calls — model pulls what it needs, nothing pre-stuffed.
2. Flow context always complete and never trimmed — backend, host, model, steps, log.
3. Command generation evidence-based — every SCPI command cites a verified source entry.
4. Behavioral policy enforced at tool + validator layer, not just in prompts.
5. Preserve apply pipeline — `ACTIONS_JSON` → `parseAiActionResponse()` → `onApplyAiActions()`.
6. BYOK maintained — OpenAI + Anthropic, both via tool-calling APIs.
7. Old assembler path kept behind feature flag as rollback.

---

## 4. Architecture

### 4.1 Components

```
Browser (TekAutomate)
  │
  │  POST /ai/chat  (McpChatRequest — see §5)
  ▼
Hosted MCP Server
  │
  ├── Static knowledge tools (all served from hosted data)
  │     search_scpi
  │     search_tm_devices
  │     get_command_by_header
  │     retrieve_rag_chunks
  │     search_known_failures
  │     get_template_examples
  │     get_policy
  │     list_valid_step_types
  │     get_block_schema
  │
  ├── Validation tools
  │     validate_action_payload
  │     verify_scpi_commands
  │     validate_device_context
  │
  ├── Live instrument tools
  │     get_instrument_state
  │     probe_command
  │     get_visa_resources
  │     get_environment
  │         │
  │         │  POST /run { action:"run_python", code:"..." }
  │         ▼
  │     code_executor  (user's machine, <host>:<port>)
  │         │
  │         ▼
  │     Instrument (real scope or TekScopePC)
  │
  └── toolLoop → postCheck → stream response
  ▼
Browser: ACTIONS_JSON → action cards → Apply → onApplyAiActions()
```

### 4.2 Data flow per turn

```
1. User types message
2. TekAutomate sends McpChatRequest:
   - user message
   - full flow context (steps, backend, host, model — never trimmed)
   - full run context (log tail, audit, exit code — from Logs panel verbatim)
   - instrument endpoint (code_executor URL + VISA resource string)
   - BYOK key + provider + model
   - output mode (steps_json | blockly_xml)
3. MCP server receives request
4. toolLoop runs: model calls tools as needed
   - search_scpi("FastFrame") before emitting any SCPI
   - get_instrument_state() to confirm device + firmware
   - probe_command("FastFrame:STATE?") to verify support
   - retrieve_rag_chunks() for explanation/debug context
5. Tool results → structured JSON with sourceMeta citations
6. Model emits response: 1-2 sentences + ACTIONS_JSON
7. postCheck pipeline runs:
   - validate_action_payload
   - verify_scpi_commands
   - prose length check
   - TekHSI unexpected check
   - Python substitution check
   - auto-repair once on failure
8. Streaming response → browser
9. ACTIONS_JSON stripped from chat text → rendered as action cards
10. User clicks Apply → onApplyAiActions() (unchanged)
```

---

## 5. McpChatRequest payload

```typescript
interface McpChatRequest {
  // User input
  userMessage: string;
  outputMode: 'steps_json' | 'blockly_xml';  // from active builder tab

  // BYOK — used server-side for this request only, never logged or stored
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;

  // Full flow context — sent complete, never trimmed
  flowContext: {
    backend: string;            // "pyvisa" | "tm_devices" | "vxi11" | "tekhsi"
    host: string;               // exact IP from DeviceEntry
    port?: number;
    connectionType: string;     // "tcpip" | "socket" | "usb" | "gpib"
    modelFamily: string;        // "MSO6B" — from *IDN? if available
    firmware?: string;          // "FW:2.16.9"
    steps: CompressedStep[];    // full step list, untruncated
    selectedStepId: string | null;
    executionSource: 'steps' | 'blockly';
  };

  // Full run context — log panel output verbatim
  runContext: {
    runStatus: 'idle' | 'running' | 'done' | 'error';
    logTail: string;            // full stdout/stderr from last run
    auditOutput: string;        // audit section: status, findings, p0/p1/p2
    exitCode: number | null;
    duration?: string;          // "13.4s"
  };

  // Live instrument access — optional, only when code_executor reachable
  instrumentEndpoint?: {
    executorUrl: string;        // "http://192.168.1.x:PORT"
    visaResource: string;       // "TCPIP::127.0.0.1::INSTR"
    backend: string;            // "pyvisa" | "tm_devices"
  };
}
```

---

## 6. Tool contract

All tools return:
```typescript
{
  ok: boolean;
  data: unknown;
  sourceMeta: Array<{
    file: string;
    commandId?: string;
    section?: string;
    score?: number;
  }>;
  warnings: string[];
}
```

### 6.1 Static knowledge tools

**`search_scpi(query, modelFamily?, limit?)`**
- Searches hosted command index (built from `public/commands/*.json` at startup)
- Returns exact command entries: header, syntax, args, codeExamples, commandId, sourceFile
- Never infers. No match → `data:[], warnings:["No commands matched query"]`

**`get_command_by_header(header, family?)`**
- Deterministic normalized header lookup (case-insensitive, short-form expansion)
- Returns single exact result or `ok:false`

**`search_tm_devices(query, model?, limit?)`**
- Searches `tm_devices_full_tree.json` + docstrings
- Returns method path, signature, usage example
- Flags if method unavailable for requested model

**`retrieve_rag_chunks(corpus, query, topK?)`**
- BM25 over hosted RAG shards
- corpus: `scpi | tmdevices | app_logic | errors | templates | pyvisa_tekhsi`
- For explanation + debug context only — NOT for command truth

**`search_known_failures(query)`**
- BM25 over error corpus
- Returns: symptom, root_cause, fix, code_before, code_after, affected_files

**`get_template_examples(query)`**
- Searches `public/templates/*.json`
- Returns closest matching workflow step patterns

**`get_policy(mode)`**
- Returns versioned policy pack content
- mode: `steps_json | blockly_xml | scpi_verification | response_format | backend_taxonomy`

**`list_valid_step_types(mode, backend?)`**
- Returns allowed step/block types filtered by backend
- tm_devices removes: write, query, save_screenshot, save_waveform
- blockly_xml removes: group, comment, error_check

**`get_block_schema(blockType)`**
- Returns required fields + valid values for any Blockly block type
- Prevents hallucinated field names

### 6.2 Validation tools

**`validate_action_payload(actionsJson)`**
- Checks: step types valid, saveAs on query steps, group structure (params:{} + children:[]),
  connect first + disconnect last, recallType enum, file extensions (.tss/.set/.wfm),
  unique step IDs, no newStep.type=python unless original was python
- Returns: `{ valid, errors[], fixHints[] }`

**`verify_scpi_commands(commands[], modelFamily?)`**
- Batch verify each command string against hosted index
- Returns per-command: `{ command, verified, commandId?, sourceFile? }`
- Called by postCheck on every ACTIONS_JSON before response reaches browser

**`validate_device_context(steps[])`**
- CH1:/ACQuire:/MEASU:/DATa: → must be scope context
- :SOURce:/:OUTPut:/:MEASure: → must be smu/psu context
- TEKEXP: → must be tekexp context
- Returns structured fix suggestions, not prose

### 6.3 Live instrument tools

All proxy to `code_executor` at `instrumentEndpoint.executorUrl`.
If unreachable: `ok:false, warnings:["code_executor not reachable"]`

**`get_instrument_state()`**
Sends to code_executor:
```python
import pyvisa
rm = pyvisa.ResourceManager()
scope = rm.open_resource('{visaResource}')
print("IDN:", scope.query('*IDN?').strip())
print("ESR:", scope.query('*ESR?').strip())
print("ALLEV:", scope.query('ALLEV?').strip())
scope.close()
```
Returns: model, serial, firmware, error queue parsed from stdout.

**`probe_command(command)`**
Sends to code_executor:
```python
import pyvisa
rm = pyvisa.ResourceManager()
scope = rm.open_resource('{visaResource}')
cmd = '{command}'
if '?' in cmd:
    print(scope.query(cmd).strip())
else:
    scope.write(cmd)
    print("OK")
scope.close()
```
Returns: instrument response or error string.

**`get_visa_resources()`**
Sends to code_executor:
```python
import pyvisa
rm = pyvisa.ResourceManager()
print(list(rm.list_resources()))
```

**`get_environment()`**
Sends to code_executor:
```python
import pyvisa, tm_devices, sys
print("pyvisa:", pyvisa.__version__)
print("tm_devices:", tm_devices.__version__)
print("python:", sys.version)
```

---

## 7. Behavioral policy (enforced structurally, not just in prompts)

### Build first — no question loops
- Build immediately with safe defaults
- Defaults: CH1, pyvisa, modern scopeType, TCP/IP
- State assumptions used in one sentence
- postCheck: if output has no ACTIONS_JSON and prose >400 chars → policy violation → repair

### TekHSI containment
- `search_scpi` never routes to TekHSI corpus by default
- TekHSI tools only returned if message contains "tekhsi" or "grpc" explicitly
- `list_valid_step_types(pyvisa)` does not include TekHSI steps
- postCheck: unexpected TekHSI step → flag + repair

### No Python substitution
- `validate_action_payload` rejects `newStep.type = "python"` unless original step was python
- postCheck catches this before browser receives response

### Response format
- 1-2 sentences + ACTIONS_JSON block
- ACTIONS_JSON stripped from chat text by UI, rendered as action cards
- postCheck: prose >400 chars → trim + flag

### SCPI verification gate
- Model must call `search_scpi` or `get_command_by_header` before emitting SCPI
- postCheck calls `verify_scpi_commands` on every command in ACTIONS_JSON
- Unverified → one auto-repair pass → if still failing → surface warning with placeholder

---

## 8. Versioned policy packs

```
mcp-server/policies/
  steps_json.strict.v1.md       — valid step types, saveAs rule, group structure,
                                   connect/disconnect, file extensions, no Python output
  blockly_xml.strict.v1.md      — xmlns mandatory, valid block types, device context,
                                   mutation/variable requirement, no group/comment/error_check
  scpi_verification.v1.md       — no inference, no naming pattern guessing,
                                   commandId citation required, failure text
  response_format.v1.md         — build first, state assumptions, ≤400 chars prose,
                                   no walls, no questions, ACTIONS_JSON only
  backend_taxonomy.v1.md        — pyvisa default, TekHSI explicit only,
                                   tm_devices restrictions, hybrid definition,
                                   code_executor probe pattern
```

System prompt stays thin — references policy by version string only.
Policy upgrades are version bumps. Rollback is changing the version string.

---

## 9. Post-check pipeline

Runs server-side before any response reaches browser:

```
1. Parse ACTIONS_JSON (JSON.parse — fail → repair)
2. validate_action_payload() → structure errors
3. verify_scpi_commands() → unverified commands
4. Prose length check → >400 chars flag
5. TekHSI presence check → unexpected TekHSI flag
6. Python substitution check → unexpected type=python flag

On any failure:
  → feed specific errors back to model
  → one auto-repair attempt
  → if still failing → return structured error to browser with failure reason
```

---

## 10. File layout

```
mcp-server/
  package.json
  src/
    index.ts                       — entry point
    server.ts                      — HTTP server + route registration
    tools/
      searchScpi.ts
      searchTmDevices.ts
      getCommandByHeader.ts
      retrieveRagChunks.ts
      searchKnownFailures.ts
      getTemplateExamples.ts
      getPolicy.ts
      listValidStepTypes.ts
      getBlockSchema.ts
      validateActionPayload.ts
      verifyScpiCommands.ts
      validateDeviceContext.ts
      getInstrumentState.ts        — proxies to code_executor
      probeCommand.ts              — proxies to code_executor
      getVisaResources.ts          — proxies to code_executor
      getEnvironment.ts            — proxies to code_executor
    core/
      commandIndex.ts              — loads + indexes all command JSONs at startup
      bm25.ts                      — retrieval engine (shared)
      normalize.ts                 — SCPI header normalization
      schemas.ts                   — shared TypeScript types
      policyLoader.ts              — loads versioned policy packs
      toolLoop.ts                  — LLM tool-calling orchestration (OpenAI + Anthropic)
      postCheck.ts                 — post-generation validation + repair pipeline
      instrumentProxy.ts           — builds probe scripts, calls code_executor /run
    policies/
      steps_json.strict.v1.md
      blockly_xml.strict.v1.md
      scpi_verification.v1.md
      response_format.v1.md
      backend_taxonomy.v1.md
  test/
    searchScpi.test.ts
    getCommandByHeader.test.ts
    validateActionPayload.test.ts
    verifyScpiCommands.test.ts
    postCheck.test.ts
    behavioral.buildFirst.test.ts
    behavioral.tekhsi.test.ts
    behavioral.noPython.test.ts
    behavioral.responseFormat.test.ts
    behavioral.scpiVerified.test.ts
    behavioral.saveAs.test.ts

App-side (single file change):
src/utils/ai/
  mcpClient.ts                     — replaces contextAssembler + provider adapters
                                     POST McpChatRequest, stream response back
```

---

## 11. Build sequence

```
Step 1  commandIndex.ts
        Load public/commands/*.json into memory
        Build normalized header map + BM25 index
        Filter by modelFamily + commandType
        Expose: searchByQuery(), getByHeader()

Step 2  searchScpi.ts + getCommandByHeader.ts + verifyScpiCommands.ts
        Wire commandIndex to tool endpoints
        Return full command entries with commandId + sourceFile

Step 3  searchTmDevices.ts
        Load tm_devices_full_tree.json + docstrings into BM25
        Flag method unavailability by model

Step 4  retrieveRagChunks.ts + searchKnownFailures.ts + getTemplateExamples.ts
        Load public/rag/*.json shards into BM25
        Load error corpus, templates

Step 5  Policy packs + getPolicy.ts
        Write all 5 policy MD files from proven GPT instruction sets
        getPolicy(mode) returns full file content

Step 6  listValidStepTypes.ts + getBlockSchema.ts
        Step/block type lists filtered by backend
        Block field schemas

Step 7  validateActionPayload.ts + validateDeviceContext.ts
        Full structural validators
        Device context prefix → instrument type checks

Step 8  instrumentProxy.ts + live tools
        getInstrumentState, probeCommand, getVisaResources, getEnvironment
        Build probe scripts → POST to code_executor /run → parse stdout
        Graceful ok:false if executor unreachable

Step 9  toolLoop.ts
        Unified tool-calling for OpenAI + Anthropic
        Max 6 tool calls per turn
        Streaming final response

Step 10 postCheck.ts
        Full validation + repair pipeline
        Max 1 auto-repair attempt

Step 11 mcpClient.ts (app-side)
        Single POST replaces contextAssembler entirely
        Streams response to chat panel
        Feature flagged: AI_USE_MCP=false default

Step 12 Behavioral tests
        FastFrame builds in 1 turn with verified SCPI
        Zero TekHSI without explicit request
        Zero type=python replacements
        Prose ≤400 chars
        100% saveAs on query steps
```

### Dependency order

```
1 ──► 2 ──► 7 ──► 10 ──► 11 ──► 12
      │
      3 ──┐
      4 ──┤──► 5 ──► 6
      8 ──┘
           └──► 9
```

Steps 3, 4, 8 can be built in parallel after Step 1 is done.
Steps 9 and 10 can be built in parallel after Step 5.

---

## 12. Acceptance criteria

### Functional
1. `search_scpi("FastFrame")` returns verified commands with commandId citation
2. AI response always includes correct backend + host — never "(unknown)"
3. Real *IDN? response available to AI when code_executor connected
4. ≥95% of ACTIONS_JSON payloads pass `validate_action_payload`
5. ≥90% reduction in "could not verify" false negatives for commands in library
6. No regression in `parseAiActionResponse` apply success rate

### Behavioral
7. Zero TekHSI steps generated unless user explicitly says "tekhsi" or "grpc"
8. Zero type=python step replacements of structured steps
9. Flow built in 1 turn for any goal with sufficient context
10. Response prose ≤400 chars for build/edit requests
11. AI reads and references actual run log content (not just run status string)

### Structural
12. Zero unverified SCPI commands in output
13. 100% query steps include saveAs
14. 100% Blockly payloads include xmlns + unique IDs
15. Zero XML-invalid step types (group/comment/error_check) in Blockly mode

---

## 13. Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| OpenAI vs Anthropic tool-calling format differences | Unified toolLoop.ts; provider-specific wire format only |
| code_executor not running / unreachable | ok:false graceful fallback; AI uses static knowledge only |
| Command index startup time (large JSONs) | Load async at startup; tool calls wait for ready signal |
| Post-check repair loop | Max 1 retry; surface structured error if still failing |
| Policy pack drift | Versioned files; system prompt references version string |
| BYOK key exposure | Never logged, never stored, in-memory per request only |
| MCP server cold start | Health check endpoint; client retries once on 503 |
| Old assembler path divergence | Feature flag keeps both paths; parity test before flag flip |

---

## 14. What is explicitly NOT being rebuilt

- `onApplyAiActions()` — unchanged
- `parseAiActionResponse()` — unchanged
- `AiAction` schema — unchanged
- `code_executor` — no new endpoints needed
- Logs panel — output consumed as-is in runContext
- BYOK key UI — unchanged, key forwarded in request
- public/commands/*.json — consumed as-is by commandIndex
- public/rag/*.json — consumed as-is by retrieveRagChunks
