# P3: OpenAI Responses API Adapter — Done

## Commit
`a354420` — feat(ai): add OpenAI Responses API adapter (P3)

## Files changed
| File | Change |
|------|--------|
| `src/utils/ai/providers/openaiResponsesAdapter.ts` | **NEW** — OpenAiResponsesAdapter class |
| `src/utils/ai/types.ts` | AiProvider union extended: `'openai' \| 'anthropic' \| 'openai-responses'` |
| `src/components/ExecutePage/aiChatReducer.ts` | DEFAULT_MODEL_BY_PROVIDER gains `'openai-responses': 'gpt-4o'` |
| `src/components/ExecutePage/useAiChat.ts` | Import, vectorStoreId state, openai-responses branch, hydration fix, setProvider typed as AiProvider |
| `src/components/ExecutePage/aiChatPanel.tsx` | Destructure vectorStoreId/setVectorStoreId, new dropdown option, conditional Vector Store ID input |

## Adapter behaviour
- `POST /v1/responses` with `input[]` (system + history + user), `stream: true`
- Attaches `tools: [{ type: "file_search", vector_store_ids: [...] }]` only when vectorStoreId is non-empty
- SSE parser handles `response.output_text.delta` via both event-header and inline `type` field
- `OpenAI-Beta: responses=v1` header included

## TypeScript
- `npx tsc --noEmit 2>&1 | grep -E "ResponsesAdapter|openaiResponses|vectorStore"` → **zero errors**
- Only pre-existing node_modules/react-hook-form errors in full output (unrelated to this change)

## localStorage keys
- `TEKAUTOMATE_VECTOR_STORE_ID` — persists vector store ID across sessions

## Constraints honoured
- openaiAdapter.ts and anthropicAdapter.ts untouched
- MCP path untouched
- Works without vectorStoreId (omits file_search, falls back to pure completion)
