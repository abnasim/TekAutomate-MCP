import type { ToolResult } from '../core/schemas';
import { getLiveSessionState } from './runtimeContextStore';
import { pushLiveProposal } from './liveActionBridge';

export interface StagedWorkflowProposal {
  id: string;
  createdAt: string;
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  actions: unknown[];
  sessionKey: string;
}

interface StageWorkflowProposalInput {
  summary?: unknown;
  findings?: unknown[];
  suggestedFixes?: unknown[];
  actions?: unknown[];
  sessionKey?: unknown;
}

// Keyed by sessionKey — supports multiple concurrent users on the same public MCP.
// Falls back to 'default' when no sessionKey is provided (legacy / single-user).
const proposalsBySession = new Map<string, StagedWorkflowProposal>();
const MAX_SESSIONS = 500; // guard against unbounded growth

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function cleanSummary(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function createProposalId(): string {
  return `proposal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getLastWorkflowProposal(sessionKey?: string): StagedWorkflowProposal | null {
  const key = String(sessionKey || '').trim() || 'default';
  return proposalsBySession.get(key) ?? null;
}

export async function stageWorkflowProposal(
  input: StageWorkflowProposalInput
): Promise<ToolResult<Record<string, unknown>>> {
  const actions = Array.isArray(input.actions) ? input.actions : [];
  if (actions.length === 0) {
    return {
      ok: false,
      data: {
        ok: false,
        error:
          'stage_workflow_proposal requires a non-empty actions array. ' +
          'Copy build_or_edit_workflow.data.actions directly into this tool call.',
        actionCount: 0,
      },
      sourceMeta: [],
      warnings: ['Proposal was not staged because no actions were provided.'],
    };
  }

  // If agent didn't pass sessionKey (e.g. new flow, skipped workflow_ui{current}),
  // auto-inject from runtime context — the browser always pushes its sessionKey there.
  const sessionKey =
    String(input.sessionKey || '').trim() ||
    getLiveSessionState().sessionKey ||
    'default';

  const proposal: StagedWorkflowProposal = {
    id: createProposalId(),
    createdAt: new Date().toISOString(),
    summary: cleanSummary(input.summary),
    findings: toStringList(input.findings),
    suggestedFixes: toStringList(input.suggestedFixes),
    actions,
    sessionKey,
  };

  // Evict oldest entry if we hit the cap (prevents unbounded memory growth)
  if (proposalsBySession.size >= MAX_SESSIONS) {
    const oldestKey = proposalsBySession.keys().next().value;
    if (oldestKey !== undefined) proposalsBySession.delete(oldestKey);
  }

  proposalsBySession.set(sessionKey, proposal);

  // Push to browser instantly via live bridge (fire-and-forget).
  // Browser polls /live-actions/next?sessionKey=<key>:proposal — no live instrument needed.
  if (sessionKey !== 'default') {
    console.log(
      `[stage_workflow_proposal] Pushing proposal ${proposal.id} to live bridge. sessionKey=${sessionKey} actions=${actions.length}`,
    );
    pushLiveProposal(proposal, sessionKey);
  } else {
    console.warn(
      `[stage_workflow_proposal] sessionKey resolved to 'default' — browser will not receive proposal. ` +
      `Check that the browser is pushing liveSession to /runtime-context and the agent is passing sessionKey.`,
    );
  }

  return {
    ok: true,
    data: {
      ok: true,
      proposalId: proposal.id,
      createdAt: proposal.createdAt,
      actionCount: actions.length,
      summary: proposal.summary,
      sessionKey,
    },
    sourceMeta: [],
    warnings: [],
  };
}
