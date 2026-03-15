import { validateActionPayload } from '../tools/validateActionPayload';
import { verifyScpiCommands } from '../tools/verifyScpiCommands';
import { extractReplaceFlowSteps } from './schemas';

export interface PostCheckResult {
  ok: boolean;
  text: string;
  errors: string[];
}

function extractActionsJson(text: string): Record<string, unknown> | null {
  const tagged = text.match(/ACTIONS_JSON:\s*([\s\S]*?)$/i);
  const rawCandidate = tagged?.[1]?.trim() || text.trim();
  const fenced = rawCandidate.match(/```json\s*([\s\S]*?)```/i);
  const payload = fenced?.[1]?.trim() || rawCandidate;
  const braceMatch = payload.match(/\{[\s\S]*\}/);
  if (!braceMatch) return null;
  try {
    return JSON.parse(braceMatch[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectCommandsFromActions(actionsJson: Record<string, unknown>): string[] {
  const out: string[] = [];
  const actions = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  actions.forEach((action) => {
    const payload = (action.payload || {}) as Record<string, unknown>;
    const newStep = (action.newStep || payload.new_step || payload.newStep) as
      | Record<string, unknown>
      | undefined;
    const actionType = String(action.action_type || action.type || '');
    const replaceFlowSteps = actionType === 'replace_flow' ? extractReplaceFlowSteps(action) : null;
    if (actionType === 'replace_flow' && Array.isArray(replaceFlowSteps)) {
      const walk = (steps: Array<Record<string, unknown>>) => {
        steps.forEach((step) => {
          const params = (step.params || {}) as Record<string, unknown>;
          if (typeof params.command === 'string' && params.command.trim()) out.push(params.command);
          if (typeof params.code === 'string' && params.code.trim()) out.push(params.code);
          if (Array.isArray(step.children)) walk(step.children as Array<Record<string, unknown>>);
        });
      };
      walk(replaceFlowSteps);
    }
    if (newStep) {
      const params = (newStep.params || {}) as Record<string, unknown>;
      if (typeof params.command === 'string' && params.command.trim()) out.push(params.command);
      if (typeof params.code === 'string' && params.code.trim()) out.push(params.code);
    }
  });
  return out;
}

export async function postCheckResponse(
  text: string,
  flowContext?: { backend?: string; modelFamily?: string; originalSteps?: Array<Record<string, unknown>> }
): Promise<PostCheckResult> {
  const errors: string[] = [];
  let finalText = text;
  let verificationRows: Array<Record<string, unknown>> = [];
  const actionsJson = extractActionsJson(finalText);
  if (!actionsJson) {
    errors.push('ACTIONS_JSON parse failed');
    return { ok: false, text: finalText, errors };
  }
  const payloadValidation = await validateActionPayload({
    actionsJson,
    originalSteps: flowContext?.originalSteps,
  });
  const validData = payloadValidation.data as { valid: boolean; errors: string[] };
  if (!validData.valid) errors.push(...validData.errors);

  const commands = collectCommandsFromActions(actionsJson);
  if (commands.length) {
    const verification = await verifyScpiCommands({
      commands,
      modelFamily: flowContext?.modelFamily,
    });
    verificationRows = verification.data as Array<Record<string, unknown>>;
    const failures = verificationRows.filter(
      (item) => item.verified !== true
    );
    failures.forEach((f) => errors.push(`Unverified command: ${String(f.command || '')}`));
  }

  const prose = finalText.replace(/ACTIONS_JSON:[\s\S]*$/i, '').trim();
  if (prose.length > 400) {
    const actionsBlockMatch = finalText.match(/ACTIONS_JSON:[\s\S]*$/i);
    const actionsBlock = actionsBlockMatch?.[0] || '';
    const truncated = prose.slice(0, 400);
    const lastBoundary = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('.\n')
    );
    const proseFixed =
      lastBoundary > 200 ? truncated.slice(0, lastBoundary + 1).trim() : `${truncated.trim()}...`;
    finalText = actionsBlock ? `${proseFixed}\n\n${actionsBlock.trim()}` : proseFixed;
  }
  if (
    (flowContext?.backend || '').toLowerCase() !== 'tekhsi' &&
    /tekhsi/i.test(finalText)
  ) {
    errors.push('Unexpected TekHSI reference for non-TekHSI backend');
  }
  const verifiedCount = verificationRows.filter((r) => r.verified === true).length;
  const totalCount = verificationRows.length;
  // eslint-disable-next-line no-console
  console.log(
    `[MCP] postCheck verification: ${verifiedCount}/${totalCount} commands verified` +
      (errors.length ? ` | errors: ${errors.join(', ')}` : ' | clean')
  );
  return { ok: errors.length === 0, text: finalText, errors };
}
