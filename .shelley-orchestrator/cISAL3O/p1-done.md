# P1: MCP Default Chat Path — Done

## Files Changed

### 1. `src/components/ExecutePage/useAiChat.ts`
- **Replaced** the `useMcp = useMemo(...)` block (which required `REACT_APP_AI_USE_MCP === 'true'` to enable MCP) with a `useState<boolean>` initializer that defaults to **true** (MCP on by default).
- Priority order:
  1. `REACT_APP_AI_USE_MCP === 'false'` → force-disabled
  2. `localStorage.getItem('TEKAUTOMATE_USE_MCP')` → user override ('true'/'false')
  3. Default: **true** (MCP on)
- Added `setMcpEnabled(val: boolean)` which persists to localStorage and updates state.
- `const useMcp = mcpEnabled` so all existing internal logic is unchanged.
- Added `console.warn` in the catch block noting which mode failed.
- Exported `mcpEnabled` and `setMcpEnabled` from the hook return value.
- Minor cleanup: collapsed 5 separate React import lines into one.

### 2. `src/utils/ai/mcpClient.ts`
- Added `export async function pingMcp(): Promise<boolean>` at the end of the file.
- Uses `REACT_APP_MCP_HOST || 'http://localhost:8787'`, hits `/health` with a 2-second `AbortSignal.timeout`, returns `true` if `res.ok`, `false` on any error.

### 3. `src/components/ExecutePage/aiChatPanel.tsx`
- Destructured `mcpEnabled` and `setMcpEnabled` from `useAiChat(...)`.
- Added an **AI Engine** toggle row at the top of the settings panel (above Provider select) with two buttons: **MCP** (recommended) and **Direct API**. Active button is highlighted blue; inactive is neutral.

## Constraints Verified
- Direct API path untouched — still fully functional when `mcpEnabled = false`.
- MCP server unchanged.
- `npx tsc --noEmit` reports zero errors in all three touched files.
