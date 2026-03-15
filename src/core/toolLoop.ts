import { loadPolicyBundle } from './policyLoader';
import type { McpChatRequest } from './schemas';
import { getToolDefinitions, runTool } from '../tools';
import { postCheckResponse } from './postCheck';

interface ToolLoopResult {
  text: string;
  errors: string[];
}

// Condensed SCPI arg-type reference (injected into user prompt, not system prompt,
// to reduce static system prompt token usage — Fix 5).
const SCPI_ARG_TYPES_BRIEF = '<NR1>=int <NR2>=dec <NR3>=sci <QString>="str" {A|B}=choose [x]=opt NaN=9.91E+37';

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
        description: clipString(obj.text || obj.description || obj.shortDescription, 200),
        usageExample: clipString(obj.usageExample || obj.example, 200),
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

function buildSystemPrompt(policies: Record<string, string>, outputMode?: string): string {
  // Fix 5: reduced system prompt. SCPI_ARG_TYPES moved to user prompt. blockly_xml only
  // included when output mode is blockly_xml (saves ~800 tokens on every other request).
  const parts = [
    '# TekAutomate Flow Builder',
    'Expert assistant for Tektronix instrument automation. Use tools to verify every SCPI command.',
    '## Rules',
    '- Call search_scpi or get_command_by_header BEFORE emitting any SCPI command',
    '- Use EXACT syntax from tool results only — never invent commands',
    '- Flows MUST start with connect, end with disconnect',
    '- Query steps MUST have saveAs parameter',
    '- set_step_param actions MUST update one param at a time',
    '- NEVER use param="params" in set_step_param; emit separate actions for scopeType, method, filename, etc.',
    '- If the user explicitly confirms an unverified measurement token or command choice, proceed once and mark it as user-confirmed instead of asking again.',
    '- If the user provides the missing channel after a clarification, continue immediately and generate the requested steps.',
    '- If the user asks to save a screenshot also, add a save_screenshot step without another clarification when placement is inferable from context.',
    '- tm_devices backend + measurement request: build immediately using tm_device_command steps. Never ask about command style.',
    '- For MSO5/6 tm_devices measurements, prefer addmeas-style measurement creation and value query methods. Do NOT fall back to legacy MEASurement:MEAS<x>:TYPE patterns unless the model family is explicitly legacy 5k/7k/70k.',
    '- If part of a request is fully verified, build that part now and isolate only the uncertain portion in findings. Do not stall the whole flow.',
    '- Output: 1-2 sentences then ACTIONS_JSON block',
    '- NEVER output Python unless user explicitly requests it',
    '- Call validate_action_payload as the FINAL tool call before outputting ACTIONS_JSON',
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
  const stepsSummary = Array.isArray(fc.steps) && fc.steps.length
    ? fc.steps.map((s: Record<string, unknown>) =>
        `  [${s.id}] ${s.type}${s.label ? ` "${s.label}"` : ''}${s.command ? ` → ${s.command}` : ''}`
      ).join('\n')
    : '  (empty flow)';

  const parts = [
    // Fix 5: SCPI arg types moved here from system prompt (only paid once per call, not multiplied by tool rounds)
    `SCPI types: ${SCPI_ARG_TYPES_BRIEF}`,
    `## User Request\n${req.userMessage}`,
    `## Output Mode\n${req.outputMode}`,
    `## Device Context\nBackend: ${fc.backend || 'pyvisa'}\nModel: ${fc.modelFamily || '(unknown)'}\nHost: ${fc.host || '(unknown)'}\nConnection: ${fc.connectionType || 'tcpip'}${fc.deviceType ? `\nDevice Type: ${fc.deviceType}` : ''}`,
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

  if (req.instrumentEndpoint) {
    parts.push(`## Live Instrument\nExecutor: ${req.instrumentEndpoint.executorUrl}\nVISA: ${req.instrumentEndpoint.visaResource}`);
  }

  return parts.join('\n\n');
}

async function runOpenAiToolLoop(req: McpChatRequest, maxCalls = 6): Promise<string> {
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
      const modelResult = slimToolResultForModel(name, result);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify(modelResult),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return 'ACTIONS_JSON: {"summary":"Failed to complete within tool budget.","findings":["Tool call limit reached before the flow could be finalized."],"suggestedFixes":["Retry with a more specific request or reduce the requested scope."],"actions":[]}';
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
