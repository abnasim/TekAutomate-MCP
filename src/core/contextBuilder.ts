import { getCommandIndex } from './commandIndex';
import type { McpChatRequest } from './schemas';

export async function buildScpiContext(req: McpChatRequest): Promise<string> {
  const idx = await getCommandIndex();
  const results = idx.searchByQuery(req.userMessage, req.flowContext.modelFamily, 10);
  if (!results.length) return '';

  return results
    .map((r) => JSON.stringify((r.raw as Record<string, unknown>)._manualEntry || r.raw, null, 2))
    .join('\n\n---\n\n');
}
