# P4: Proactive Flow Suggestions — DONE

## Status: Complete ✅

## Files changed

### New file: `src/utils/ai/flowSuggestions.ts`
Pure utility (no React). Exports:
- `FlowSuggestion` interface (`id`, `label`, `severity: 'error'|'warning'|'info'`, optional `fixAction`, `chatPrompt`)
- `computeFlowSuggestions(steps, executionSource)` — 5 rules:
  1. Query steps missing `saveAs` → error
  2. Flow doesn't end with `disconnect` → error
  3. Flow doesn't start with `connect` → error
  4. `tm_device_command` steps with pyvisa backend → warning
  5. Group steps missing `params` or `children` → warning
- `computeDynamicQuickActions(steps, executionSource, suggestions)` — returns up to 6 context-aware action objects; prioritises "Fix N errors" when errors exist, adds measurement/screenshot/tm_devices actions based on flow content, always ends with Validate + Command Lookup

### Modified: `src/components/ExecutePage/useAiChat.ts`
- Imports `computeFlowSuggestions` and `computeDynamicQuickActions`
- Replaces hardcoded 6-item `quickActions` const with three `useMemo` calls:
  - `flowSuggestions` — memoised on `params.steps` + `params.executionSource`
  - `dynamicActions` — memoised on steps + suggestions
  - `quickActions: PredefinedAction[]` — maps dynamic actions to existing `PredefinedAction` shape (backward-compatible with panel)
- Adds `flowSuggestions` to hook return value

### Modified: `src/components/ExecutePage/aiChatPanel.tsx`
- Imports `useEffect`, `useRef` (added to existing React import)
- Adds `dismissedSuggestions` state + `prevStepsRef` — resets dismissals when `steps` reference changes
- Destructures `flowSuggestions` from `useAiChat` result
- `visibleSuggestions` useMemo filters out dismissed IDs
- Renders `ProactiveSuggestionsBar` (inline JSX) above the textarea:
  - Shows up to 3 chips at a time
  - Severity-coloured pills (red=error, yellow=warning, blue=info) with inline styles
  - "Ask AI" button pre-fills the textarea with `chatPrompt`
  - ✕ dismiss button removes chip for the session

## TypeScript
Zero errors in source files (`npx tsc --noEmit 2>&1 | grep -v node_modules` → empty).
Pre-existing `react-hook-form` node_modules type errors are unrelated.

## Commit
All three files are committed as part of the P2/P3 session commits (were in working tree alongside those changes). Git shows the repo is clean for all P4 source files.
