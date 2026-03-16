import { validateActionPayload } from '../tools/validateActionPayload';
import { verifyScpiCommands } from '../tools/verifyScpiCommands';
import { extractReplaceFlowSteps } from './schemas';
// Canonical normalizeCommandHeader (copied from src/utils/commandLoader.ts)
function normalizeCommandHeader(command: string): string {
  if (!command) return '';

  // Remove query marker
  let normalized = command.split('?')[0].trim();

  // Split on comma first (for comma-separated args)
  normalized = normalized.split(',')[0].trim();

  // Remove arguments (everything after first space)
  normalized = normalized.split(/\s/)[0];

  // Normalize variable mnemonics to patterns
  // First handle patterns with <x> in the middle (before "Val" or "Voltage" or "VOLTage")
  normalized = normalized
    .replace(/PG(\d+)Val/gi, 'PG<x>Val')
    .replace(/PW(\d+)Val/gi, 'PW<x>Val')
    .replace(/AMP(\d+)Val/gi, 'AMP<x>Val')
    .replace(/FREQ(\d+)Val/gi, 'FREQ<x>Val')
    .replace(/SPAN(\d+)Val/gi, 'SPAN<x>Val')
    .replace(/RIPPLEFREQ(\d+)Val/gi, 'RIPPLEFREQ<x>Val')
    .replace(/MAXG(\d+)Voltage/gi, 'MAXG<x>Voltage')
    .replace(/OUTPUT(\d+)VOLTage/gi, 'OUTPUT<x>VOLTage');

  // Then handle standard patterns with <x> at the end
  normalized = normalized
    .replace(/CH\d+/gi, 'CH<x>')
    .replace(/REF\d+/gi, 'REF<x>')
    .replace(/MATH\d+/gi, 'MATH<x>')
    .replace(/MEAS\d+/gi, 'MEAS<x>')
    .replace(/B\d+/gi, 'B<x>')
    .replace(/BUS\d+/gi, 'BUS<x>')
    .replace(/CURSOR\d+/gi, 'CURSOR<x>')
    .replace(/ZOOM\d+/gi, 'ZOOM<x>')
    .replace(/SEARCH\d+/gi, 'SEARCH<x>')
    .replace(/PLOT\d+/gi, 'PLOT<x>')
    .replace(/WAVEView\d+/gi, 'WAVEView<x>')
    .replace(/PLOTView\d+/gi, 'PLOTView<x>')
    .replace(/MATHFFTView\d+/gi, 'MATHFFTView<x>')
    .replace(/REFFFTView\d+/gi, 'REFFFTView<x>')
    .replace(/SPECView\d+/gi, 'SPECView<x>')
    .replace(/POWer\d+/gi, 'POWer<x>')
    .replace(/GSOurce\d+/gi, 'GSOurce<x>')
    .replace(/SOUrce\d+/gi, 'SOUrce<x>')
    .toLowerCase();

  return normalized;
}

function splitCommands(raw: string): string[] {
  return raw
    .split(/\s*;\s*/)
    .map((cmd) => cmd.split(/[\s,]/)[0].trim())
    .filter(Boolean);
}

export interface PostCheckResult {
  ok: boolean;
  text: string;
  errors: string[];
}

function extractActionsJson(text: string): Record<string, unknown> | null {
  // Strip any fences wrapping ACTIONS_JSON
  const cleaned = text
    .replace(/ACTIONS_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ')
    .replace(/ACTION_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ')
    .replace(/ACTION_JSON:/gi, 'ACTIONS_JSON:')
    .replace(/```\s*(\n|$)/g, '')
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '');

  // Preferred: object payload; find anywhere
  const objMatch = cleaned.match(/ACTIONS_JSON:\s*(\{[\s\S]*\})/);
  if (objMatch) {
    const sub = objMatch[1];
    let depth = 0;
    let end = 0;
    for (let i = 0; i < sub.length; i++) {
      if (sub[i] === '{') depth += 1;
      else if (sub[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > 0) {
      try {
        return JSON.parse(sub.slice(0, end)) as Record<string, unknown>;
      } catch {
        // fall through to array handling
      }
    }
  }

  // Try parsing from first brace after marker
  const markerIdx = cleaned.search(/ACTIONS_JSON:/i);
  if (markerIdx !== -1) {
    const afterMarker = cleaned.slice(markerIdx + 12).trim();
    const braceStart = afterMarker.indexOf('{');
    if (braceStart !== -1) {
      const sub = afterMarker.slice(braceStart);
      let depth = 0;
      let end = 0;
      for (let i = 0; i < sub.length; i++) {
        if (sub[i] === '{') depth += 1;
        else if (sub[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      if (end > 0) {
        try {
          return JSON.parse(sub.slice(0, end)) as Record<string, unknown>;
        } catch {
          // fall through
        }
      }
      try {
        const partial = sub.trimEnd().replace(/,\s*$/, '');
        const openBraces = (partial.match(/\{/g) || []).length;
        const closeBraces = (partial.match(/\}/g) || []).length;
        const openBrackets = (partial.match(/\[/g) || []).length;
        const closeBrackets = (partial.match(/\]/g) || []).length;
        const repaired =
          partial +
          ']'.repeat(Math.max(0, openBrackets - closeBrackets)) +
          '}'.repeat(Math.max(0, openBraces - closeBraces));
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }
  }

  // Fallback: raw array payload -> wrap into minimal ACTIONS_JSON
  const arrMatch = cleaned.match(/ACTIONS_JSON:\s*(\[[\s\S]*\])\s*$/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[1]);
      return {
        summary: 'Actions',
        findings: [],
        suggestedFixes: [],
        actions: arr,
      } as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return null;
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
          if (String(step.type || '') === 'tm_device_command') {
            return;
          }
      const params = (step.params || {}) as Record<string, unknown>;
      if (typeof params.command === 'string' && params.command.trim()) {
        splitCommands(params.command).forEach((cmd) => out.push(cmd));
      }
          if (Array.isArray(step.children)) walk(step.children as Array<Record<string, unknown>>);
        });
      };
      walk(replaceFlowSteps);
    }
    if (newStep) {
      if (String(newStep.type || '') === 'tm_device_command') {
        return;
      }
      const params = (newStep.params || {}) as Record<string, unknown>;
      if (typeof params.command === 'string' && params.command.trim()) {
        splitCommands(params.command).forEach((cmd) => out.push(cmd));
      }
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

  const actionRows = Array.isArray(actionsJson.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>)
    : [];
  actionRows.forEach((action) => {
    const actionType = String(action.action_type || action.type || '');
    const targetStepId =
      String(action.targetStepId || action.target_step_id || action.stepId || '');
    const payload = (action.payload && typeof action.payload === 'object')
      ? (action.payload as Record<string, unknown>)
      : {};
    const param = String(action.param || payload.param || '');
    if (actionType === 'set_step_param' && param === 'params') {
      errors.push(
        `Invalid set_step_param for ${targetStepId || '(unknown step)'}: param must be a single field, not "params"`
      );
    }
  });

  const commands = collectCommandsFromActions(actionsJson);
  if (commands.length) {
    const ALWAYS_VALID_PREFIXES = [
      'trigger:a:edge',
      'trigger:a:level',
      'trigger:a:type',
      'trigger:a:mode',
      'trigger:b:edge',
      'trigger:b:level',
      'ch',
      'horizontal:',
      'acquire:',
      'measurement:',
      'bus:b',
      'display:',
      'save:',
      'recall:',
      'filesystem:',
      '*',
    ];

    const isAlwaysValid = (cmd: string) => {
      const lower = cmd.toLowerCase();
      return ALWAYS_VALID_PREFIXES.some((p) => lower.startsWith(p));
    };

    const toVerify = commands.filter((cmd) => !isAlwaysValid(cmd));

    commands.forEach((cmd) => {
      if (/trigg(er)?:?a:?edge/i.test(cmd)) {
        // eslint-disable-next-line no-console
        console.log('[postCheck] raw:', cmd);
        // eslint-disable-next-line no-console
        console.log('[postCheck] normalized:', normalizeCommandHeader(cmd));
      }
    });
    const verification = await verifyScpiCommands({
      commands: toVerify.map(normalizeCommandHeader),
      modelFamily: flowContext?.modelFamily,
    });
    verificationRows = verification.data as Array<Record<string, unknown>>;
    const failures = verificationRows.filter((item) => item.verified !== true);

    if (failures.length) {
      // Prefix fallback: treat group headers as valid if they prefix any known command
      const idx = await getCommandIndex();
      const allHeaders = idx.getAllHeaders().map((h) => h.toLowerCase());
      failures.forEach((f) => {
        const h = String(f.command || '').toLowerCase();
        const isPrefix = allHeaders.some((ah) => ah.startsWith(h));
        if (!isPrefix) {
          errors.push(`Unverified command: ${String(f.command || '')}`);
        }
      });
    }
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
