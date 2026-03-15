import { getCommandIndex } from './commandIndex';
import type { McpChatRequest } from './schemas';

export async function buildScpiContext(req: McpChatRequest): Promise<string> {
  const idx = await getCommandIndex();
  const results = idx.searchByQuery(req.userMessage, req.flowContext.modelFamily, 10);
  if (!results.length) return '';

  const wantTmDevices = (req.flowContext.backend || '').toLowerCase() === 'tm_devices';

  return results
    .map((r) => {
      const entry = (r.raw as Record<string, unknown>)._manualEntry || r.raw;
      const serialized = JSON.stringify(entry, null, 2);
      if (!wantTmDevices) return serialized;

      const tmExamples = Array.isArray((entry as any).codeExamples)
        ? (entry as any).codeExamples
            .map((ce: any) => ce?.tm_devices?.code)
            .filter((c: unknown) => typeof c === 'string' && c.trim().length > 0)
        : [];
      if (!tmExamples.length) return serialized;

      return `${serialized}\nTM_DEVICES_EXAMPLES:\n${tmExamples.join('\n')}`;
    })
    .join('\n\n---\n\n');
}
