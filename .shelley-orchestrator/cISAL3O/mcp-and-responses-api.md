# MCP Toggle, Responses API, and AI Context — Full Code Audit

Generated from full source read of TekAutomate @ `/home/exedev/TekAutomate`

---

## 1. The MCP Toggle in `useAiChat` — How It Works

### What Controls the Path

In `src/components/ExecutePage/useAiChat.ts`, at the top of `sendUserMessage()`, there is a single `if (useMcp)` branch. The value of `useMcp` is a `useMemo` that is evaluated **once on mount** and never changes during a session:

```typescript
// src/components/ExecutePage/useAiChat.ts  lines 100-107
const useMcp = useMemo(() => {
  if (process.env.REACT_APP_AI_USE_MCP === 'true') return true;
  try {
    return localStorage.getItem('tekautomate.ai.use_mcp') === 'true';
  } catch {
    return false;
  }
}, []);
```

**Decision priority (highest to lowest):**
1. Build-time env var `REACT_APP_AI_USE_MCP=true` → always MCP
2. `localStorage.setItem('tekautomate.ai.use_mcp', 'true')` → MCP for that browser session
3. Anything else → direct API path (default)

There is **no UI toggle** in the codebase. Switching paths requires either a rebuild or setting localStorage manually (e.g. from DevTools).

---

### The MCP Code Path (when `useMcp === true`)

```
sendUserMessage(text)
  │
  ├─ inferFlowContext(steps)         // extracts backend, host, connectionType, modelFamily
  │
  ├─ buildMcpRequest({...})          // shapes payload for the MCP server
  │      returns McpChatRequest:
  │        userMessage, outputMode, provider, apiKey, model,
  │        flowContext: { backend, host, connectionType, modelFamily, steps (compressed), selectedStepId, executionSource }
  │        runContext:  { runStatus, logTail, auditOutput, exitCode, duration }
  │        instrumentEndpoint?: { executorUrl, visaResource, backend }
  │
  ├─ streamMcpChat(mcpRequest, onChunk)
  │      → POST http://localhost:8787/ai/chat  (REACT_APP_MCP_HOST default)
  │      → reads SSE stream:
  │          event: status  { phase: 'processing' }
  │          event: chunk   <text delta>
  │          event: warnings [...]
  │          event: done    '[DONE]'
  │          event: error   { error: '...' }
  │
  ├─ Accumulate finalText
  │
  ├─ tryParseResult(finalText)       // parse ACTIONS_JSON from response
  │
  ├─ [IF no parse AND looksLikeMutationRequest(text)]
  │     → Build coercion prompt: "Convert previous response into strict ACTIONS_JSON only..."
  │     → buildMcpRequest(coercionPrompt)  (same flow context, same model)
  │     → streamMcpChat(retryRequest, ...)
  │     → tryParseResult(finalText)  (2nd attempt)
  │
  └─ dispatch STREAM_DONE { actions, parsed }
```

**Key: `buildMcpRequest` does two things:**
1. Calls `compressStep()` on every step in the flow (strips most params, keeps id, type, label, command, backend, boundDeviceId, outputVariable, children)
2. Converts `lastAuditReport` (object) → JSON string `auditOutput` + extracts `exit_code` → `exitCode`

**The MCP server side** (`mcp-server/src/core/toolLoop.ts`):
- Receives `McpChatRequest`
- Calls either `runOpenAiToolLoop` or `runAnthropicToolLoop` (based on `req.provider`)
- Each loop calls the AI provider with **function/tool calling** enabled (up to 4 rounds)
- Available tools: `search_scpi`, `search_tm_devices`, `get_command_by_header`, `retrieve_rag_chunks`, `search_known_failures`, `get_template_examples`, `get_policy`, `list_valid_step_types`, `get_block_schema`, `validate_action_payload`, `verify_scpi_commands`, `validate_device_context`, `get_instrument_state`, `probe_command`, `get_visa_resources`, `get_environment`
- After tool loop completes, runs `postCheckResponse()` to validate the final output
- **OpenAI path**: `POST https://api.openai.com/v1/chat/completions` with `tool_choice: 'auto'`
- **Anthropic path**: `POST https://api.anthropic.com/v1/messages` with tools array
- Result is streamed back as SSE `event: chunk` (single chunk, not streaming tokens)

---

### The Direct API Path (when `useMcp === false`)

```
sendUserMessage(text)
  │
  ├─ retrieveChunks(text, hintCorpora)
  │      → routeQuery(message, hintCorpora)  // BM25 corpus routing
  │      → loadRagChunks(corpus)              // fetch public/rag/<shard>.json
  │      → Bm25Index.search(message, 5)       // top-5 chunks per corpus
  │
  ├─ assembleAiContext({...})
  │      → Builds systemPrompt + userPrompt (see Section 4 for full detail)
  │      → Token budgeted: system(1200) + flow(1500) + retrieved(2000) + history(2000) + user(200)
  │
  ├─ adapter.streamResponse(...)   // openaiAdapter or anthropicAdapter
  │      OpenAI:    POST https://api.openai.com/v1/chat/completions  (stream:true, NO tools)
  │      Anthropic: POST https://api.anthropic.com/v1/messages      (stream:true, NO tools)
  │
  ├─ Accumulate finalText from SSE
  │
  ├─ tryParseResult(finalText)    // parse ACTIONS_JSON
  │   NOTE: No coercion retry on direct path
  │
  └─ dispatch STREAM_DONE { actions, parsed }
```

**Key differences MCP vs Direct:**

| | MCP Path | Direct Path |
|---|---|---|
| RAG retrieval | Tool calls (model pulls on demand) | Client-side BM25, pre-stuffed |
| SCPI verification | `verify_scpi_commands` tool | None — model guesses |
| Token budget | Server-side, much larger (no 6500 limit) | 6500 token hard cap |
| Tool calling | Yes — up to 4 rounds | No |
| Coercion retry | Yes (on mutation requests) | No |
| History | NOT sent (only single-turn) | Last 12 turns included |
| Run log | Sent as `logTail` (last 800 chars) | Sent as-is (trimmed to 900 tokens) |
| Audit report | Serialized as JSON string `auditOutput` | Not sent |
| Live instrument | Can call `get_instrument_state` via executor | Never |
| Streaming | Single chunk at end | True token-by-token streaming |

---

## 2. Responses API — Does It Exist?

**Answer: NO Responses API code exists in this codebase.**

Exhaustive search results:

```bash
grep -rn "responses\|vector_store\|file_search\|openai.beta\|/v1/responses" src/ --include="*.ts" --include="*.tsx"
# → Zero hits on Responses API / vector_store / file_search / openai.beta
```

The only "responses" hits in `src/` are Python variable names inside SCPI popup-handling code
(e.g. `_responses = ...`) in `pythonGenerators.ts` and `App.tsx` — completely unrelated.

```bash
find src -name "*.ts" -o -name "*.tsx" | xargs grep -l "vectorStore|vector_store|fileSearch|file_search|responses"
# → Returns: pythonGenerators.ts, App.tsx, AcademyData.ts, .backup files
#   All are Python string code generation, not OpenAI API calls
```

No files reference:
- `openai.beta.vectorStores`
- `openai.beta.assistants`
- `openai.responses`
- `/v1/responses`
- `file_search` tool
- `vector_store_id`
- `AssistantsAPI`

**What the user may be referring to:** The project has a **local RAG corpus** (`public/rag/*.json`) — 
pre-chunked JSON files served as static assets. The `buildRagIndex.ts` script builds these from 
`AI_RAG/*.md`, `public/commands/*.json`, and `public/templates/*.json`. This is a 
**client-side BM25 retrieval system**, not OpenAI's file search / vector stores.

If the user intends to migrate to the OpenAI Responses API with `file_search` + `vector_store_id`,
**none of that work has been done yet** in the frontend or MCP server.

---

## 3. Full File Contents — Key AI Files

### `src/utils/ai/mcpClient.ts`

This file exports:
- **`McpChatRequest` interface** — typed payload sent to MCP server
- **`buildMcpRequest(input)`** — builds `McpChatRequest` from raw hook params:
  - Maps `StepPreview[]` through `compressStep()` 
  - Extracts `exit_code` and serializes `lastAuditReport` from audit report
- **`streamMcpChat(request, onChunk)`** — POSTs to `REACT_APP_MCP_HOST/ai/chat`, parses SSE

Key behavior of `streamSse()` in mcpClient:
- Parses `event: chunk` → calls `onChunk(data)` 
- Parses `event: error` → throws `Error(message)`
- Other events (`status`, `done`, `warnings`) are silently consumed

### `src/utils/ai/providers/openaiAdapter.ts`

Uses **Chat Completions API only** (`/v1/chat/completions`):
```typescript
// Direct path, no tools, stream:true
POST https://api.openai.com/v1/chat/completions
Body: { model, stream: true, messages: [{ role:'system', content:systemPrompt }, { role:'user', content:userPrompt }] }
```
SSE parsing: reads `data:` lines, parses JSON, extracts `choices[0].delta.content`.

### `src/utils/ai/providers/anthropicAdapter.ts`

Uses **Messages API** (`/v1/messages`) with `stream: true`:
```typescript
POST https://api.anthropic.com/v1/messages
Body: { model, max_tokens:2000, temperature:0.1, system:systemPrompt, stream:true, messages:[{role:'user', content:userPrompt}] }
```
SSE parsing: filters `content_block_delta` events for `delta.text`.

### `mcp-server/src/server.ts`

Pure Node `http.Server`, no framework:
- `GET /health` → `{ ok: true, status: 'ready' }`
- `POST /ai/chat` → reads JSON body, validates required fields, calls `runToolLoop(body)`, SSE-streams result
- On startup: loads all indexes (`commandIndex`, `tmDevicesIndex`, `ragIndexes`, `templateIndex`)

### `mcp-server/src/core/toolLoop.ts`

The heart of MCP — two parallel implementations:

**`runOpenAiToolLoop(req, maxCalls=4)`:**
```
messages = [{ role:'system', content:buildSystemPrompt(policies, outputMode) },
            { role:'user',   content:buildUserPrompt(req) }]

for i in 0..maxCalls:
    POST /v1/chat/completions { model, messages, tools, tool_choice:'auto' }
    if no tool_calls in response → return content
    else:
        append assistant message with tool_calls
        for each tool_call:
            parse name + args
            if live instrument tool → inject instrumentEndpoint into args
            result = runTool(name, args)
            slim result to 5 entries max (slimToolResultForModel)
            append tool result message
```

**`buildSystemPrompt(policies, outputMode)`:** Loads policy files:
- `response_format`, `backend_taxonomy`, `scpi_verification`, `steps_json`
- `blockly_xml` — only included when `outputMode === 'blockly_xml'` (saves ~800 tokens)

**`buildUserPrompt(req)`:**
- SCPI arg types brief reference
- User message
- Output mode
- Device context (backend, modelFamily, host, connectionType)
- Current flow (step list: `[id] type "label" → command`)
- Selected step (if any)
- Run status + log tail (if not idle)
- Audit output (if not idle)
- Live instrument endpoint (if present)

---

## 4. Context Injected into AI Calls — `assembleAiContext`

**File:** `src/utils/ai/contextAssembler.ts`

This function is only called on the **direct (non-MCP) path**.

### Token Budgets

```typescript
const TOKEN_BUDGET = {
  system:    1200,   // system prompt
  flow:      1500,   // compressed step JSON
  retrieved: 2000,   // RAG chunks
  history:   2000,   // last 12 conversation turns
  user:       200,   // user message
};
const MAX_TOTAL_TOKENS = 6500;
```

### System Prompt Contents

Built from hardcoded arrays (NOT loaded from files, unlike MCP policies):

1. **Role definition** — "TekAutomate Flow Builder"
2. **RESPONSE_FORMAT_RULES** (6 rules):
   - Max 2 short sentences, then action cards
   - Never output raw JSON as chat body
   - Never output Python unless requested
   - Ask ONE clarifying question only
   - Don't ask for inferable context
   - Evidence-based only
3. **BUILDER_POLICY** (11 rules): output as AiAction, no Python steps, verify SCPI, etc.
4. **Mode rules** (build/edit/validate)
5. **Action output format** — ACTIONS_JSON block format
6. **HARD_CONSTRAINTS** (conditionally injected):
   - `hasTmDevicesStep` → tm_devices forbids raw write/query/scpi_write etc.
   - `hasTmDevicesStep` → Socket not supported for tm_devices
   - Always: Hybrid is multi-backend; TekHSI is gRPC not SCPI; TekHSI for waveform only; etc.

### User Prompt Contents (in order)

```
Execution source: steps|blockly
Run status: idle|connecting|running|done|error

Live flow (compressed):
  [JSON of steps.map(compressStep), trimmed to 1500 tokens]

Flow facts:
  - stepTypes: [...]
  - simpleScreenshotFlow: yes|no
  - hasTmDevicesStep: yes|no
  - hasSaveScreenshotStep: yes|no

Inferred execution context:
  - backend: <from connect step params>
  - model: <modelFamily from connect step>
  - connection: <connectionType>
  - host: <host/hostIP or executorEndpoint.host>

Generated python (trimmed):
  [generated code, trimmed to 1200 tokens]

Run logs (trimmed):
  [runLog, trimmed to 900 tokens]

Retrieved context:
  [BM25 chunks formatted as "## <corpus>\n[id] title\nsource\nbody", trimmed to 2000 tokens]

Conversation history (recent):
  [last 12 turns as "ROLE: content", trimmed to 2000 tokens]

User request:
  [trimmed to 200 tokens]

[Conditional hints based on intent detection:]
  - isApplyIntent → "Include ACTIONS_JSON block..."
  - isBuildIntent → "Generate insert_step_after / set_step_param actions..."
  - isCommandLookupIntent → "Answer with direct command(s) first..."
  - isValidateIntent → "Keep answer to max 3 bullets..."
```

### `compressStep()` — What Gets Kept

For all steps except `connect`:
```typescript
{ id, type, label, command?, backend?, boundDeviceId?, outputVariable?, children? }
```
For `connect` steps:
```typescript
{ id, type, label, params: { ...all params }, children? }
```

This strips most params (host, connectionType, firmware, etc.) for non-connect steps.

### RAG Retrieval Pipeline (direct path only)

```
routeQuery(message, hintCorpora)
  → always includes 'app_logic'
  → signal-based additions (regex against message):
      tm_devices|device_manager → 'tmdevices'
      measurement|trigger|*IDN? → 'scpi'
      pyvisa|tekhsi|grpc → 'pyvisa_tekhsi'
      fail|error|timeout → 'errors'
      .tss|recall|template → 'templates'
      blockly|xml|backend|connection → 'app_logic' (already included)
  → build intent → forces scpi + tmdevices + templates + pyvisa_tekhsi
  → default fallback: add 'scpi' if neither scpi nor tmdevices present

loadRagChunks(corpus)
  → fetch public/rag/manifest.json
  → fetch public/rag/<shard>.json per corpus
  → cached in module-level Map

Bm25Index.search(message, 5)
  → BM25 scoring across corpus chunks
  → returns top 5 per corpus
```

---

## 5. Summary: What Doesn't Exist Yet

The user mentioned "redesigned API calls to Responses API and setup files and vectors." 
**This work does not exist in the codebase.** Current state:

| Feature | Current Status |
|---|---|
| OpenAI Responses API (`/v1/responses`) | ❌ Not implemented |
| File uploads (`openai.files.create`) | ❌ Not implemented |
| Vector stores (`openai.beta.vectorStores`) | ❌ Not implemented |
| `file_search` tool in Responses API | ❌ Not implemented |
| Assistants API | ❌ Not implemented |
| Streaming via Responses API | ❌ Not implemented |

**What IS implemented:**
- Direct Chat Completions API (`/v1/chat/completions`) — both streaming and tool-calling variants
- Client-side BM25 RAG over static JSON files (`public/rag/`)
- MCP server with 15 tools that call Chat Completions with `tool_choice: 'auto'`
- Feature flag to switch between local BM25 path and MCP server path

If "Responses API" work was planned or done outside this repo (e.g. in a Custom GPT configuration,
a separate OpenAI project, or uploaded files via the platform UI), it has **not yet been integrated**
into the TekAutomate source code.

---

## 6. File Map for AI Subsystem

```
src/utils/ai/
  mcpClient.ts              — buildMcpRequest, streamMcpChat, McpChatRequest type
  contextAssembler.ts       — assembleAiContext, compressStep (direct path)
  queryRouter.ts            — routeQuery → corpus selection by regex signals
  ragLoader.ts              — loadRagChunks, loadRagManifest (fetch + cache)
  bm25Index.ts              — BM25 scoring for chunk retrieval
  types.ts                  — RagChunk, RagCorpus, ChatTurn, AssembledContext, AiProvider etc.
  providers/
    openaiAdapter.ts        — Chat Completions streaming (no tools)
    anthropicAdapter.ts     — Messages API streaming (no tools)
    types.ts                — AiProviderAdapter, ProviderStreamInput, ProviderStreamCallbacks

src/components/ExecutePage/
  useAiChat.ts              — Main hook: useMcp toggle, sendUserMessage, applyActionsFromTurn

mcp-server/src/
  server.ts                 — HTTP server: GET /health, POST /ai/chat → runToolLoop
  index.ts                  — Entry point
  core/
    toolLoop.ts             — runOpenAiToolLoop, runAnthropicToolLoop, buildSystemPrompt, buildUserPrompt
    policyLoader.ts         — Loads markdown policy files
    postCheck.ts            — Post-response validation
    commandIndex.ts         — SCPI command search index
    tmDevicesIndex.ts       — tm_devices method index
    ragIndex.ts             — RAG chunk index
    templateIndex.ts        — Template index
    instrumentProxy.ts      — Calls code_executor for live instrument tools
    schemas.ts              — McpChatRequest Zod/type schema
  tools/
    searchScpi.ts           — search_scpi tool
    searchTmDevices.ts      — search_tm_devices tool
    getCommandByHeader.ts   — get_command_by_header tool
    retrieveRagChunks.ts    — retrieve_rag_chunks tool
    verifyScpiCommands.ts   — verify_scpi_commands tool
    validateActionPayload.ts — validate_action_payload tool
    validateDeviceContext.ts — validate_device_context tool
    getInstrumentState.ts   — get_instrument_state (live)
    probeCommand.ts         — probe_command (live)
    getVisaResources.ts     — get_visa_resources (live)
    getEnvironment.ts       — get_environment (live)
    ... (other static tools)

public/rag/                 — Pre-built BM25 corpus shards (JSON)
AI_RAG/corpus/             — Source corpus markdown/JSON for rag builder
```
