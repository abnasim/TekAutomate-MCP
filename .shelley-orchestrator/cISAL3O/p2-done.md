# P2: Richer Context Injection — Done

## Commit
`5fd6797` — feat(P2): richer context injection for AI chat

## Changes Made

### 1. `src/utils/ai/mcpClient.ts`
- Added `deviceType?: string`, `selectedStep?: CompressedStep | null`, `validationErrors?: string[]` to `McpChatRequest.flowContext`
- Added the same optional fields to `buildMcpRequest` input type
- `buildMcpRequest` now maps all three new fields through to the returned request object

### 2. `src/components/ExecutePage/useAiChat.ts`
- Imported `compressStep` from `../../utils/ai/contextAssembler`
- Added `selectedStepId?: string | null` to the `params` interface
- Added three new `useMemo` derivations:
  - **`deviceType`**: walks steps to find connect step, maps `devType`/`modelFamily`/`deviceDriver` to enum (`SCOPE`/`AWG`/`AFG`/`SMU`); defaults to `SCOPE`
  - **`selectedStep`**: finds step matching `params.selectedStepId` and returns `compressStep(found)` or null
  - **`validationErrors`**: inline checks — query missing saveAs, no disconnect step, flow doesn't start with connect, groups missing children array; capped at 5
- Both `buildMcpRequest` calls (main + coercion retry) now receive `deviceType`, `selectedStep`, `validationErrors` and use `params.selectedStepId ?? null` instead of hard-coded `null`

### 3. `src/utils/ai/contextAssembler.ts`
- Added optional fields to `assembleAiContext` input type: `validationErrors?`, `deviceType?`, `selectedStep?`
- Appended to `userPrompt` (each guarded by presence check, trimmed to 200-token budget):
  - `## Current Validation Errors` section
  - `Device Type: <type>` line
  - `## Currently Selected Step` section with JSON

## TypeScript Status
- Zero errors in target files (`mcpClient`, `contextAssembler`, `useAiChat`)
- 11 pre-existing errors in `node_modules/react-hook-form` (unrelated, existed before P2)

## Token Budget Impact
- ≤ 300 tokens added to prompts (each section capped at 200 tokens)
- ACTIONS_JSON schema unchanged
