import type { ToolResult } from '../core/schemas';
import { getCurrentWorkflowState } from './runtimeContextStore';

export async function getCurrentWorkflow(): Promise<ToolResult<Record<string, unknown>>> {
  return {
    ok: true,
    data: getCurrentWorkflowState(),
    sourceMeta: [],
    warnings: [],
  };
}
