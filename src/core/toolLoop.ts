import { loadPolicyBundle } from './policyLoader';
import type { McpChatRequest } from './schemas';
import { getToolDefinitions, runTool } from '../tools';
import { postCheckResponse } from './postCheck';

interface ToolLoopResult {
  text: string;
  errors: string[];
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
    'You are TekAutomate Flow Builder.',
    'You must produce safe, verified output for TekAutomate workflows.',
    policies.response_format || '',
    policies.backend_taxonomy || '',
    policies.scpi_verification || '',
    policies.steps_json || '',
    policies.blockly_xml || '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildUserPrompt(req: McpChatRequest): string {
  return [
    `User message: ${req.userMessage}`,
    `Output mode: ${req.outputMode}`,
    `Flow context: ${JSON.stringify(req.flowContext)}`,
    `Run context: ${JSON.stringify(req.runContext)}`,
    req.instrumentEndpoint
      ? `Instrument endpoint: ${JSON.stringify(req.instrumentEndpoint)}`
      : 'Instrument endpoint: unavailable',
  ].join('\n');
}

async function runOpenAiToolLoop(req: McpChatRequest, maxCalls = 6): Promise<string> {
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
