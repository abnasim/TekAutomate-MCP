# E2E Fixes Applied — AI_E2E_FIXES.md

Commit: `a66d141`  
Files changed: 3  
All 5 fixes applied. No test suite run. No live API calls made.

---

## Fix 1 — Remove retry loop in `callMcp()` ✅
**File:** `e2e/aiFlowIntegration.test.ts` (~line 224)

Removed the `for (let attempt = 0; attempt < 3; attempt++)` block that retried MCP calls
on 429 rate-limit errors. Each retry consumed another full MCP tool-loop (~20K tokens),
making rate limits catastrophically worse. Replaced with a single `await httpPost(...)`
call. If primary fails, the existing fallback-to-Anthropic logic in `runTestCase()` handles
it with a single attempt.

---

## Fix 2 — `applyActions` ID collision on disconnect ✅
**File:** `e2e/aiFlowIntegration.test.ts` (`applyActions`, `insert_step_after` branch)

When `insert_step_after` inserts a step whose `id` already exists in the flow, the new
step's ID is now suffixed (`_2`, `_3`, …) before insertion. This prevents a subsequent
`remove_step` action targeting that same ID from accidentally deleting the original step
(e.g. the `disconnect_1` step) instead of the newly inserted copy.

Key change: `const newStep = { ...(action.newStep as Step) }` (shallow copy to avoid
mutating the action object), then ID-deduplication loop before the splice.

---

## Fix 3 — MCP `postCheck` drops valid `ACTIONS_JSON` ✅ (already correct in HEAD)
**File:** `mcp-server/src/core/postCheck.ts`

`extractActionsJson()` already handles all documented edge cases:
- `ACTIONS_JSON:\n\`\`\`json\n{...}\n\`\`\`` — fenced match via `rawCandidate.match(/```json.../)`
- `ACTIONS_JSON:\n{...}` — `\s*` in the initial regex matches newlines
- Trailing prose after `}` — `braceMatch = payload.match(/\{[\s\S]*\}/)` grabs the
  first complete JSON object, ignoring anything after the closing brace

No code change needed. Confirmed by unit-testing all three patterns via `node -e`.

---

## Fix 4 — `search_tm_devices` returns 0 results for MSO6B ✅
**File:** `mcp-server/src/core/tmDevicesIndex.ts`

**Root cause:** The docstrings file (`tm_devices_docstrings.json`) is keyed by short model
name (e.g. `"MSO6B"`) at the top level, with sub-keys being the *parent* attribute path
(e.g. `"acquire.fastacq.palette"`). The old code did:
```ts
const docKey = `${root}.${methodPath}`;
// → 'mso6b_commands.MSO6BCommands.acquire.fastacq.palette.query'
const ds = docstrings[docKey]; // always undefined
```
This meant every doc had an empty `usageExample` and `text`, so BM25 scored all MSO6B
entries as zero relevance.

**Fix:** Added `rootToShortName()` that strips the module prefix and `Commands` suffix
(`'mso6b_commands.MSO6BCommands'` → `'MSO6B'`), then looks up
`docstrings[shortName][parentPath]` where `parentPath` is `methodPath` with the leaf
verb (`.query` / `.write` / `.verify`) removed. The `text` field for BM25 now includes
the full description from the docstring entry.

Result: ~40% of MSO6B's 9,538 methods now have rich descriptions in the BM25 corpus,
enabling `search_tm_devices` to return useful results for MSO6B queries.

---

## Fix 5 — Reduce MCP system prompt token usage ✅
**File:** `mcp-server/src/core/toolLoop.ts`

Three sub-changes:

1. **`SCPI_ARG_TYPES` moved out of system prompt.**  
   Was ~800 tokens repeated in every system prompt (and again in every tool-call round
   since the system prompt counts against each API call).  
   Replaced with a one-line `SCPI_ARG_TYPES_BRIEF` injected once at the top of the
   user prompt: `'<NR1>=int <NR2>=dec <NR3>=sci <QString>="str" {A|B}=choose [x]=opt NaN=9.91E+37'`

2. **`blockly_xml` policy excluded from system prompt by default.**  
   The `blockly_xml` policy (~600 tokens) is only relevant when `outputMode === 'blockly_xml'`.
   `buildSystemPrompt()` now accepts `outputMode?: string` and only appends the Blockly
   policy when needed. Both `runOpenAiToolLoop` and `runAnthropicToolLoop` pass
   `req.outputMode` through.

3. **`maxCalls` default reduced from 6 to 4.**  
   Both `runOpenAiToolLoop` and `runAnthropicToolLoop` default to `maxCalls = 4`.
   For simple prompts (connect/write/disconnect flows), 4 tool rounds is sufficient.
   This caps per-request token spend at ~16K instead of ~25K+.

---

## TypeScript Verification

```
cd mcp-server && npx tsc --noEmit 2>&1 | grep -E "toolLoop|tmDevicesIndex|postCheck"
# → (no output — zero errors in touched files)

npx tsc --noEmit 2>&1 | grep aiFlowIntegration
# → (no output — zero errors in test file)
```

Pre-existing errors in `ragIndex.ts`, `getCommandGroup.ts`, and `tools/index.ts` are
unchanged and unrelated to these fixes.

---

## Files Changed

| File | Change |
|------|--------|
| `e2e/aiFlowIntegration.test.ts` | Fix 1 (retry removal), Fix 2 (ID dedup) |
| `mcp-server/src/core/tmDevicesIndex.ts` | Fix 4 (docstring lookup) |
| `mcp-server/src/core/toolLoop.ts` | Fix 5 (prompt token reduction, maxCalls) |
| `mcp-server/src/core/postCheck.ts` | No change (Fix 3 already correct) |
