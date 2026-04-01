import type { ToolResult } from '../core/schemas';
import { getRunLogState } from './runtimeContextStore';

export async function getRunLog(): Promise<ToolResult<Record<string, unknown>>> {
  return {
    ok: true,
    data: getRunLogState(),
    sourceMeta: [],
    warnings: [],
  };
}
