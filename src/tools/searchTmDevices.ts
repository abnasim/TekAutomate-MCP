import { getTmDevicesIndex } from '../core/tmDevicesIndex';
import type { ToolResult } from '../core/schemas';

interface SearchTmDevicesInput {
  query: string;
  model?: string;
  limit?: number;
}

export async function searchTmDevices(
  input: SearchTmDevicesInput
): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getTmDevicesIndex();
  const docs = index.search(q, input.model, input.limit || 10);
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
