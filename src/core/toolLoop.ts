import { loadPolicyBundle } from './policyLoader';
import type { McpChatRequest } from './schemas';
import { getToolDefinitions, runTool } from '../tools';
import { postCheckResponse } from './postCheck';

interface ToolLoopResult {
  text: string;
  errors: string[];
}

const SCPI_ARG_TYPES = `
SCPI argument types:
<NR1>=integer  <NR2>=decimal  <NR3>=scientific  <QString>="quoted string"
{A|B|C}=choose one  [arg]=optional  <x>=numeric index(1,2,3...)
NaN response: 9.91E+37 means not-a-number/unavailable
Example: CH<x>:SCAle <NR3> -> CH1:SCAle 1.0E-1
`.trim();

const GROUP_ROUTING = `
When user asks about a feature area, call get_command_group FIRST:
  bus protocols (CAN, I2C, SPI, UART, USB, ARINC) -> get_command_group("Bus")
  measurements (freq, amp, rise, overshoot) -> get_command_group("Measurement")
  triggering -> get_command_group("Trigger")
  acquisition modes -> get_command_group("Acquisition")
  waveform transfer -> get_command_group("Waveform Transfer")
  search/mark -> get_command_group("Search and Mark")
  save/recall -> get_command_group("Save and Recall")
Then call search_scpi within that context.
`.trim();

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
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: clipString(entry.shortDescription, 200),
    syntax: entry.syntax,
    example: resolvedExample
      ? {
          scpi: (resolvedExample.scpi as Record<string, unknown> | undefined)?.code || resolvedExample.scpi,
          python: (resolvedExample.python as Record<string, unknown> | undefined)?.code || resolvedExample.python,
          tm_devices:
            (resolvedExample.tm_devices as Record<string, unknown> | undefined)?.code ||
            resolvedExample.tm_devices,
        }
      : undefined,
    notes: Array.isArray(entry.notes) ? (entry.notes as unknown[]).slice(0, 2).map((n) => clipString(n, 180)) : [],
    validValues: entry.validValues,
  };
}

function slimToolResultForModel(name: string, result: unknown): unknown {
  const payload = (result || {}) as Record<string, unknown>;
  const data = payload.data;
  if (!Array.isArray(data)) return result;

  const limited = data.slice(0, 5).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const obj = item as Record<string, unknown>;
    if (name === 'search_scpi') return slimScpiEntry(obj);
    if (name === 'search_tm_devices') {
      return {
        modelRoot: obj.modelRoot,
        methodPath: obj.methodPath,
        signature: clipString(obj.signature, 180),
        availableForModel: obj.availableForModel,
      };
    }
    if (name === 'get_command_group') {
      const headers = Array.isArray(obj.commandHeaders) ? (obj.commandHeaders as unknown[]) : [];
      const trimmedHeaders = headers
        .filter((h): h is string => typeof h === 'string')
        .slice(0, 80);
      return {
        groupName: obj.groupName,
        description: clipString(obj.description, 280),
        commandCount: obj.commandCount,
        commandHeaders: trimmedHeaders,
        truncated: headers.length > trimmedHeaders.length,
      };
    }
    return obj;
  });

  return {
    ...payload,
    data: limited,
    sourceMeta: Array.isArray(payload.sourceMeta) ? (payload.sourceMeta as unknown[]).slice(0, 5) : payload.sourceMeta,
    warnings: [
      ...(Array.isArray(payload.warnings) ? (payload.warnings as unknown[]) : []),
      ...(data.length > limited.length ? [`Truncated tool data from ${data.length} to ${limited.length} entries`] : []),
    ],
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

function buildSystemPrompt(policies: Record<string, string>): string {
  return [
    SCPI_ARG_TYPES,
    GROUP_ROUTING,
    '',
    '# TekAutomate Flow Builder',
    '',
    'You are an expert assistant for building Tektronix instrument automation workflows.',
    'You have access to tools that search a verified SCPI command library (8400+ commands across 8 instrument families).',
    'You MUST use these tools to verify every SCPI command before emitting it.',
    '',
    '## Critical Rules',
    '- ALWAYS call search_scpi or get_command_by_header before emitting ANY SCPI command',
    '- Use EXACT syntax from tool results — never invent commands',
    '- Start flows with connect, end with disconnect',
    '- Query steps MUST have saveAs parameter',
    '- Output: 1-2 sentences then ACTIONS_JSON block',
    '- NEVER output Python unless explicitly requested',
    '',
    policies.response_format || '',
    policies.steps_json || '',
    policies.scpi_verification || '',
    policies.backend_taxonomy || '',
    policies.blockly_xml || '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildWorkspaceSummary(req: McpChatRequest): string {
  const fc = req.flowContext;
  const connect = Array.isArray(fc.steps)
    ? (fc.steps.find((s: Record<string, unknown>) => String(s.type || '') === 'connect') as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const p = ((connect?.params || {}) as Record<string, unknown>) || {};
  const lines = [
    'Workspace context:',
    `- Backend: ${fc.backend || 'pyvisa'}`,
    `- Host: ${fc.host || '(unknown)'}`,
    `- Connection type: ${fc.connectionType || '(unknown)'}`,
    `- Model family: ${fc.modelFamily || '(unknown)'}`,
    connect ? `- Device alias: ${(p.alias as string) || (p.device as string) || 'scope'}` : '',
    connect ? `- VISA backend: ${(p.visaBackend as string) || (p.backend as string) || 'default'}` : '',
    connect ? `- Timeout: ${String(p.timeout || 5000)}ms` : '',
    `- Step count: ${Array.isArray(fc.steps) ? fc.steps.length : 0}`,
    `- Execution source: ${fc.executionSource}`,
  ].filter(Boolean);
  return lines.join('\n');
}

function buildUserPrompt(req: McpChatRequest): string {
  const fc = req.flowContext;
  const rc = req.runContext;
  const currentStepsJson = JSON.stringify(
    {
      name: 'Current Workflow',
      backend: fc.backend || 'pyvisa',
      steps: Array.isArray(fc.steps) ? fc.steps : [],
    },
    null,
    2
  );

  const parts = [
    'Here is the current workspace state:',
    '',
    '--- CURRENT STEPS JSON ---',
    currentStepsJson,
    '--- END JSON ---',
    '',
    buildWorkspaceSummary(req),
    '',
    `User request:
${req.userMessage}`,
    '',
    'Instructions:',
    `- Generate valid TekAutomate ${req.outputMode === 'blockly_xml' ? 'Blockly XML and matching flow-safe logic' : 'Steps UI JSON'}`,
    '- Preserve existing steps when possible',
    '- Fix errors if present',
    '- Add missing steps if needed',
    '- Output only apply-ready result content',
  ];

  if (fc.selectedStepId) {
    parts.push('', `Selected step: ${fc.selectedStepId}`);
  }

  parts.push('', `Run status: ${rc.runStatus}${rc.exitCode !== null ? ` (exit ${rc.exitCode})` : ''}`);
  if (rc.logTail) {
    const tail = rc.logTail.length > 1400 ? `...${rc.logTail.slice(-1400)}` : rc.logTail;
    parts.push('', 'Run log:', tail);
  }
  if (rc.auditOutput) {
    const audit = rc.auditOutput.length > 900 ? `...${rc.auditOutput.slice(-900)}` : rc.auditOutput;
    parts.push('', 'Audit:', audit);
  }
  if (req.instrumentEndpoint) {
    parts.push(
      '',
      `Live instrument:
- Executor: ${req.instrumentEndpoint.executorUrl}
- VISA: ${req.instrumentEndpoint.visaResource}
- Backend: ${req.instrumentEndpoint.backend}`
    );
  }
  return parts.filter(Boolean).join('\n');
}

async function runOpenAiToolLoop(req: McpChatRequest, maxCalls = 12): Promise<string> {
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

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildSystemPrompt(policies) },
    { role: 'user', content: buildUserPrompt(req) },
  ];

  for (let i = 0; i < maxCalls; i += 1) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        tools,
        tool_choice: 'auto',
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
      const modelResult = slimToolResultForModel(name, result);
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify(modelResult),
      });
    }
  }
  return 'Tool call limit reached. ACTIONS_JSON: {"summary":"Failed to complete within tool budget.","findings":[],"suggestedFixes":[],"actions":[]}';
}

async function runAnthropicToolLoop(req: McpChatRequest, maxCalls = 12): Promise<string> {
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
  const messages: Array<Record<string, unknown>> = [
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
        system: buildSystemPrompt(policies),
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
      const modelResult = slimToolResultForModel(name, result);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify(modelResult),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return 'Tool call limit reached. ACTIONS_JSON: {"summary":"Failed to complete within tool budget.","findings":[],"suggestedFixes":[],"actions":[]}';
}

export async function runToolLoop(req: McpChatRequest): Promise<ToolLoopResult> {
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
