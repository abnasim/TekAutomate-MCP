# TekAutomate Context-Aware Chat — Implementation Plan

## Overview
The full chat→AI→actions→flow pipeline already works. This plan upgrades it in 4 priority tiers.

---

## P1: Make MCP the Default Path (Small)

### Goal
MCP tool loop (search_scpi, get_command_by_header) is far superior to BM25 for SCPI accuracy.
Currently gated behind REACT_APP_AI_USE_MCP=true env var. Make it default ON with graceful fallback.

### Files to change

**src/components/ExecutePage/useAiChat.ts** (lines ~100-105)
- Change: `const useMcp = useMemo(() => process.env.REACT_APP_AI_USE_MCP === 'true', []);`
- To: `const useMcp = useMemo(() => process.env.REACT_APP_AI_USE_MCP !== 'false', []);`
  (default ON, opt-out with REACT_APP_AI_USE_MCP=false)
- Add UI toggle: expose `useMcp` state + setter, persist to localStorage key `TEKAUTOMATE_USE_MCP`
- In the MCP error catch block: if fetch fails with network error (MCP server unreachable),
  set a ref `mcpUnavailable = true` and fall through to direct API path automatically

**src/components/ExecutePage/aiChatPanel.tsx**
- Add a small toggle in the settings panel: "AI Engine: MCP (recommended) / Direct API"
- Shows MCP server status indicator (green dot if reachable, red if fallback active)

**src/utils/ai/mcpClient.ts**
- Add `pingMcp(): Promise<boolean>` — does a HEAD or GET /health to localhost:8787
- Call on mount in useAiChat to pre-check MCP availability

### Preserve
- Direct API path (BM25 + contextAssembler) must remain fully functional as fallback
- No changes to MCP server itself

---

## P2: Richer Context Injection (Medium)

### Goal
AI needs to know: device type, flow validation errors, selected step full details.
Currently MCP gets selectedStepId but not the step's actual content.
Currently neither path gets flow validation errors.

### Files to change

**src/utils/ai/mcpClient.ts** — extend McpChatRequest
```typescript
flowContext: {
  // existing fields...
  deviceType: string;           // 'SCOPE' | 'AWG' | 'AFG' | 'PSU' | 'SMU' | 'DMM' | 'DAQ' | 'MT' | 'MF' | 'SS'
  selectedStep: CompressedStep | null;  // full step, not just ID
  validationErrors: string[];   // ['Step abc: query missing saveAs', 'No disconnect step']
}
```

**src/components/ExecutePage/useAiChat.ts**
- Import `validateSteps` (already exists in strictValidators.ts or similar)
- Derive `validationErrors` from `validateSteps(steps)` — useMemo, recomputes on steps change
- Derive `deviceType` from connect step params (already done in inferExecutionContext — reuse it)
- Derive `selectedStep` by finding the step with id === selectedStepId in the steps tree
- Pass all three into buildMcpRequest

**src/utils/ai/contextAssembler.ts**
- Add `validationErrors` to the system prompt's active constraints block
- Add `deviceType` to the flow context section of userPrompt
- Add `selectedStep` (full compressed) to userPrompt when present

### Where validationErrors comes from
- `src/utils/ai/strictValidators.ts` or `src/utils/validateFlow.ts` — find and import
- If not importable, inline: check for missing saveAs on query steps, no disconnect, group missing children

### Preserve
- Don't change the shape of actions/ACTIONS_JSON — only adding context going in
- Keep token budgets in contextAssembler

---

## P3: OpenAI Responses API Adapter (Medium)

### Goal
Wire the user's Responses API setup (file_search + vector store) as a new provider option.
The AI_RAG/ markdown files are the content backing the vector store.

### Files to create

**src/utils/ai/providers/openaiResponsesAdapter.ts** — new file
```typescript
// Uses /v1/responses endpoint with file_search tool
// Replaces BM25 RAG retrieval for the direct API path
export class OpenAiResponsesAdapter {
  async streamResponse(input: AssembledContext, onChunk: (chunk: string) => void): Promise<void> {
    // POST to /v1/responses with:
    // - model: gpt-4o or configured model  
    // - input: [system message, ...history, user message]
    // - tools: [{ type: 'file_search', vector_store_ids: [VECTOR_STORE_ID] }]
    // - stream: true
    // Parse SSE stream, extract text deltas, call onChunk
  }
}
```

**src/utils/ai/providers/index.ts** — add ResponsesAdapter to provider map

**src/components/ExecutePage/aiChatPanel.tsx** — settings panel
- Add provider option: "OpenAI Responses API (Vector Store)"
- Add input for Vector Store ID (persist to localStorage)

**src/utils/ai/useAiChat.ts**
- When provider === 'openai-responses': skip BM25 retrieval, use ResponsesAdapter directly
  (file_search handles retrieval server-side)

### Environment / config
- `REACT_APP_OPENAI_VECTOR_STORE_ID` — optional env var, can also be set in UI settings
- The adapter reads this from env or from state.vectorStoreId

### Preserve
- Existing openaiAdapter (Chat Completions) remains unchanged
- BM25 path still used when provider is 'openai' or 'anthropic'

---

## P4: Proactive Suggestions (Medium)

### Goal
After every flow change (manual or AI-applied), run validation and surface fix chips.
Dynamic quick actions based on current flow state.

### Files to change

**src/components/ExecutePage/useAiChat.ts**
- Add `useMemo` that runs flow validation on every `steps` change:
  ```typescript
  const proactiveSuggestions = useMemo(() => {
    const errors = validateSteps(steps);
    return errors.map(e => ({
      id: e.stepId,
      label: e.message,
      fixAction: buildFixAction(e),  // generates the AiAction to fix it
    }));
  }, [steps]);
  ```
- Add `dynamicQuickActions` derived from flow state:
  - hasTmDevices → show "Check tm_devices Path"
  - hasValidationErrors → show "Fix all N issues"
  - noMeasurements + hasScope → show "Add measurements"
  - hasScreenshot → show "Verify screenshot config"

**src/components/ExecutePage/aiChatPanel.tsx**
- Add `ProactiveSuggestionsBar` section above the message input:
  - Shows up to 3 chips: "💡 2 query steps missing saveAs — Fix all"
  - Each chip has an "Apply" button (calls applyActionsFromTurn with pre-built actions)
    OR a "Ask AI" button (pre-populates the message box)
  - Dismissible (stores dismissed IDs in useRef, cleared when steps change)
- Replace hardcoded `quickActions` array with `dynamicQuickActions` from useAiChat

### New utility: src/utils/ai/flowSuggestions.ts
```typescript
export interface FlowSuggestion {
  id: string;
  label: string;
  severity: 'error' | 'warning' | 'info';
  fixAction?: AiAction;       // instant apply if deterministic
  chatPrompt?: string;        // pre-filled message if needs AI
}

export function computeFlowSuggestions(steps: StepPreview[]): FlowSuggestion[] {
  // Rule 1: query steps missing saveAs
  // Rule 2: no disconnect step
  // Rule 3: tm_device_command with pyvisa backend
  // Rule 4: set_and_query with wrong params (queryCommand instead of cmdParams)
  // Rule 5: group missing children:[] or params:{}
}
```

### Preserve
- Don't change AiAction schema
- Don't auto-apply without user confirmation
- Suggestions are advisory, not blocking

---

## Dependencies

P1 → must be done first (enables P2 to test over MCP)
P2 → can be done in parallel with P3
P3 → independent of P1/P2 (new adapter, no existing code changed)
P4 → depends on P2 (needs validateSteps utility)

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| MCP server not running in dev | Ping check + auto-fallback in useAiChat |
| Responses API vector store ID not configured | Graceful error: "Configure Vector Store ID in settings" |
| Token budget blowup from richer context | Keep existing trimToTokenBudget; validationErrors capped at 5 items |
| Proactive chips are annoying | Dismissible per-session, only show on steps change not every render |
| Blockly mode has different flow state | All suggestions check executionSource and skip if blockly |

---

## Implementation Order

1. **P1** — 1 file change + 1 small UI toggle (~50 lines)
2. **P2** — extend McpChatRequest + derive 3 new context fields (~100 lines)  
3. **P4 flowSuggestions.ts** — pure utility, no UI yet (~80 lines)
4. **P4 UI chips** — ProactiveSuggestionsBar + dynamic quick actions (~100 lines)
5. **P3** — new Responses API adapter (~150 lines)
