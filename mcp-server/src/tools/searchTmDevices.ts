import { getTmDevicesIndex } from '../core/tmDevicesIndex';
import type { ToolResult } from '../core/schemas';

interface SearchTmDevicesInput {
  query: string;
  model?: string;
  limit?: number;
}

function methodPathCandidates(raw: string): string[] {
  const q = String(raw || '').trim();
  if (!q) return [];
  const candidates = new Set<string>([q]);
  candidates.add(q.replace(/\[\d+\]/g, '[x]'));
  candidates.add(q.replace(/\bch\d+\b/gi, 'ch[x]'));
  return Array.from(candidates).filter(Boolean);
}

export async function searchTmDevices(
  input: SearchTmDevicesInput
): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getTmDevicesIndex();
  const limit = input.limit || 10;
  const directDocs = (q.includes('.') || /\[[x0-9]+\]/i.test(q))
    ? methodPathCandidates(q)
        .map((candidate) => index.getByMethodPath(candidate, input.model))
        .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
        .map((doc) => ({ ...doc, availableForModel: true }))
    : [];
  const fuzzyDocs = index.search(q, input.model, limit);
  const seen = new Set<string>();
  const docs = [...directDocs, ...fuzzyDocs].filter((doc) => {
    const key = `${doc.modelRoot}:${doc.methodPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
  return {
    ok: true,
    data: docs.map((d) => ({
      modelRoot: d.modelRoot,
      methodPath: d.methodPath,
      signature: d.signature,
      description: d.text,
      usageExample: d.usageExample,
      availableForModel: d.availableForModel,
      warning: d.availableForModel ? undefined : 'Method unavailable for requested model',
    })),
    sourceMeta: docs.map((d) => ({
      file: 'tm_devices_full_tree.json',
      commandId: d.methodPath,
      section: d.modelRoot,
    })),
    warnings: docs.length ? [] : ['No tm_devices methods matched query'],
  };
}
