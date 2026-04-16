# AI E2E Test Harness — Known Issues & Fixes

Test file: `e2e/aiFlowIntegration.test.ts`
MCP server: `mcp-server/src/core/toolLoop.ts`
Last run: **15/18 passing** with real TekScopePC execution via SSH tunnel.

## Setup
- Executor: `ssh -R 8765:192.168.1.105:8765 exedev@tek-cosmos.exe.xyz`
- MCP: `localhost:8787` (already running in tmux `mcp`)
- VISA: `TCPIP::127.0.0.1::INSTR`
- Primary model: `gpt-5.2` via OpenAI
- Fallback: `claude-sonnet-4-20250514` via Anthropic
- Both keys passed as env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`

## Fix 1: Remove retry logic from test harness
**File:** `e2e/aiFlowIntegration.test.ts`
**Problem:** Retry loop in `callMcp()` fires 3 attempts on 429, each consuming ~20K tokens from MCP tool loop. Makes rate limits catastrophically worse.
**Fix:** Remove the retry for-loop. Single attempt per provider. If primary fails, try fallback once. That's it.
**Lines:** ~225-245 (the `for (let attempt = 0; attempt < 3; attempt++)` block)

## Fix 2: `applyActions` ID collision on disconnect
**File:** `e2e/aiFlowIntegration.test.ts`
**Problem:** AI sometimes emits `insert_step_after` with `newStep.id = "disconnect_1"` then `remove_step` targeting `"disconnect_1"`. Since both the original and new step share the ID, remove deletes the wrong one. Flow loses its disconnect.
**Fix:** In `applyActions`, when inserting a step whose ID already exists in the flow, suffix it (e.g. `disconnect_1_2`). Or: process remove_step before insert_step_after.
**Lines:** ~508-560

## Fix 3: MCP postCheck drops valid gpt-5.2 ACTIONS_JSON
**File:** `mcp-server/src/core/toolLoop.ts`
**Problem:** `postCheckResponse()` parses the AI text for ACTIONS_JSON. gpt-5.2 sometimes wraps it in markdown fences or splits it across lines. The regex fails and logs "ACTIONS_JSON parse failed" even though the JSON is valid.
**Fix:** Check `postCheckResponse` regex — make it handle:
  - `ACTIONS_JSON:\n\`\`\`json\n{...}\n\`\`\`` 
  - `ACTIONS_JSON:\n{...}` (newline before JSON)
  - Trailing text after the JSON closing brace
**Lines:** grep for `ACTIONS_JSON` in `toolLoop.ts` and `server.ts`

## Fix 4: tm_devices RAG corpus empty for MSO6B
**File:** `mcp-server/src/tools/` and RAG index
**Problem:** `search_tm_devices` returns 0 results for every query with `model: "MSO6B"`. The AI exhausts its 6-call tool budget searching and produces empty actions.
**Fix:** Index tm_devices API methods for MSO series. Check `AI_RAG/` for the corpus format and add tm_devices entries.

## Fix 5: Reduce MCP system prompt token usage
**File:** `mcp-server/src/core/toolLoop.ts`
**Problem:** System prompt = SCPI_ARG_TYPES (~800 tokens) + 5 policy files (~3K tokens) + tool definitions. Total ~6K tokens before any user content. With 6 tool rounds, a single request can burn 25K+ tokens.
**Fix:** 
  - Move SCPI_ARG_TYPES to a tool (only fetched when needed)
  - Reduce policy verbosity
  - Lower `maxCalls` from 6 to 4 for simpler prompts
  - Consider caching tool results across calls

## Passing Tests (13 on primary, 15 with fallback)
TC01 IDN, TC02 FastFrame, TC03 Measurements*, TC04 Screenshot,
TC05 Waveform, TC06 Recall, TC07 Acquisition, TC08 Channel,
TC10 CAN*, TC11 Timebase, TC12 Multi-meas, TC13 Full capture,
TC14 Error status, TC15 OPC sync, TC16 Session .tss*, TC17 Edit by ID
(* = sometimes needs fallback)

## Failing Tests
- TC09 Trigger edge — rate limit cascade (Fix 1 + Fix 5 would help)
- TC16 Session .tss — rate limit on complex prompt (Fix 5 would help) 
- TC18 tm_devices — no RAG data (Fix 4 required)
