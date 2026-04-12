import type { ToolResult } from '../core/schemas';
import { getCurrentWorkflowState, getLiveSessionState } from './runtimeContextStore';

export async function getCurrentWorkflow(): Promise<ToolResult<Record<string, unknown>>> {
  const workflow = getCurrentWorkflowState();
  const liveSession = getLiveSessionState();

  return {
    ok: true,
    data: {
      ...(workflow as unknown as Record<string, unknown>),
      // sessionKey is returned so the agent can pass it back in workflow_ui{stage}.
      // This is how proposals are isolated per user on the shared public MCP.
      sessionKey: liveSession.sessionKey ?? null,
    },
    sourceMeta: [],
    warnings: [],
  };
}
