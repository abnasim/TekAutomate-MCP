import { loadPromptFile } from './promptLoader';
import type { McpChatRequest } from './schemas';
import { postCheckResponse } from './postCheck';
import { buildContext } from './contextBuilder';
import { getToolDefinitions, runTool } from '../tools';
import { getCommandIndex } from './commandIndex';

interface ToolLoopResult {
  text: string;
  errors: string[];
  warnings?: string[];
  metrics?: {
    totalMs: number;
    usedShortcut: boolean;
    provider?: 'openai' | 'anthropic';
    iterations?: number;
    toolCalls?: number;
    toolMs?: number;
    modelMs?: number;
    promptChars?: {
      system: number;
      user: number;
    };
  };
  debug?: {
    promptFileText?: string;
    systemPrompt?: string;
    developerPrompt?: string;
    userPrompt?: string;
    toolDefinitions?: Array<{ name: string; description: string }>;
    toolTrace?: Array<{
      name: string;
      args: Record<string, unknown>;
      startedAt: string;
      durationMs?: number;
      resultSummary?: {
        ok?: boolean;
        count?: number;
        warnings?: string[];
      };
      rawResult?: unknown;
    }>;
    rawOutput?: unknown;
    shortcutResponse?: string;
  };
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const STANDARD_MEASUREMENT_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'FREQUENCY', pattern: /\bfrequency\b|\bfreq\b/i },
  { type: 'AMPLITUDE', pattern: /\bamplitude\b|\bamp\b/i },
  { type: 'POVERSHOOT', pattern: /\bpositive overshoot\b|\bpos(?:itive)?\s*overshoot\b|\bpovershoot\b/i },
  { type: 'NOVERSHOOT', pattern: /\bnegative overshoot\b|\bneg(?:ative)?\s*overshoot\b|\bnovershoot\b/i },
  { type: 'RISETIME', pattern: /\brise\s*time\b|\brisetime\b/i },
  { type: 'FALLTIME', pattern: /\bfall\s*time\b|\bfalltime\b/i },
  { type: 'PERIOD', pattern: /\bperiod\b/i },
  { type: 'PK2PK', pattern: /\bpk2pk\b|\bpeak[-\s]*to[-\s]*peak\b|\bpeak to peak\b/i },
  { type: 'MEAN', pattern: /\bmean\b|\baverage\b/i },
  { type: 'RMS', pattern: /\brms\b/i },
  { type: 'HIGH', pattern: /\bhigh\b/i },
  { type: 'LOW', pattern: /\blow\b/i },
  { type: 'MAXIMUM', pattern: /\bmaximum\b|\bmax\b/i },
  { type: 'MINIMUM', pattern: /\bminimum\b|\bmin\b/i },
];

const DEFAULT_MEASUREMENT_SET = [
  'FREQUENCY',
  'AMPLITUDE',
  'PK2PK',
  'MEAN',
  'RMS',
  'POVERSHOOT',
];

function detectMeasurementRequest(req: McpChatRequest): string[] {
  const text = req.userMessage.toLowerCase();
  const found = STANDARD_MEASUREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ type }) => type);

  if (found.length > 0) {
    return Array.from(new Set(found));
  }

  if (!/\bmeas(?:urement)?s?\b/i.test(text)) {
    return [];
  }

  const countMatch =
    text.match(/\b([4-6])\s+meas(?:urement)?s?\b/i) ||
    text.match(/\b(four|five|six)\s+meas(?:urement)?s?\b/i);
  if (!countMatch) {
    return [];
  }

  const countToken = countMatch[1].toLowerCase();
  const requestedCount =
    countToken === 'four'
      ? 4
      : countToken === 'five'
        ? 5
        : countToken === 'six'
          ? 6
          : Number(countToken);

  return DEFAULT_MEASUREMENT_SET.slice(0, Math.max(1, requestedCount));
}

function detectMeasurementChannel(req: McpChatRequest): string | null {
  const text = req.userMessage.toUpperCase();
  const match = text.match(/\bCH([1-8])\b/) || text.match(/\bCHANNEL\s*([1-8])\b/);
  return match ? `CH${match[1]}` : null;
}

function shouldQueryMeasurementResults(req: McpChatRequest): boolean {
  return /\b(query|read|result|results|save result|save results|mean\?|value|values)\b/i.test(
    req.userMessage
  );
}

function isMeasurementAppendRequest(req: McpChatRequest): boolean {
  return /\b(append|add|keep|preserve|existing|overwrite|overwritten)\b/i.test(req.userMessage);
}

function flattenSteps(steps: unknown[]): Array<Record<string, unknown>> {
  const flat: Array<Record<string, unknown>> = [];
  const walk = (items: unknown[]) => {
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const step = item as Record<string, unknown>;
      flat.push(step);
      if (Array.isArray(step.children)) {
        walk(step.children);
      }
    });
  };
  walk(steps);
  return flat;
}

function splitCommandSegments(command: string): string[] {
  return String(command || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isNumericLike(value: string): boolean {
  return /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim());
}

async function detectFlowCommandIssues(req: McpChatRequest): Promise<string[]> {
  const out: string[] = [];
  const steps = flattenSteps(Array.isArray(req.flowContext.steps) ? req.flowContext.steps : []);
  if (!steps.length) return out;
  const index = await getCommandIndex();

  for (const step of steps) {
    const type = String(step.type || '').toLowerCase();
    if (!['write', 'query', 'set_and_query'].includes(type)) continue;
    const params = (step.params || {}) as Record<string, unknown>;
    const rawCommand = String(params.command || '').trim();
    if (!rawCommand) continue;
    if (type === 'query' && !rawCommand.includes('?')) {
      out.push(`[${String(step.id || '?')}] query step command should usually end with '?': ${rawCommand}`);
    }

    const segments = splitCommandSegments(rawCommand);
    for (const segment of segments) {
      const [headerRaw, ...argParts] = segment.split(/\s+/);
      const header = String(headerRaw || '').trim();
      const args = argParts.join(' ').trim();
      const entry =
        index.getByHeader(header, req.flowContext.modelFamily) ||
        index.getByHeader(header.toUpperCase(), req.flowContext.modelFamily) ||
        index.getByHeaderPrefix(header, req.flowContext.modelFamily);
      if (!entry) {
        out.push(`[${String(step.id || '?')}] command header not verified: ${header}`);
        continue;
      }
      const requiredArgs = (entry.arguments || []).filter((a) => a.required);
      const firstArg = args.split(',').map((x) => x.trim()).filter(Boolean)[0] || '';
      if (requiredArgs.length > 0 && !firstArg && type !== 'query') {
        const hasSetAndQueryValue =
          type === 'set_and_query' &&
          ((params.paramValues && typeof params.paramValues === 'object' && (
            Object.prototype.hasOwnProperty.call(params.paramValues as Record<string, unknown>, 'value') ||
            Object.prototype.hasOwnProperty.call(params.paramValues as Record<string, unknown>, 'Value')
          )) || false);
        if (!hasSetAndQueryValue) {
          out.push(`[${String(step.id || '?')}] missing required argument for ${header}`);
        }
      }
      const numericArg = requiredArgs.find((a) => /number|numeric|float|nr\d*/i.test(String(a.type || '')));
      if (numericArg && firstArg) {
        const looksToken = /^[A-Za-z_]/.test(firstArg) && !/^(MIN|MAX|DEF|AUTO|ON|OFF)$/i.test(firstArg);
        if (!isNumericLike(firstArg) && looksToken) {
          out.push(
            `[${String(step.id || '?')}] possible invalid numeric value "${firstArg}" for ${header} (${numericArg.name})`
          );
        }
      }
    }
  }
  return out.slice(0, 20);
}

function isFastFrameRequest(req: McpChatRequest): boolean {
  return /\bfast\s*frame\b|\bfastframe\b/i.test(req.userMessage);
}

function detectFastFrameCount(req: McpChatRequest): number {
  const match =
    req.userMessage.match(/\b(\d+)\s+fast\s*frames?\b/i) ||
    req.userMessage.match(/\b(\d+)\s+fastframes?\b/i) ||
    req.userMessage.match(/\b(\d+)\s+frames?\b/i) ||
    req.userMessage.match(/\bcount\s+(\d+)\b/i);
  return match ? Math.max(1, Number(match[1])) : 10;
}

function isValidationRequest(req: McpChatRequest): boolean {
  return /\b(validate|validation|review|check flow|does this look right|does this look good|looks good|briefly)\b/i.test(
    req.userMessage
  );
}

function isFlowValidationRequest(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  if (!isValidationRequest(req)) return false;
  // If the user explicitly asks for log/runtime review, this is not flow-only validation.
  if (/\b(check logs|run logs?|audit|runtime|executor|stderr|stdout|exit code)\b/.test(msg)) {
    return false;
  }
  return true;
}

function isLogReviewRequest(req: McpChatRequest): boolean {
  return /\b(check logs|run logs?|audit|runtime|executor)\b/i.test(req.userMessage);
}

function runLooksSuccessful(runContext: McpChatRequest['runContext']): boolean {
  const audit = String(runContext.auditOutput || '');
  const log = String(runContext.logTail || '');
  if (/\bAudit:\s*pass\b/i.test(audit) || /\bexecutionPassed["']?\s*:\s*true\b/i.test(audit)) return true;
  if (/\[OK\]\s+Complete/i.test(log) || /\bConnected:\b/i.test(log) && /\bScreenshot saved\b/i.test(log)) return true;
  return false;
}

function buildPyvisaMeasurementShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null; // handled by other shortcut
  const deviceType = (req.flowContext.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return null;

  const measurements = detectMeasurementRequest(req);
  const channel = detectMeasurementChannel(req);
  if (!measurements.length || !channel) return null;

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const flatSteps = flattenSteps(existingSteps);
  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const wantsQueries = shouldQueryMeasurementResults(req);
  const isBuildNew = existingSteps.length === 0;

  // ADDMEAS appends to the scope's existing measurement table. Only emit
  // result queries when the user explicitly asked for values; otherwise avoid
  // guessing slot numbers against pre-existing scope measurements.
  const measurementSlots = measurements.map((measurement, index) => {
    const slot = index + 1;
    const saveAsName = (
      measurement === 'FREQUENCY' ? 'ch1_frequency'
      : measurement === 'AMPLITUDE' ? 'ch1_amplitude'
      : measurement === 'POVERSHOOT' ? 'ch1_positive_overshoot'
      : measurement === 'NOVERSHOOT' ? 'ch1_negative_overshoot'
      : `meas${slot}_result`
    ).replace('ch1', channel.toLowerCase().replace(' ', ''));
    return { measurement, slot, saveAsName };
  });

  const addGroup: Record<string, unknown>[] = measurementSlots.flatMap(({ measurement, slot, saveAsName: _ }) => [
    {
      id: `${slot * 2}`,
      type: 'write',
      label: `Add ${measurement.toLowerCase()} measurement`,
      params: { command: `MEASUrement:ADDMEAS ${measurement}` },
    },
    {
      id: `${slot * 2 + 1}`,
      type: 'write',
      label: `Set measurement ${slot} source to ${channel}`,
      params: { command: `MEASUrement:MEAS${slot}:SOUrce1 ${channel}` },
    },
  ]);

  const queryGroup: Record<string, unknown>[] = wantsQueries
    ? measurementSlots.map(({ measurement, slot, saveAsName }) => ({
        id: `q${slot}`,
        type: 'query',
        label: `Query ${measurement.toLowerCase()} result`,
        params: {
          command: `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN?`,
          saveAs: saveAsName,
        },
      }))
    : [];

  const screenshotStep = hasScreenshot ? [{
    id: 'ss1',
    type: 'save_screenshot',
    label: 'Save Screenshot',
    params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' },
  }] : [];

  if (isBuildNew) {
    const flow = {
      name: `CH${channel.replace('CH', '')} Measurements`,
      description: `Add ${measurements.join(', ')} measurements on ${channel}`,
      backend: backend || 'pyvisa',
      deviceType: req.flowContext.deviceType || 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
        {
          id: 'g1', type: 'group', label: `Add ${channel} measurements`, params: {}, collapsed: false,
          children: addGroup,
        },
        ...(queryGroup.length
          ? [{
              id: 'g2', type: 'group', label: 'Read measurement results', params: {}, collapsed: false,
              children: queryGroup,
            }]
          : []),
        ...screenshotStep,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    const summaryParts = [`Added ${measurements.join(', ')} measurements on ${channel}.`];
    if (!wantsQueries) {
      summaryParts.push('Used ADDMEAS so the scope appends new measurements without replacing existing ones.');
    }
    if (hasScreenshot) summaryParts.push('Screenshot step included.');
    const actions = [{ type: 'replace_flow', flow }];
    return `ACTIONS_JSON: ${JSON.stringify({ summary: summaryParts.join(' '), findings: [], suggestedFixes: [], actions })}`;
  }

  // Existing flow — insert steps just after connect or the selected step.
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (flatSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;
  let previousId = insertAfterId;
  const allNewSteps = [...addGroup, ...queryGroup, ...screenshotStep];
  const insertActions = allNewSteps.map((step) => {
    const action = {
      type: 'insert_step_after',
      targetStepId: previousId,
      newStep: step,
    };
    previousId = String(step.id || previousId || '');
    return action;
  });
  const findings = [];
  if (!wantsQueries && isMeasurementAppendRequest(req)) {
    findings.push('Used ADDMEAS-only steps so new CH1 measurements append on the scope and do not rely on existing measurement slot numbers.');
  }
  return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added ${measurements.join(', ')} measurement steps on ${channel}.`, findings, suggestedFixes: [], actions: insertActions })}`;
}

function buildPyvisaFastFrameShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null;
  if (!isFastFrameRequest(req)) return null;

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const flatSteps = flattenSteps(existingSteps);
  const count = detectFastFrameCount(req);
  const connectStep = flatSteps.find((step) => String(step.type || '') === 'connect') as Record<string, unknown> | undefined;
  const screenshotStep = flatSteps.find((step) => String(step.type || '') === 'save_screenshot') as Record<string, unknown> | undefined;
  const insertAfterId = (connectStep?.id as string | undefined) || (req.flowContext.selectedStepId ? String(req.flowContext.selectedStepId) : null);
  const fastFrameSteps = [
    {
      id: 'ff1',
      type: 'write',
      label: 'Enable FastFrame',
      params: { command: 'HORizontal:FASTframe:STATE ON' },
    },
    {
      id: 'ff2',
      type: 'write',
      label: `Set FastFrame Count to ${count}`,
      params: { command: `HORizontal:FASTframe:COUNt ${count}` },
    },
  ];

  if (!existingSteps.length) {
    const flow = {
      name: 'FastFrame Workflow',
      description: `Enable FastFrame with frame count ${count}`,
      backend: backend || 'pyvisa',
      deviceType: req.flowContext.deviceType || 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
        ...fastFrameSteps,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count}.`, findings: [], suggestedFixes: [], actions: [{ type: 'replace_flow', flow }] })}`;
  }

  const actions: Record<string, unknown>[] = [];
  if (insertAfterId) {
    // Insert in reverse order at the same anchor so final order is ff1 then ff2.
    // This avoids depending on generated IDs from newly inserted steps.
    actions.push(
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: fastFrameSteps[1] },
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: fastFrameSteps[0] }
    );
  } else {
    actions.push(...fastFrameSteps.map((step) => ({ type: 'insert_step_after', targetStepId: null, newStep: step })));
  }

  if (screenshotStep) {
    return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count} before the screenshot.`, findings: [], suggestedFixes: [], actions })}`;
  }
  return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count}.`, findings: [], suggestedFixes: [], actions })}`;
}

function buildTmDevicesMeasurementShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  if ((req.flowContext.backend || '').toLowerCase() !== 'tm_devices') return null;
  if ((req.flowContext.deviceType || '').toUpperCase() !== 'SCOPE') return null;

  const measurements = detectMeasurementRequest(req);
  const channel = detectMeasurementChannel(req);
  if (!measurements.length || !channel) return null;

  const model = req.flowContext.modelFamily || 'MSO6B';
  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (existingSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;

  const measurementSteps = measurements.flatMap((measurement, index) => {
    const slot = index + 1;
    const baseId = `m${slot}`;
    const sourceField = 'source1';
    const resultVar =
      measurement === 'FREQUENCY'
        ? 'frequency_ch1'
        : measurement === 'AMPLITUDE'
          ? 'amplitude_ch1'
          : 'positive_overshoot_ch1';
    return [
      {
        id: `${baseId}a`,
        type: 'tm_device_command',
        label: `Add ${measurement} measurement`,
        params: {
          code: `scope.commands.measurement.addmeas.write("${measurement}")`,
          model,
          description: `Add ${measurement} measurement`,
        },
      },
      {
        id: `${baseId}b`,
        type: 'tm_device_command',
        label: `Set ${measurement} source to ${channel}`,
        params: {
          code: `scope.commands.measurement.meas[${slot}].${sourceField}.write("${channel}")`,
          model,
          description: `Set ${measurement} source to ${channel}`,
        },
      },
      {
        id: `${baseId}c`,
        type: 'tm_device_command',
        label: `Read ${measurement} value`,
        params: {
          code: `${resultVar} = scope.commands.measurement.meas[${slot}].results.currentacq.mean.query()`,
          model,
          description: `Read ${measurement} value`,
        },
      },
    ];
  });

  const extraSteps = hasScreenshot
    ? [
        {
          id: 'ss1',
          type: 'comment',
          label: 'Screenshot requested',
          params: {
            text: 'tm_devices backend does not support save_screenshot step directly; add a Python or platform-specific capture step if needed.',
          },
        },
      ]
    : [];

  const actions =
    existingSteps.length && insertAfterId
      ? [...measurementSteps, ...extraSteps].map((step) => ({
          type: 'insert_step_after',
          targetStepId: insertAfterId,
          newStep: step,
        }))
      : [
          {
            type: 'replace_flow',
            flow: {
              name: 'Measurement Flow',
              description: `Add ${measurements.join(', ')} measurements on ${channel}`,
              backend: 'tm_devices',
              deviceType: req.flowContext.deviceType || 'SCOPE',
              steps: [
                { id: '1', type: 'connect', label: 'Connect to Scope', params: { printIdn: true } },
                ...measurementSteps,
                ...extraSteps,
                { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
              ],
            },
          },
        ];

  const findings =
    hasScreenshot
      ? ['Added measurement steps. Screenshot on tm_devices backend may require a Python or backend-specific capture step.']
      : [];

  return `ACTIONS_JSON: {"summary":"Added ${escapeJsonString(measurements.join(', '))} measurements on ${escapeJsonString(channel)}.","findings":[${findings.map((f) => `"${escapeJsonString(f)}"`).join(',')}],"suggestedFixes":[],"actions":${JSON.stringify(actions)}}`;
}

function clipString(value: unknown, max = 280): unknown {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function slimScpiEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const directExample =
    entry.example && typeof entry.example === 'object'
      ? (entry.example as Record<string, unknown>)
      : null;
  const examples = Array.isArray(entry.codeExamples)
    ? (entry.codeExamples as Array<Record<string, unknown>>)
    : [];
  const firstExample = examples[0] && typeof examples[0] === 'object'
    ? (examples[0] as Record<string, unknown>)
    : null;
  const resolvedExample = directExample || firstExample;
  const argumentsList = Array.isArray(entry.arguments)
    ? (entry.arguments as unknown[])
        .filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === 'object')
        .slice(0, 3)
        .map((arg) => ({
          name: arg.name,
          type: arg.type,
          description: clipString(arg.description || arg.shortDescription || arg.text, 180),
          required: arg.required,
        }))
    : [];
  const relatedCommands = Array.isArray(entry.relatedCommands)
    ? (entry.relatedCommands as unknown[])
        .filter((cmd): cmd is string => typeof cmd === 'string')
        .slice(0, 5)
    : [];
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: clipString(entry.shortDescription, 200),
    syntax: entry.syntax,
    codeExamples: resolvedExample
      ? {
          scpi: (resolvedExample.scpi as Record<string, unknown> | undefined)?.code || resolvedExample.scpi,
          python: (resolvedExample.python as Record<string, unknown> | undefined)?.code || resolvedExample.python,
          tm_devices:
            (resolvedExample.tm_devices as Record<string, unknown> | undefined)?.code ||
            resolvedExample.tm_devices,
        }
      : undefined,
    notes: Array.isArray(entry.notes) ? (entry.notes as unknown[]).slice(0, 2).map((n) => clipString(n, 180)) : [],
    arguments: argumentsList,
    validValues: entry.validValues,
    relatedCommands,
  };
}

function logToolCall(name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[MCP] tool call: ${name} ${JSON.stringify(args)}`);
}

function logToolResult(name: string, result: unknown) {
  const payload = (result || {}) as Record<string, unknown>;
  const ok = payload.ok === true;
  const dataRaw = payload.data;
  const data = Array.isArray(dataRaw)
    ? dataRaw
    : dataRaw && typeof dataRaw === 'object'
      ? [dataRaw]
      : [];
  const verifiedCount = data.filter((d) => {
    if (!d || typeof d !== 'object') return false;
    return (d as Record<string, unknown>).verified === true;
  }).length;
  // eslint-disable-next-line no-console
  if (name === 'verify_scpi_commands') {
    console.log(`[MCP] tool result: ${name} ok=${ok} count=${data.length} verified=${verifiedCount}`);
  } else {
    console.log(`[MCP] tool result: ${name} ok=${ok} count=${data.length}`);
  }
}

function buildSystemPrompt(modePrompt: string, outputMode: 'steps_json' | 'blockly_xml'): string {
  const modeLabel = outputMode === 'blockly_xml' ? 'Blockly XML' : 'Steps UI JSON';
  return [
    '# TekAutomate MCP Runtime',
    'You are the live TekAutomate assistant inside the app. Build, edit, validate, and explain the current workspace.',
    '',
    '## Runtime Contract',
    `- Current target mode: ${modeLabel}. Respect that mode exactly.`,
    '- The live workspace context is authoritative: backend, device map, editor mode, current steps, selected step, logs, and audit output outrank generic preferences.',
    '- Build directly when the request is clear. Do not stall in confirmation loops for normal edits.',
    '- Use MCP tools only when you need exact command syntax, tm_devices API paths, block schema details, runtime state, or known-failure context.',
    '- Prefer one focused tool call over serial tool chains. Zero tool calls is fine when the workspace and prompt already give enough context.',
    '- If the user asks to add, insert, update, fix, move, remove, replace, convert, apply, or "do it", return actionable changes in this response, not promises.',
    '- Never claim a change is already applied. You are proposing actions for the app to apply.',
    '- Never output Python unless the user explicitly asks for Python.',
    '- Prefer separate write/query steps over semicolon-chained multi-command strings unless the user explicitly asks for a single combined command.',
    '- Prefer grouped flow structure for readability: for multi-phase flows, organize steps into phase groups (setup/config/trigger/measure/save/cleanup) unless the user asks for flat steps.',
    '',
    '## MCP Tools',
    '- search_scpi / get_command_by_header: use when exact SCPI syntax is genuinely uncertain.',
    '- search_tm_devices: use only for tm_devices backend or explicit SCPI <-> tm_devices conversion.',
    '- retrieve_rag_chunks: use for TekAutomate app logic, backend behavior, templates, Blockly behavior, and known patterns.',
    '- list_valid_step_types / get_block_schema: use when you are unsure which step or block shape TekAutomate supports.',
    '- validate_action_payload: optional final sanity check for complex grouped edits; not required for every simple edit.',
    '- get_instrument_state / probe_command: use only when live executor context is available and runtime probing is necessary.',
    '',
    '## Validation Priority',
    '- User-visible truth comes first. If a flow already runs or logs prove success, do not invent blocker-level schema complaints.',
    '- A blocker must prevent apply, generation, or execution. Style cleanup, inferred defaults, and backend normalization are warnings at most.',
    '',
    '## Mode Builder Contract',
    modePrompt,
  ].join('\n');
}

function buildUserPrompt(req: McpChatRequest, flowCommandIssues: string[] = []): string {
  const fc = req.flowContext;
  const rc = req.runContext;
  const validateMode = isValidationRequest(req);
  const flowValidateMode = isFlowValidationRequest(req);
  const logReviewMode = isLogReviewRequest(req);
  const executionSucceeded = runLooksSuccessful(rc);
  const flatSteps = flattenSteps(Array.isArray(fc.steps) ? fc.steps : []);
  const stepsSummary = flatSteps.length
    ? flatSteps
        .slice(0, 18)
        .map((s) =>
          `  [${s.id}] ${s.type}${s.label ? ` "${s.label}"` : ''}${typeof (s.params as Record<string, unknown> | undefined)?.command === 'string' ? ` -> ${String((s.params as Record<string, unknown>).command)}` : ''}`
        )
        .join('\n')
    : '  (empty flow)';
  const compactStepsJson = JSON.stringify(fc.steps || []);
  const stepsJsonPreview = (logReviewMode || flowValidateMode)
    ? compactStepsJson
    : compactStepsJson.length > 1600
      ? `${compactStepsJson.slice(0, 1600)}...[truncated ${compactStepsJson.length - 1600} chars]`
      : compactStepsJson;

  const instrumentLine = `  - scope1: ${fc.deviceType || 'SCOPE'}, ${fc.backend || 'pyvisa'} @ ${fc.host || 'localhost'}`;
  const instrumentMapLines = Array.isArray(fc.instrumentMap) && fc.instrumentMap.length
    ? fc.instrumentMap
        .map((device) =>
          `  - ${String(device.alias || 'device')}: ${String(device.deviceType || 'SCOPE')}, ${String(device.backend || 'pyvisa')}${device.deviceDriver ? `, driver ${String(device.deviceDriver)}` : ''}${device.visaBackend ? `, visa ${String(device.visaBackend)}` : ''}${device.host ? ` @ ${String(device.host)}` : ''}`
        )
        .join('\n')
    : instrumentLine;
  const parts = [
    'Live workspace context:',
    `- editor: ${fc.executionSource === 'blockly' ? 'Blockly' : 'Steps'}`,
    `- backend: ${fc.backend || 'pyvisa'}`,
    `- modelFamily: ${fc.modelFamily || '(unknown)'}`,
    `- connection: ${fc.connectionType || 'tcpip'}`,
    `- deviceType: ${fc.deviceType || 'SCOPE'}`,
    `- deviceDriver: ${fc.deviceDriver || '(unknown)'}`,
    `- visaBackend: ${fc.visaBackend || '(unknown)'}`,
    `- alias: ${fc.alias || 'scope1'}`,
    '- instruments:',
    instrumentMapLines,
    '',
    `Current flow (${flatSteps.length} flattened steps):`,
    `${stepsSummary}${flatSteps.length > 18 ? '\n  ...more steps omitted' : ''}`,
    '',
    'Current steps JSON preview:',
    stepsJsonPreview || '[]',
    '',
    'User request:',
    req.userMessage,
  ];

  if (fc.selectedStep) {
    parts.push(`## Selected Step (user is focused on this)\n${JSON.stringify(fc.selectedStep, null, 2)}`);
  } else if (fc.selectedStepId) {
    parts.push(`## Selected Step ID\n${fc.selectedStepId}`);
  }

  if (fc.validationErrors && (fc.validationErrors as string[]).length > 0) {
    parts.push(`Current flow validation errors:\n${(fc.validationErrors as string[]).map((e: string) => `- ${e}`).join('\n')}`);
  }

  if (rc.runStatus !== 'idle' && !flowValidateMode) {
    parts.push(`Run status: ${rc.runStatus}${rc.exitCode !== null ? ` (exit ${rc.exitCode})` : ''}`);
    if (rc.logTail) {
      const tail = logReviewMode
        ? rc.logTail
        : rc.logTail.length > 800
          ? `...${rc.logTail.slice(-800)}`
          : rc.logTail;
      parts.push(`Run log${logReviewMode ? ' (full)' : ' tail'}:\n${tail}`);
    }
    if (rc.auditOutput) {
      const audit = logReviewMode
        ? rc.auditOutput
        : rc.auditOutput.length > 600
          ? `...${rc.auditOutput.slice(-600)}`
          : rc.auditOutput;
      parts.push(`Audit output${logReviewMode ? ' (full)' : ''}:\n${audit}`);
    }
  }

  if (flowValidateMode) {
    parts.push(
      'Validation scope: FLOW/STEP STRUCTURE ONLY. Ignore runtime logs, audit output, executor/network/environment failures, and host machine issues.'
    );
    if (flowCommandIssues.length) {
      parts.push(`Precomputed flow command findings:\n${flowCommandIssues.map((x) => `- ${x}`).join('\n')}`);
    }
  }

  if (validateMode && executionSucceeded) {
    parts.push('Execution evidence indicates this flow already worked.');
  }

  if (req.instrumentEndpoint) {
    parts.push(`Live instrument:\n- executor: ${req.instrumentEndpoint.executorUrl}\n- visa: ${req.instrumentEndpoint.visaResource}`);
  }

  if (logReviewMode && !executionSucceeded) {
    parts.push(
      'Response style requirement: provide a detailed diagnostic explanation (around 200-400 words) grounded only in the supplied logs/audit. If no safe flow edit is possible, still return ACTIONS_JSON with actions: [] and keep the narrative detailed.'
    );
  }

  return parts.join('\n\n');
}

async function runOpenAiResponses(
  req: McpChatRequest,
  flowCommandIssues: string[] = []
): Promise<{
  text: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const instructions = loadPromptFile(req.outputMode);
  const developerPrompt = await buildContext(req);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
  const toolDefinitions: Array<{ name: string; description: string }> = [];
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];

  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const modelStartedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${openAiBase}/v1/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model || 'gpt-4o',
        instructions,
        max_output_tokens: 4096,
        input: [
          {
            role: 'developer',
            content: developerPrompt,
          },
          {
            role: 'user',
            content: req.userMessage,
          },
        ],
        stream: false,
        tools: undefined,
        store: false,
      }),
    });
  } catch (err) {
    console.log('[MCP] responses.create error:', JSON.stringify(err));
    throw err;
  }
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  console.log('[MCP] raw output:', JSON.stringify(json.output || json));
  let content = '';
  if (typeof json.output_text === 'string' && json.output_text.trim().length > 0) {
    content = json.output_text;
  } else if (Array.isArray(json.output)) {
    content = (json.output as Array<Record<string, unknown>>)
      .map((item) => {
        if (item.type === 'message' && Array.isArray(item.content)) {
          return (item.content as Array<Record<string, unknown>>)
            .map((c) => (typeof c.text === 'string' ? c.text : ''))
            .join('');
        }
        if (typeof item.text === 'string') return item.text;
        return '';
      })
      .join('');
  }
  const modelMs = Date.now() - modelStartedAt;

  return {
    text: content,
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs,
      promptChars: {
        system: instructions.length,
        user: userPrompt.length,
      },
    },
    debug: {
      systemPrompt: instructions,
      developerPrompt,
      userPrompt,
      rawOutput: json,
      toolDefinitions,
      toolTrace,
    },
  };
}

function shouldUseTools(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  return (
    msg.includes('verify') ||
    msg.includes('search scpi') ||
    msg.includes('look up') ||
    msg.includes('lookup') ||
    msg.includes('check docs') ||
    msg.includes('exact syntax')
  );
}

function isModelFirstPriority(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  return (
    msg.includes('build a complete tekautomate flow') ||
    msg.includes('command lookup request') ||
    /\b(command|syntax|params?|examples?|what is|how do i|lookup|look up)\b/.test(msg) ||
    msg.includes('validate tm_devices command usage') ||
    msg.includes('sync / wait review') ||
    msg.includes('find missing synchronization') ||
    msg.includes('return actions_json')
  );
}

function shouldAttemptShortcutFirst(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  if (isModelFirstPriority(req)) return false;
  const lookupIntent = /\b(command|syntax|params?|examples?|what is|how do i|lookup|look up)\b/.test(msg);
  const editIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply)\b/.test(msg);
  // Keep deterministic shortcuts for concise direct asks only.
  return (
    msg.length <= 180 &&
    editIntent &&
    !lookupIntent &&
    (
      /\bfast\s*frame\b|\bfastframes?\b/.test(msg) ||
      /\bmeas(?:urement)?s?\b/.test(msg)
    )
  );
}

function hasActionsJsonPayload(text: string): boolean {
  return /ACTIONS_JSON\s*:\s*\{[\s\S]*"actions"\s*:/i.test(text);
}

async function runOpenAiToolLoop(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  _maxCalls = 8
): Promise<{
  text: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const modePrompt = loadPromptFile(req.outputMode);
  const systemPrompt = buildSystemPrompt(modePrompt, req.outputMode);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
  const toolDefinitions: Array<{ name: string; description: string }> = [];
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];

  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const res = await fetch(`${openAiBase}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model || 'gpt-4o-mini',
      instructions: systemPrompt,
      input: [{ role: 'user', content: userPrompt }],
      stream: false,
      tools: undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const output = (json.output_text as unknown[]) || [];
  const content = output.length ? String(output.join('')) : '';

  return {
    text: content,
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: {
        system: systemPrompt.length,
        user: userPrompt.length,
      },
    },
    debug: {
      promptFileText: modePrompt,
      systemPrompt,
      userPrompt,
      toolDefinitions,
      toolTrace,
    },
  };
}

async function runAnthropicToolLoop(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  maxCalls = 6
): Promise<{
  text: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const modePrompt = loadPromptFile(req.outputMode);
  const systemPrompt = buildSystemPrompt(modePrompt, req.outputMode);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      system: systemPrompt,
      max_tokens: 2000,
      messages: [
        ...(req.history || [])
          .slice(-6)
          .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content.slice(0, 800) })),
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const text = Array.isArray(json.content)
    ? (json.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === 'text')
        .map((c) => String(c.text || ''))
        .join('\\n')
    : '';
  return {
    text,
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'anthropic',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: {
        system: systemPrompt.length,
        user: userPrompt.length,
      },
    },
    debug: {
      promptFileText: modePrompt,
      systemPrompt,
      userPrompt,
      toolDefinitions: [],
      toolTrace,
    },
  };
}

export async function runToolLoop(req: McpChatRequest): Promise<ToolLoopResult> {
  const startedAt = Date.now();
  const flowCommandIssues = isFlowValidationRequest(req)
    ? await detectFlowCommandIssues(req)
    : [];
  const shortcut = buildPyvisaMeasurementShortcut(req) || buildTmDevicesMeasurementShortcut(req) || buildPyvisaFastFrameShortcut(req);
  if (shortcut && shouldAttemptShortcutFirst(req)) {
    const checked = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
    });
    return {
      text: checked.text,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
      debug: {
        shortcutResponse: shortcut,
        toolTrace: [],
      },
    };
  }

  const loopResult = shouldUseTools(req)
    ? await runOpenAiToolLoop(req, flowCommandIssues, 3)
    : await runOpenAiResponses(req, flowCommandIssues);
  const checkedPass1 = await postCheckResponse(loopResult.text, {
    backend: req.flowContext.backend,
    modelFamily: req.flowContext.modelFamily,
    originalSteps: req.flowContext.steps,
    scpiContext: req.scpiContext as Array<Record<string, unknown>>,
  });
  // Two-pass validation: re-run post-check over the repaired output.
  const checkedPass2 = await postCheckResponse(checkedPass1.text, {
    backend: req.flowContext.backend,
    modelFamily: req.flowContext.modelFamily,
    originalSteps: req.flowContext.steps,
    scpiContext: req.scpiContext as Array<Record<string, unknown>>,
  });
  const checked = {
    text: checkedPass2.text,
    errors: Array.from(new Set([...(checkedPass1.errors || []), ...(checkedPass2.errors || [])])),
    warnings: Array.from(new Set([...(checkedPass1.warnings || []), ...(checkedPass2.warnings || [])])),
  };

  if (checked.errors.length && shortcut && !shouldAttemptShortcutFirst(req)) {
    const fallback = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
    });
    const modelLooksWeak = !hasActionsJsonPayload(checked.text) && /return actions_json|add|insert|build|fix|update/i.test(req.userMessage);
    if (!fallback.errors.length && modelLooksWeak) {
      return {
        text: fallback.text,
        errors: [],
        warnings: fallback.warnings,
        metrics: {
          ...loopResult.metrics,
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
        },
        debug: {
          ...loopResult.debug,
          shortcutResponse: shortcut,
        },
      };
    }
  }

  if (checked.errors.length) {
    console.log('[MCP] postCheck errors:', checked.errors);
  }
  if (checked.warnings.length) {
    console.log('[MCP] postCheck warnings:', checked.warnings);
  }
  return {
      text: checked.text,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        ...loopResult.metrics,
        totalMs: Date.now() - startedAt,
    },
    debug: loopResult.debug,
  };
}

