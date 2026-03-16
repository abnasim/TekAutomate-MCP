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

const ALWAYS_VALID_PREFIXES = [
  'trig',
  'trigger',
  'ch<x>',
  'ch1',
  'ch2',
  'ch3',
  'ch4',
  'horizontal',
  'acquire',
  'acq',
  'search',
  'bus',
  'can',
  'afg',
  'awg',
  'source',
  'sour',
  'measure',
  'meas',
  'output',
  'outp',
  'display',
  'save',
  'recall',
  'filesystem',
  'meas:curr',
  'meas:volt',
  '*',
];

export interface PostCheckResult {
  ok: boolean;
  text: string;
  errors: string[];
  warnings: string[];
}

function rebuildTextWithActionsJson(text: string, actionsJson: Record<string, unknown>): string {
  const prose = text.replace(/ACTIONS_JSON:[\s\S]*$/i, '').trim();
  const block = `ACTIONS_JSON: ${JSON.stringify(actionsJson)}`;
  return prose ? `${prose}\n\n${block}` : block;
}

function isLongFlatFlow(steps: Array<Record<string, unknown>>): boolean {
  if (!Array.isArray(steps) || steps.length < 8) return false;
  const hasGroup = steps.some((s) => String(s.type || '').toLowerCase() === 'group');
  const hasNested = steps.some((s) => Array.isArray(s.children) && s.children.length > 0);
  return !hasGroup && !hasNested;
}

function classifyPhase(step: Record<string, unknown>): string {
  const type = String(step.type || '').toLowerCase();
  const params = (step.params || {}) as Record<string, unknown>;
  const cmd = String(params.command || '').toLowerCase();
  if (type === 'save_screenshot' || type === 'save_waveform' || /save|hardcopy|filesystem|export/.test(cmd)) return 'Save Results';
  if (/\*rst|\*cls|recall|preset|clear/.test(cmd)) return 'Setup';
  if (/display:waveview|ch\d|math\d|ref\d|bus/.test(cmd)) return 'Channel / Bus Configuration';
  if (/trig|trigger|acq|acquire|horizontal:recordlength|hor:record/.test(cmd)) return 'Trigger / Acquisition';
  if (/meas|measure/.test(cmd)) return 'Measurements';
  if (type === 'error_check') return 'Validation / Error Check';
  return 'Operation';
}

function groupFlatFlowSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const leadingConnect: Array<Record<string, unknown>> = [];
  const trailingDisconnect: Array<Record<string, unknown>> = [];
  const body: Array<Record<string, unknown>> = [];

  let i = 0;
  while (i < steps.length && String(steps[i].type || '').toLowerCase() === 'connect') {
    leadingConnect.push(steps[i]);
    i += 1;
  }
  let j = steps.length - 1;
  while (j >= i && String(steps[j].type || '').toLowerCase() === 'disconnect') {
    trailingDisconnect.unshift(steps[j]);
    j -= 1;
  }
  for (let k = i; k <= j; k += 1) body.push(steps[k]);

  const phaseOrder: string[] = [];
  const byPhase = new Map<string, Array<Record<string, unknown>>>();
  body.forEach((step) => {
    const phase = classifyPhase(step);
    if (!byPhase.has(phase)) {
      byPhase.set(phase, []);
      phaseOrder.push(phase);
    }
    byPhase.get(phase)!.push(step);
  });

  const grouped = phaseOrder.map((phase, idx) => ({
    id: `g_auto_${idx + 1}`,
    type: 'group',
    label: phase,
    params: {},
    collapsed: false,
    children: byPhase.get(phase) || [],
  }));

  return [...leadingConnect, ...grouped, ...trailingDisconnect];
}

function upsertSuggestedFix(actionsJson: Record<string, unknown>, message: string): void {
  const current = Array.isArray(actionsJson.suggestedFixes) ? (actionsJson.suggestedFixes as unknown[]) : [];
  const next = current.map((x) => String(x));
  if (!next.includes(message)) next.push(message);
  actionsJson.suggestedFixes = next;
}

function mkId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function splitCommandParts(raw: string): string[] {
  return String(raw || '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function enforceConcatCapInSteps(
  steps: Array<Record<string, unknown>>,
  cap = 4
): { steps: Array<Record<string, unknown>>; changed: boolean } {
  let changed = false;
  const out = steps.flatMap((step) => {
    const base = { ...step };
    if (Array.isArray(base.children)) {
      const nested = enforceConcatCapInSteps(base.children as Array<Record<string, unknown>>, cap);
      base.children = nested.steps;
      if (nested.changed) changed = true;
    }

    const type = String(base.type || '').toLowerCase();
    if (!['write', 'query', 'set_and_query'].includes(type)) return [base];
    const params = (base.params || {}) as Record<string, unknown>;
    const command = String(params.command || '');
    const parts = splitCommandParts(command);
    if (parts.length <= cap) return [base];

    changed = true;
    const baseLabel = String(base.label || 'Command').replace(/\s+\(\d+\/\d+\)$/i, '');
    const children = parts.map((cmd, idx) => ({
      ...base,
      id: idx === 0 && typeof base.id === 'string' ? base.id : mkId('cmd'),
      label: baseLabel,
      params: { ...params, command: cmd },
      children: undefined,
    }));
    return [{
      id: mkId('g_concat'),
      type: 'group',
      label: baseLabel,
      params: {},
      collapsed: false,
      children,
    }];
  });
  return { steps: out, changed };
}

function isMeasurementAddOrSource(step: Record<string, unknown>): boolean {
  const type = String(step.type || '').toLowerCase();
  if (!['write', 'set_and_query'].includes(type)) return false;
  const cmd = String(((step.params || {}) as Record<string, unknown>).command || '').toLowerCase();
  return /measurement:addmeas\b/.test(cmd) || /measurement:meas\d+:sour(?:ce)?\d*\b/.test(cmd);
}

function isMeasurementResultQuery(step: Record<string, unknown>): boolean {
  const type = String(step.type || '').toLowerCase();
  if (type !== 'query') return false;
  const cmd = String(((step.params || {}) as Record<string, unknown>).command || '').toLowerCase();
  return /measurement:meas\d+:.+\?/.test(cmd) && /(results|curr|mean|value|pk2pk|rms|max|min)/.test(cmd);
}

function enforceMeasurementGroupingInSteps(
  steps: Array<Record<string, unknown>>
): { steps: Array<Record<string, unknown>>; changed: boolean } {
  let changed = false;
  const normalized = steps.map((step) => {
    if (!Array.isArray(step.children)) return step;
    const nested = enforceMeasurementGroupingInSteps(step.children as Array<Record<string, unknown>>);
    if (nested.changed) changed = true;
    return { ...step, children: nested.steps };
  });

  const hasCanonicalGroups = normalized.some((s) => {
    const t = String(s.type || '').toLowerCase();
    const lbl = String(s.label || '').toLowerCase();
    return t === 'group' && (lbl.includes('add measurements') || lbl.includes('read results'));
  });
  if (hasCanonicalGroups) return { steps: normalized, changed };

  const addIdx: number[] = [];
  const readIdx: number[] = [];
  normalized.forEach((s, idx) => {
    if (String(s.type || '').toLowerCase() === 'group') return;
    if (isMeasurementAddOrSource(s)) addIdx.push(idx);
    else if (isMeasurementResultQuery(s)) readIdx.push(idx);
  });
  if (addIdx.length < 2 || readIdx.length < 1) return { steps: normalized, changed };

  const addSet = new Set(addIdx);
  const readSet = new Set(readIdx);
  const firstIdx = Math.min(...addIdx, ...readIdx);
  const out: Array<Record<string, unknown>> = [];
  const addChildren = addIdx.map((i) => normalized[i]);
  const readChildren = readIdx.map((i) => normalized[i]);

  normalized.forEach((s, idx) => {
    if (idx === firstIdx) {
      out.push({
        id: mkId('g_meas_add'),
        type: 'group',
        label: 'Add Measurements',
        params: {},
        collapsed: false,
        children: addChildren,
      });
      out.push({
        id: mkId('g_meas_read'),
        type: 'group',
        label: 'Read Results',
        params: {},
        collapsed: false,
        children: readChildren,
      });
    }
    if (addSet.has(idx) || readSet.has(idx)) return;
    out.push(s);
  });
  return { steps: out, changed: true };
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
        actions: Array.isArray(arr) ? arr : [],
      } as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // If marker exists but parsing failed, return minimal shell
  if (cleaned.match(/ACTIONS_JSON:/i)) {
    return { summary: '', findings: [], suggestedFixes: [], actions: [] };
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
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    originalSteps?: Array<Record<string, unknown>>;
    scpiContext?: Array<Record<string, unknown>>;
  }
): Promise<PostCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
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

  // Group-aware post-check: for long flat replace_flow payloads, auto-suggest a grouped rewrite.
  let regroupedAny = false;
  let concatSplitAny = false;
  let measurementGroupedAny = false;
  actionRows.forEach((action) => {
    const actionType = String(action.action_type || action.type || '');
    if (actionType !== 'replace_flow') return;
    const replaceFlowSteps = extractReplaceFlowSteps(action);
    if (!Array.isArray(replaceFlowSteps)) return;
    let nextSteps = replaceFlowSteps;

    if (isLongFlatFlow(nextSteps)) {
      const grouped = groupFlatFlowSteps(nextSteps);
      if (JSON.stringify(grouped) !== JSON.stringify(nextSteps)) {
        nextSteps = grouped;
        regroupedAny = true;
      }
    }

    const concatFixed = enforceConcatCapInSteps(nextSteps, 4);
    if (concatFixed.changed) {
      nextSteps = concatFixed.steps;
      concatSplitAny = true;
    }

    const measFixed = enforceMeasurementGroupingInSteps(nextSteps);
    if (measFixed.changed) {
      nextSteps = measFixed.steps;
      measurementGroupedAny = true;
    }

    if (action.flow && typeof action.flow === 'object') {
      const flow = action.flow as Record<string, unknown>;
      flow.steps = nextSteps;
      action.flow = flow;
    } else if (Array.isArray(action.steps)) {
      action.steps = nextSteps as unknown as Record<string, unknown>;
    } else {
      const payload = (action.payload && typeof action.payload === 'object')
        ? (action.payload as Record<string, unknown>)
        : {};
      payload.steps = nextSteps;
      action.payload = payload;
    }
  });
  if (regroupedAny) {
    warnings.push('Detected long flat flow; suggested grouped rewrite for readability.');
    upsertSuggestedFix(
      actionsJson,
      'Flow was long and flat. Suggested grouping by phase (setup/config/trigger/measure/save/cleanup) for readability.'
    );
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }
  if (concatSplitAny) {
    warnings.push('Detected over-concatenated SCPI command strings; split into grouped steps (max 4 per step).');
    upsertSuggestedFix(
      actionsJson,
      'Long semicolon command chains were split and grouped for readability (max 4 commands per step).'
    );
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }
  if (measurementGroupedAny) {
    warnings.push('Detected measurement setup/result scatter; grouped into Add Measurements and Read Results.');
    upsertSuggestedFix(
      actionsJson,
      'Measurement steps were regrouped into Add Measurements and Read Results.'
    );
    finalText = rebuildTextWithActionsJson(finalText, actionsJson);
  }

  const commands = collectCommandsFromActions(actionsJson);
  if (commands.length) {
    const isAlwaysValid = (cmd: string) => {
      const lower = cmd.toLowerCase();
      return ALWAYS_VALID_PREFIXES.some((p) => lower.startsWith(p)) || lower.startsWith('*');
    };

    const clientHeaders = new Set(
      (flowContext?.scpiContext || [])
        .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).header : null))
        .filter((h): h is string => !!h)
        .map((h) => normalizeCommandHeader(h))
    );

    const toVerify = commands.filter((cmd) => {
      const norm = normalizeCommandHeader(cmd);
      if (clientHeaders.has(norm)) return false;
      return !isAlwaysValid(cmd);
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
          warnings.push(`Unverified command: ${String(f.command || '')}`);
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
      (errors.length ? ` | errors: ${errors.join(', ')}` : '') +
      (warnings.length ? ` | warnings: ${warnings.join(', ')}` : ' | clean')
  );
  return { ok: errors.length === 0, text: finalText, errors, warnings };
}
