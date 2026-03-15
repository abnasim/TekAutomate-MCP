import { loadPolicyBundle } from './policyLoader';
import type { McpChatRequest } from './schemas';
import { getToolDefinitions, runTool } from '../tools';
import { postCheckResponse } from './postCheck';

interface ToolLoopResult {
  text: string;
  errors: string[];
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function detectMeasurementRequest(req: McpChatRequest): string[] {
  const text = req.userMessage.toLowerCase();
  const found: string[] = [];
  if (/\bfrequency\b|\bfreq\b/.test(text)) found.push('FREQUENCY');
  if (/\bamplitude\b|\bamp\b/.test(text)) found.push('AMPLITUDE');
  if (/\bpositive overshoot\b|\bpos(?:itive)?\s*overshoot\b|\bpovershoot\b/.test(text)) {
    found.push('POVERSHOOT');
  }
  return found;
}

function detectMeasurementChannel(req: McpChatRequest): string | null {
  const text = req.userMessage.toUpperCase();
  const match = text.match(/\bCH([1-8])\b/);
  return match ? `CH${match[1]}` : null;
}

function isFastFrameRequest(req: McpChatRequest): boolean {
  return /\bfast\s*frame\b|\bfastframe\b/i.test(req.userMessage);
}

function detectFastFrameCount(req: McpChatRequest): number {
  const match = req.userMessage.match(/\b(\d+)\s+frames?\b/i) || req.userMessage.match(/\bcount\s+(\d+)\b/i);
  return match ? Math.max(1, Number(match[1])) : 10;
}

function isValidationRequest(req: McpChatRequest): boolean {
  return /\b(validate|validation|review|check flow|does this look right|does this look good|looks good|briefly)\b/i.test(
    req.userMessage
  );
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
  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const isBuildNew = existingSteps.length === 0;

  // Build write+query triples for each measurement
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

  const queryGroup: Record<string, unknown>[] = measurementSlots.map(({ measurement, slot, saveAsName }) => ({
    id: `q${slot}`,
    type: 'query',
    label: `Query ${measurement.toLowerCase()} result`,
    params: {
      command: `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN?`,
      saveAs: saveAsName,
    },
  }));

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
        {
          id: 'g2', type: 'group', label: 'Read measurement results', params: {}, collapsed: false,
          children: queryGroup,
        },
        ...screenshotStep,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    const summaryParts = [`Added ${measurements.join(', ')} measurements on ${channel}.`];
    if (hasScreenshot) summaryParts.push('Screenshot step included.');
    const actions = [{ type: 'replace_flow', flow }];
    return `ACTIONS_JSON: ${JSON.stringify({ summary: summaryParts.join(' '), findings: [], suggestedFixes: [], actions })}`;
  }

  // Existing flow — insert steps
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (existingSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;
  const allNewSteps = [...addGroup, ...queryGroup, ...screenshotStep];
  const insertActions = allNewSteps.map((step) => ({
    type: 'insert_step_after',
    targetStepId: insertAfterId,
    newStep: step,
  }));
  return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added ${measurements.join(', ')} measurement steps on ${channel}.`, findings: [], suggestedFixes: [], actions: insertActions })}`;
}

function buildPyvisaFastFrameShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null;
  if (!isFastFrameRequest(req)) return null;

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const count = detectFastFrameCount(req);
  const connectStep = existingSteps.find((step) => String(step.type || '') === 'connect') as Record<string, unknown> | undefined;
  const screenshotStep = existingSteps.find((step) => String(step.type || '') === 'save_screenshot') as Record<string, unknown> | undefined;
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
    actions.push(
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: fastFrameSteps[0] },
      { type: 'insert_step_after', targetStepId: 'ff1', newStep: fastFrameSteps[1] }
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

// Condensed SCPI arg-type reference (injected into user prompt, not system prompt,
// to reduce static system prompt token usage — Fix 5).
const SCPI_ARG_TYPES_BRIEF = '<NR1>=int <NR2>=dec <NR3>=sci <QString>="str" {A|B}=choose [x]=opt NaN=9.91E+37';
const KNOWN_PATTERN_HINTS = [
  'Measurements on modern scopes: use MEASUrement:ADDMEAS <TYPE>, set SOUrce1 to the requested channel, then query MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN?.',
  'FastFrame on modern scopes: use HORizontal:FASTframe:STATE ON and HORizontal:FASTframe:COUNt <N>.',
  'Screenshots on pyvisa scopes: prefer save_screenshot step type (scopeType:modern, method:pc_transfer) instead of raw HARDCOPY or SAVE:IMAGe commands.',
  'tm_devices backend: prefer tm_device_command steps, not raw write/query SCPI steps.',
  'Standard measurement enums are pre-verified: FREQUENCY, AMPLITUDE, POVERSHOOT, NOVERSHOOT, RISETIME, FALLTIME, PERIOD, PK2PK, MEAN, RMS. No search_scpi needed for these.',
  'Do not use search_tm_devices for normal scope SCPI requests. Use it only when backend is tm_devices or the user explicitly asks for tm_devices conversion.',
  'For scope command routing, use only 2 coarse families: modern MSO 2/4/5/6/7 or legacy 5k/7k/70k. Do not waste tool calls on exact submodel variants like MSO56 vs MSO6B.',
].join('\n- ');

// Golden flow examples injected inline — gives the model a direct pattern to match
// without requiring a getTemplateExamples tool call.
const GOLDEN_EXAMPLES_PYVISA = `## Golden Flow Examples

### Measurement + Screenshot (pyvisa, MSO5/6)
Request: "Add CH1 frequency, amplitude, positive overshoot measurements, query results, save screenshot"
ACTIONS_JSON: {"summary":"Connected, added 3 CH1 measurements, queried results, screenshot, disconnected.","findings":[],"suggestedFixes":[],"actions":[{"type":"replace_flow","flow":{"name":"CH1 Measurements","description":"Frequency, amplitude, positive overshoot on CH1 with screenshot","backend":"pyvisa","deviceType":"SCOPE","steps":[{"id":"1","type":"connect","label":"Connect to scope","params":{"instrumentIds":["scope1"],"printIdn":true}},{"id":"g1","type":"group","label":"Add CH1 measurements","params":{},"collapsed":false,"children":[{"id":"2","type":"write","label":"Add frequency measurement","params":{"command":"MEASUrement:ADDMEAS FREQUENCY"}},{"id":"3","type":"write","label":"Set frequency source to CH1","params":{"command":"MEASUrement:MEAS1:SOUrce1 CH1"}},{"id":"4","type":"write","label":"Add amplitude measurement","params":{"command":"MEASUrement:ADDMEAS AMPLITUDE"}},{"id":"5","type":"write","label":"Set amplitude source to CH1","params":{"command":"MEASUrement:MEAS2:SOUrce1 CH1"}},{"id":"6","type":"write","label":"Add positive overshoot measurement","params":{"command":"MEASUrement:ADDMEAS POVERSHOOT"}},{"id":"7","type":"write","label":"Set positive overshoot source to CH1","params":{"command":"MEASUrement:MEAS3:SOUrce1 CH1"}}]},{"id":"g2","type":"group","label":"Read measurement results","params":{},"collapsed":false,"children":[{"id":"8","type":"query","label":"Query frequency result","params":{"command":"MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?","saveAs":"ch1_frequency"}},{"id":"9","type":"query","label":"Query amplitude result","params":{"command":"MEASUrement:MEAS2:RESUlts:CURRentacq:MEAN?","saveAs":"ch1_amplitude"}},{"id":"10","type":"query","label":"Query positive overshoot result","params":{"command":"MEASUrement:MEAS3:RESUlts:CURRentacq:MEAN?","saveAs":"ch1_positive_overshoot"}}]},{"id":"11","type":"save_screenshot","label":"Save Screenshot","params":{"filename":"screenshot.png","scopeType":"modern","method":"pc_transfer"}},{"id":"12","type":"disconnect","label":"Disconnect","params":{}}]}}]}

### Single Measurement (pyvisa, MSO5/6)
Request: "Add frequency measurement on CH1"
ACTIONS_JSON: {"summary":"Added frequency measurement on CH1.","findings":[],"suggestedFixes":[],"actions":[{"type":"insert_step_after","targetStepId":null,"newStep":{"id":"m1","type":"write","label":"Add frequency measurement","params":{"command":"MEASUrement:ADDMEAS FREQUENCY"}}},{"type":"insert_step_after","targetStepId":"m1","newStep":{"id":"m2","type":"write","label":"Set frequency source to CH1","params":{"command":"MEASUrement:MEAS1:SOUrce1 CH1"}}},{"type":"insert_step_after","targetStepId":"m2","newStep":{"id":"m3","type":"query","label":"Query frequency result","params":{"command":"MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?","saveAs":"ch1_frequency"}}}]}
`;

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

function buildSystemPrompt(policies: Record<string, string>, outputMode?: string): string {
  const parts = [
    '# TekAutomate Flow Builder',
    'Expert assistant for Tektronix instrument automation.',
    '## Core Rules',
    '- Standard pre-verified commands (IEEE 488.2, MEASUrement:ADDMEAS, CH<x>:*, TRIGger:A:*, HORizontal:*, ACQuire:*, FastFrame) need NO tool call — build immediately.',
    '- Call search_scpi ONLY for commands outside the pre-verified set (novel, app-specific, or unfamiliar commands).',
    '- Use EXACT syntax from tool results when you DO call a tool.',
    '- Flows MUST start with connect, end with disconnect.',
    '- Query steps MUST have saveAs parameter.',
    '- set_step_param actions MUST update one param at a time. NEVER use param="params".',
    '- Emit separate set_step_param actions for scopeType, method, filename, etc.',
    '- If user provides channel/confirmation after a clarification, build immediately — no repeat questions.',
    '- If user asks for screenshot, add save_screenshot without asking when placement is inferable.',
    '- If the user says "add these commands", "apply that", "do it", or similar after a command lookup/explanation, treat it as a mutation request and return ACTIONS_JSON, not prose.',
    '- tm_devices + measurement: build immediately with tm_device_command steps. Never ask about command style.',
    '- For MSO5/6 tm_devices, use addmeas-style creation and mean.query(). Never fall back to legacy MEAS<x>:TYPE.',
    '- Treat backend, device driver, visa backend, alias, and instrument map as authoritative routing truth.',
    '- If backend is pyvisa, vxi11, or tekhsi, prefer SCPI-oriented steps unless the user explicitly asks to convert.',
    '- If backend is tm_devices, prefer tm_device_command steps unless the user explicitly asks to convert.',
    '- Never call search_tm_devices for normal scope SCPI tasks such as screenshot, FastFrame, trigger, horizontal, or basic measurements.',
    '- Built-in TekAutomate step types are already preferred patterns: save_screenshot for screenshots, save_waveform for waveform saves, connect/disconnect for connection handling.',
    '- Standard screenshot, FastFrame, trigger, horizontal, and measurement requests should usually complete in zero tool calls.',
    '- Model routing is coarse, not exact: modern scopes use the MSO 2/4/5/6/7 corpus; legacy scopes use 5k/7k/70k. Do not spend tool calls on exact model variant names.',
    '- If the user asks to convert SCPI to tm_devices or tm_devices to SCPI, preserve behavior and change only the command representation.',
    '- If part of a request is fully pre-verified, build that part now. Isolate only uncertain portions in findings.',
    '- Only call verify_scpi_commands for multi-command flows (3+ novel commands).',
    '- Only call validate_action_payload for complex/grouped flows.',
    '- For standard requests: match the golden flow examples below, output ACTIONS_JSON directly, no tool calls.',
    '- Output: 1-2 sentences then ACTIONS_JSON block.',
    '- NEVER output Python unless user explicitly requests it.',
    '- Mutation requests MUST return actionable ACTIONS_JSON, not promises like "I will add..." or "I can insert...".',
    '- If the user says add, insert, apply, update, fix, remove, replace, move, convert, or do it, return ACTIONS_JSON in the same response.',
    '- ACTIONS_JSON may use only these action types: set_step_param, insert_step_after, remove_step, add_error_check_after_step, replace_sleep_with_opc_query, move_step, replace_step, replace_flow.',
    '- Use insert_step_after for incremental additions near existing steps. Use replace_flow only when rebuilding the whole flow is clearly better or the user asked for a rebuild.',
    '- set_step_param changes exactly one param at a time. Never replace the whole params object.',
    '- New steps may use these supported step types: connect, disconnect, query, write, set_and_query, sleep, comment, python, save_waveform, save_screenshot, error_check, group, tm_device_command, recall.',
    '- For follow-up requests after a command explanation, convert the explained command into concrete write/query steps immediately.',
    '- Validation is user-truth first: if the flow already runs or audit/logs show success, say "Flow looks good." unless there is a concrete blocker.',
    '- A blocker must be something that will prevent build, apply, or execution. Hidden/internal params, backend normalization, or style cleanup are NOT blockers by themselves.',
    '- If execution succeeded, backend mismatch or internal-param mismatches are warnings or optional autofixes only.',
    '- Do not rebuild or replace a successful flow just to normalize backend labels or add inferred params.',
    '- In a single-instrument workspace, connect steps do NOT need instrumentIds/printIdn to count as valid if the active device can be resolved from workspace context.',
    '- save_screenshot steps do NOT need to be called invalid just because filename, scopeType, or method can be inferred or were already proven to work at runtime.',
    '- Treat executor/runtime success as stronger evidence than schema preferences.',
    '',
    GOLDEN_EXAMPLES_PYVISA,
    '',
    policies.response_format || '',
    policies.steps_json || '',
    policies.scpi_verification || '',
    policies.backend_taxonomy || '',
  ];
  if (outputMode === 'blockly_xml') {
    parts.push(policies.blockly_xml || '');
  }
  return parts.filter(Boolean).join('\n\n');
}

function buildUserPrompt(req: McpChatRequest): string {
  const fc = req.flowContext;
  const rc = req.runContext;
  const validateMode = isValidationRequest(req);
  const executionSucceeded = runLooksSuccessful(rc);
  const currentStepsJson = JSON.stringify(fc.steps || [], null, 2);
  const stepsSummary = Array.isArray(fc.steps) && fc.steps.length
    ? fc.steps.map((s: Record<string, unknown>) =>
        `  [${s.id}] ${s.type}${s.label ? ` "${s.label}"` : ''}${typeof (s.params as Record<string, unknown> | undefined)?.command === 'string' ? ` -> ${String((s.params as Record<string, unknown>).command)}` : ''}`
      ).join('\n')
    : '  (empty flow)';

  const instrumentLine = `  - scope1: ${fc.deviceType || 'SCOPE'}, ${fc.backend || 'pyvisa'} @ ${fc.host || 'localhost'}`;
  const instrumentMapLines = Array.isArray(fc.instrumentMap) && fc.instrumentMap.length
    ? fc.instrumentMap
        .map((device) =>
          `  - ${String(device.alias || 'device')}: ${String(device.deviceType || 'SCOPE')}, ${String(device.backend || 'pyvisa')}${device.deviceDriver ? `, driver ${String(device.deviceDriver)}` : ''}${device.visaBackend ? `, visa ${String(device.visaBackend)}` : ''}${device.host ? ` @ ${String(device.host)}` : ''}`
        )
        .join('\n')
    : instrumentLine;
  const parts = [
    `SCPI types: ${SCPI_ARG_TYPES_BRIEF}`,
    `Known patterns:\n- ${KNOWN_PATTERN_HINTS}`,
    '--- CURRENT STEPS JSON ---',
    currentStepsJson,
    '--- END JSON ---',
    '',
    'Workspace context:',
    `- Backend: ${fc.backend || 'pyvisa'}`,
    `- Model Family: ${fc.modelFamily || '(unknown)'}`,
    `- Connection: ${fc.connectionType || 'tcpip'}`,
    `- Device Type: ${fc.deviceType || 'SCOPE'}`,
    `- Device Driver: ${fc.deviceDriver || '(unknown)'}`,
    `- VISA Backend: ${fc.visaBackend || '(unknown)'}`,
    `- Alias: ${fc.alias || 'scope1'}`,
    '- Instruments in workspace:',
    instrumentMapLines,
    '',
    'User request:',
    req.userMessage,
    '',
    'Instructions:',
    validateMode
      ? '- Validate from the user perspective. If the flow is already usable, say "Flow looks good."'
      : '- Generate valid TekAutomate Steps UI JSON',
    '- Preserve existing steps when possible',
    validateMode
      ? '- Only call out blockers that would actually prevent apply or execution'
      : '- Fix errors if present',
    validateMode
      ? '- Treat backend/style/internal-param mismatches as warnings or optional autofixes unless execution failed'
      : '- Add missing steps if needed',
    validateMode
      ? '- In single-instrument flows, do not treat missing connect instrumentIds/printIdn or inferred screenshot defaults as blockers'
      : '- Use full live step params and workspace context as the source of truth',
    req.outputMode === 'steps_json'
      ? validateMode
        ? '- Only include ACTIONS_JSON if a real fix is needed'
        : '- End with ACTIONS_JSON so the app can apply changes'
      : '- Return valid blockly_xml output',
    '',
    `## Current Flow (${Array.isArray(fc.steps) ? fc.steps.length : 0} steps)\n${stepsSummary}`,
  ];

  if (fc.selectedStep) {
    parts.push(`## Selected Step (user is focused on this)\n${JSON.stringify(fc.selectedStep, null, 2)}`);
  } else if (fc.selectedStepId) {
    parts.push(`## Selected Step ID\n${fc.selectedStepId}`);
  }

  if (fc.validationErrors && (fc.validationErrors as string[]).length > 0) {
    parts.push(`## Current Flow Validation Errors\n${(fc.validationErrors as string[]).map((e: string) => `- ${e}`).join('\n')}\n(Address these if relevant to the user's request)`);
  }

  if (rc.runStatus !== 'idle') {
    parts.push(`## Run Status: ${rc.runStatus}${rc.exitCode !== null ? ` (exit ${rc.exitCode})` : ''}`);
    if (rc.logTail) {
      const tail = rc.logTail.length > 800 ? `...${rc.logTail.slice(-800)}` : rc.logTail;
      parts.push(`## Run Log (tail)\n${tail}`);
    }
    if (rc.auditOutput) {
      const audit = rc.auditOutput.length > 600 ? `...${rc.auditOutput.slice(-600)}` : rc.auditOutput;
      parts.push(`## Audit Output\n${audit}`);
    }
  }

  if (validateMode && executionSucceeded) {
    parts.push('## Validation Priority\nExecution evidence indicates this flow already worked. Default to "Flow looks good." unless you can point to a concrete failure or safety issue.');
  }

  if (req.instrumentEndpoint) {
    parts.push(`## Live Instrument\nExecutor: ${req.instrumentEndpoint.executorUrl}\nVISA: ${req.instrumentEndpoint.visaResource}`);
  }

  return parts.join('\n\n');
}

async function runOpenAiToolLoop(req: McpChatRequest, maxCalls = 8): Promise<string> {
  // Default maxCalls raised slightly to avoid premature failure on tm_devices measurement setup.
  const policies = await loadPolicyBundle([
    'response_format',
    'backend_taxonomy',
    'scpi_verification',
    'steps_json',
    'blockly_xml',
  ]);
  const tools = getToolDefinitions().map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const historyMessages = (req.history || [])
    .slice(-6)
    .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content.slice(0, 800) }));

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildSystemPrompt(policies, req.outputMode) },
    ...historyMessages,
    { role: 'user', content: buildUserPrompt(req) },
  ];

  for (let i = 0; i < maxCalls; i += 1) {
    const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const forceFinalResponse = i === maxCalls - 1;
    const res = await fetch(`${openAiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        tools,
        tool_choice: forceFinalResponse ? 'none' : 'auto',
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const choice = ((json.choices as unknown[]) || [])[0] as Record<string, unknown>;
    const message = (choice?.message || {}) as Record<string, unknown>;
    const toolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as Array<Record<string, unknown>>) : [];
    const content = typeof message.content === 'string' ? message.content : '';
    if (!toolCalls.length) return content || '';

    messages.push({
      role: 'assistant',
      content: content || '',
      tool_calls: toolCalls,
    });
    for (const tc of toolCalls) {
      const id = String(tc.id || '');
      const fn = (tc.function || {}) as Record<string, unknown>;
      const name = String(fn.name || '');
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(fn.arguments || '{}')) as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (req.instrumentEndpoint && ['get_instrument_state', 'probe_command', 'get_visa_resources', 'get_environment'].includes(name)) {
        args = { ...req.instrumentEndpoint, ...args };
      }
      logToolCall(name, args);
      const result = await runTool(name, args);
      logToolResult(name, result);
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify(result),
      });
    }
  }
  return 'ACTIONS_JSON: {"summary":"Failed to complete within tool budget.","findings":["Tool call limit reached before the flow could be finalized."],"suggestedFixes":["Retry with a more specific request or reduce the requested scope."],"actions":[]}';
}

async function runAnthropicToolLoop(req: McpChatRequest, maxCalls = 6): Promise<string> {
  const policies = await loadPolicyBundle([
    'response_format',
    'backend_taxonomy',
    'scpi_verification',
    'steps_json',
    'blockly_xml',
  ]);
  const tools = getToolDefinitions().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  const anthropicHistoryMessages = (req.history || [])
    .slice(-6)
    .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content.slice(0, 800) }));

  const messages: Array<Record<string, unknown>> = [
    ...anthropicHistoryMessages,
    { role: 'user', content: buildUserPrompt(req) },
  ];

  for (let i = 0; i < maxCalls; i += 1) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        system: buildSystemPrompt(policies, req.outputMode),
        max_tokens: 2000,
        tools,
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const content = Array.isArray(json.content) ? (json.content as Array<Record<string, unknown>>) : [];
    const toolUse = content.filter((c) => c.type === 'tool_use');
    const text = content.filter((c) => c.type === 'text').map((c) => String(c.text || '')).join('\n');
    if (!toolUse.length) return text;

    messages.push({ role: 'assistant', content });
    const toolResults: Array<Record<string, unknown>> = [];
    for (const use of toolUse) {
      const name = String(use.name || '');
      const id = String(use.id || '');
      let args = (use.input || {}) as Record<string, unknown>;
      if (req.instrumentEndpoint && ['get_instrument_state', 'probe_command', 'get_visa_resources', 'get_environment'].includes(name)) {
        args = { ...req.instrumentEndpoint, ...args };
      }
      logToolCall(name, args);
      const result = await runTool(name, args);
      logToolResult(name, result);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return 'ACTIONS_JSON: {"summary":"Failed to complete within tool budget.","findings":["Tool call limit reached before the flow could be finalized."],"suggestedFixes":["Retry with a more specific request or reduce the requested scope."],"actions":[]}';
}

export async function runToolLoop(req: McpChatRequest): Promise<ToolLoopResult> {
  const shortcut = buildPyvisaMeasurementShortcut(req) || buildTmDevicesMeasurementShortcut(req) || buildPyvisaFastFrameShortcut(req);
  if (shortcut) {
    const checked = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
    });
    return {
      text: checked.text,
      errors: checked.errors,
    };
  }
  const text =
    req.provider === 'anthropic'
      ? await runAnthropicToolLoop(req)
      : await runOpenAiToolLoop(req);
  const checked = await postCheckResponse(text, {
    backend: req.flowContext.backend,
    modelFamily: req.flowContext.modelFamily,
    originalSteps: req.flowContext.steps,
  });
  return {
    text: checked.text,
    errors: checked.errors,
  };
}
