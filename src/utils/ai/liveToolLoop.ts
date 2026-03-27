/**
 * Live Tool Loop — browser calls AI directly, MCP only for tool execution.
 *
 * Flow:
 *   Browser → Claude/OpenAI API (with tool definitions)
 *   AI returns tool_use → Browser → MCP /tools/execute → result
 *   Browser → AI (feed result) → loop until done
 *
 * No AI proxy through MCP. Keys stay in browser.
 */

import { resolveMcpHost } from './mcpClient';

// ── Types ──

export interface LiveToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LiveToolLoopParams {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  history?: Array<{ role: string; content: string }>;
  tools: LiveToolDef[];
  instrumentEndpoint?: {
    executorUrl: string;
    visaResource: string;
    backend: string;
    liveMode?: boolean;
    outputMode?: 'clean' | 'verbose';
  };
  flowContext?: {
    modelFamily?: string;
    deviceDriver?: string;
  };
  maxIterations?: number;
  onChunk?: (text: string) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
}

export interface LiveToolLoopResult {
  text: string;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
  iterations: number;
  error?: string;
}

// ── Tool Execution ──

const EXECUTOR_TOOLS = new Set([
  'send_scpi', 'capture_screenshot', 'get_instrument_state',
  'probe_command', 'get_visa_resources', 'get_environment',
]);

/**
 * Execute a tool call. Instrument tools go directly to the executor (browser → executor).
 * Knowledge/search tools go through MCP server (/tools/execute).
 * This means live mode works even when MCP is hosted — browser reaches executor directly.
 */
async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  instrumentEndpoint?: LiveToolLoopParams['instrumentEndpoint'],
  flowContext?: LiveToolLoopParams['flowContext']
): Promise<unknown> {
  // Instrument tools: call executor directly from browser (no MCP needed)
  if (EXECUTOR_TOOLS.has(toolName) && instrumentEndpoint?.executorUrl) {
    const execUrl = instrumentEndpoint.executorUrl.replace(/\/$/, '');
    const scopeVisa = instrumentEndpoint.visaResource;

    // Map tool name to executor action + payload
    let action = toolName;
    let payload: Record<string, unknown> = { ...args };
    if (toolName === 'get_instrument_state') {
      action = 'send_scpi';
      payload = { commands: ['*IDN?', '*ESR?', 'ALLEV?'], timeout_ms: 10000 };
    }

    const res = await fetch(`${execUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action,
        timeout_sec: 90,
        scope_visa: scopeVisa,
        liveMode: true,
        ...payload,
      }),
    });
    if (!res.ok) throw new Error(`Executor error ${res.status}`);
    const json = await res.json() as Record<string, unknown>;
    // Executor flattens result_data into top level for send_scpi/capture_screenshot
    return json.result_data ?? (json.base64 ? json : json.responses ? json : json);
  }

  // Knowledge/search tools: call MCP server
  const mcpHost = resolveMcpHost();
  if (!mcpHost) throw new Error('MCP server not configured');

  const res = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: toolName,
      args,
      instrumentEndpoint,
      flowContext,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP tool error ${res.status}: ${text}`);
  }

  const json = await res.json() as { ok: boolean; result: unknown; error?: string };
  if (!json.ok) throw new Error(json.error || 'Tool execution failed');
  return json.result;
}

// ── Anthropic Direct Loop ──

async function runAnthropicLoop(params: LiveToolLoopParams): Promise<LiveToolLoopResult> {
  const {
    apiKey, model, systemPrompt, userMessage, history = [],
    tools, instrumentEndpoint, flowContext,
    maxIterations = 8, onChunk, onToolCall, onToolResult,
  } = params;

  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const messages: Array<Record<string, unknown>> = [
    ...history.slice(-12).map((h) => ({
      role: h.role,
      content: String(h.content || '').slice(0, 3000),
    })),
    { role: 'user', content: userMessage },
  ];

  const toolCallLog: LiveToolLoopResult['toolCalls'] = [];
  let finalText = '';
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: 4096,
        messages,
        tools: anthropicTools,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { text: finalText, toolCalls: toolCallLog, iterations, error: `Anthropic ${res.status}: ${errText}` };
    }

    const json = await res.json() as {
      content: Array<Record<string, unknown>>;
      stop_reason: string;
    };

    const content = Array.isArray(json.content) ? json.content : [];

    // Extract text
    const textParts = content
      .filter((c) => c.type === 'text')
      .map((c) => String(c.text || ''))
      .join('\n');
    if (textParts) {
      finalText = textParts;
      onChunk?.(textParts);
    }

    // Check for tool calls
    const toolUseBlocks = content.filter((c) => c.type === 'tool_use');
    if (toolUseBlocks.length === 0 || json.stop_reason !== 'tool_use') {
      break;
    }

    // Add assistant response to messages
    messages.push({ role: 'assistant', content });

    // Execute tools
    const toolResults: Array<Record<string, unknown>> = [];
    for (const tu of toolUseBlocks) {
      const toolName = String(tu.name || '');
      const toolId = String(tu.id || '');
      const toolArgs = (tu.input && typeof tu.input === 'object') ? tu.input as Record<string, unknown> : {};

      onToolCall?.(toolName, toolArgs);

      try {
        const result = await executeMcpTool(toolName, toolArgs, instrumentEndpoint, flowContext);
        onToolResult?.(toolName, result);
        toolCallLog.push({ tool: toolName, args: toolArgs, result });

        // Check if result contains image data for multimodal
        const resultObj = result && typeof result === 'object' ? result as Record<string, unknown> : null;
        const imageData = resultObj?.data && typeof resultObj.data === 'object'
          ? (resultObj.data as Record<string, unknown>)
          : null;
        const hasImage = imageData && typeof imageData.base64 === 'string' && typeof imageData.mimeType === 'string';

        if (hasImage) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolId,
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageData.mimeType,
                  data: imageData.base64,
                },
              },
              { type: 'text', text: 'Screenshot captured.' },
            ],
          });
        } else {
          // Strip verbose fields the AI doesn't need — keep token count low
          let lean = result;
          if (typeof result === 'object' && result !== null) {
            const r = result as Record<string, unknown>;
            const { rawStdout, rawStderr, combinedOutput, transcript, outputMode, durationSec, ...rest } = r;
            lean = rest;
          }
          const resultStr = typeof lean === 'string' ? lean : JSON.stringify(lean);
          const truncated = resultStr.length > 3000 ? resultStr.slice(0, 3000) + '\n...(truncated)' : resultStr;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolId,
            content: truncated,
          });
        }
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolId,
          is_error: true,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
        toolCallLog.push({ tool: toolName, args: toolArgs, result: { error: String(err) } });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { text: finalText, toolCalls: toolCallLog, iterations };
}

// ── OpenAI Direct Loop ──

async function runOpenAiLoop(params: LiveToolLoopParams): Promise<LiveToolLoopResult> {
  const {
    apiKey, model, systemPrompt, userMessage, history = [],
    tools, instrumentEndpoint, flowContext,
    maxIterations = 8, onChunk, onToolCall, onToolResult,
  } = params;

  const openAiTools = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-12).map((h) => ({
      role: h.role,
      content: String(h.content || '').slice(0, 3000),
    })),
    { role: 'user', content: userMessage },
  ];

  const toolCallLog: LiveToolLoopResult['toolCalls'] = [];
  let finalText = '';
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: openAiTools,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { text: finalText, toolCalls: toolCallLog, iterations, error: `OpenAI ${res.status}: ${errText}` };
    }

    const json = await res.json() as { choices: Array<{ message: Record<string, unknown> }> };
    const message = json.choices?.[0]?.message;
    if (!message) break;

    if (typeof message.content === 'string' && message.content) {
      finalText = message.content;
      onChunk?.(message.content);
    }

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
    if (toolCalls.length === 0) break;

    messages.push(message);

    for (const tc of toolCalls) {
      const fn = tc.function as Record<string, unknown> | undefined;
      const toolName = String(fn?.name || '');
      const toolId = String(tc.id || '');
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = typeof fn?.arguments === 'string' ? JSON.parse(fn.arguments) : {}; } catch { /* ignore */ }

      onToolCall?.(toolName, toolArgs);

      try {
        const result = await executeMcpTool(toolName, toolArgs, instrumentEndpoint, flowContext);
        onToolResult?.(toolName, result);
        toolCallLog.push({ tool: toolName, args: toolArgs, result });
        // Screenshots: don't send base64 to AI — just confirm it was captured
        const resultObj = result && typeof result === 'object' ? result as Record<string, unknown> : null;
        const isScreenshot = resultObj && typeof resultObj.base64 === 'string';
        if (isScreenshot) {
          const sizeKB = Math.round((resultObj.base64 as string).length * 0.75 / 1024);
          messages.push({ role: 'tool', tool_call_id: toolId, content: `Screenshot captured (${sizeKB} KB). The live UI panel has been updated with the latest scope display.` });
        } else {
          // Strip verbose fields to keep token count low
          let lean = result;
          if (typeof result === 'object' && result !== null) {
            const r = result as Record<string, unknown>;
            const { rawStdout, rawStderr, combinedOutput, transcript, outputMode, durationSec, ...rest } = r;
            lean = rest;
          }
          const resultStr = typeof lean === 'string' ? lean : JSON.stringify(lean);
          const truncated = resultStr.length > 3000 ? resultStr.slice(0, 3000) + '\n...(truncated)' : resultStr;
          messages.push({ role: 'tool', tool_call_id: toolId, content: truncated });
        }
      } catch (err) {
        messages.push({ role: 'tool', tool_call_id: toolId, content: `Error: ${err instanceof Error ? err.message : String(err)}` });
        toolCallLog.push({ tool: toolName, args: toolArgs, result: { error: String(err) } });
      }
    }
  }

  return { text: finalText, toolCalls: toolCallLog, iterations };
}

// ── Public API ──

export async function runLiveToolLoop(params: LiveToolLoopParams): Promise<LiveToolLoopResult> {
  if (params.provider === 'anthropic') {
    return runAnthropicLoop(params);
  }
  return runOpenAiLoop(params);
}

/**
 * Fetch tool definitions from MCP server.
 */
export async function fetchLiveTools(): Promise<LiveToolDef[]> {
  const mcpHost = resolveMcpHost();
  if (!mcpHost) return [];
  try {
    const res = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/list`);
    if (!res.ok) return [];
    const json = await res.json() as { ok: boolean; tools: LiveToolDef[] };
    return json.ok ? json.tools : [];
  } catch {
    return [];
  }
}

/**
 * Build the live mode system prompt.
 */
export function buildLiveSystemPrompt(instrument?: {
  executorUrl?: string;
  visaResource?: string;
  backend?: string;
  modelFamily?: string;
  deviceDriver?: string;
}): string {
  const parts = [
    '# TekAutomate Live Mode',
    'You control a Tektronix oscilloscope. Execute commands silently. Report results briefly.',
    '',
    '## Tools',
    '- **send_scpi** — {commands:["CMD1","CMD2?"]} → [{command, response, ok, error}]',
    '- **capture_screenshot** — Capture display. ONLY call when you need to visually verify something or user asks to see the scope. Do NOT call after every command — send_scpi responses already tell you if commands succeeded.',
    '- **get_instrument_state** — *IDN?/*ESR?/ALLEV?',
    '- **smart_scpi_lookup** — Natural language SCPI search.',
    '- **search_scpi** — Keyword search.',
    '- **get_command_by_header** — Exact header lookup.',
    '- **retrieve_rag_chunks** — Knowledge base: corpus="errors"|"app_logic"|"pyvisa_tekhsi"|"tmdevices"',
    '',
    '## RULES',
    '1. JUST DO IT. Never explain how. Never suggest manual UI steps.',
    '2. Common commands — send_scpi IMMEDIATELY: *RST, *IDN?, AUTOSet EXECute, MEASUrement:ADDMEAS <type>, CH<x>:SCAle <NR3>',
    '3. Unknown commands — smart_scpi_lookup → send_scpi. Two calls max.',
    '4. Errors — read response, fix, retry. Never stop to ask.',
    '5. Be natural. Brief for actions, detailed only when asked to explain.',
    '6. Replace placeholders: <NR3>→number, CH<x>→CH1.',
    '7. capture_screenshot ONLY when you need to see the display (verify layout, analyze waveform, user asks). NOT after every send_scpi — the response tells you if it worked.',
  ];
  if (instrument) {
    parts.push('');
    parts.push('## Instrument');
    if (instrument.executorUrl) parts.push(`- Endpoint: ${instrument.executorUrl}`);
    if (instrument.visaResource) parts.push(`- VISA: ${instrument.visaResource}`);
    if (instrument.backend) parts.push(`- Backend: ${instrument.backend}`);
    if (instrument.modelFamily) parts.push(`- Model: ${instrument.modelFamily}`);
    if (instrument.deviceDriver) parts.push(`- Driver: ${instrument.deviceDriver}`);
  }
  return parts.join('\n');
}

/**
 * Build the AI chat mode system prompt.
 * Used when the user is in conversational AI mode (not live scope control).
 */
export function buildAiSystemPrompt(opts?: {
  modelFamily?: string;
  backend?: string;
  deviceDriver?: string;
}): string {
  const parts = [
    '# TekAutomate AI Assistant',
    'You are an expert Tektronix oscilloscope and test automation assistant.',
    'You help engineers design, debug, and optimize measurement workflows.',
    '',
    '## What you can do',
    '- Answer questions about oscilloscope measurements, SCPI commands, and test automation',
    '- Search the SCPI command database for exact command syntax (use smart_scpi_lookup)',
    '- Look up known issues and fixes (use search_known_failures)',
    '- Build TekAutomate flow steps when the user says "build it" or asks you to create a flow',
    '',
    '## Tools available',
    '- **smart_scpi_lookup** — Natural-language SCPI finder. Params: query',
    '- **search_scpi** — Keyword SCPI command search. Params: query',
    '- **get_command_by_header** — Exact command header lookup. Params: header',
    '- **retrieve_rag_chunks** — Search knowledge base. Params: corpus, query',
    '- **search_known_failures** — Look up known errors. Params: query',
    '- **verify_scpi_commands** — Validate SCPI strings. Params: commands[]',
    '',
    '## When the user says "build it" or asks to create a flow',
    'Output a valid ACTIONS_JSON payload at the end of your response. Example format:',
    'ACTIONS_JSON: {"summary": "Flow description", "actions": [{"action_type": "replace_flow", "payload": {"flow": {"steps": [...]}}}]}',
    '',
    '## Response style',
    '- Be concise and practical.',
    '- Use **bold** for emphasis and `code` formatting for SCPI commands.',
    '- When referencing SCPI commands, verify syntax with tools when uncertain.',
    '- Keep responses focused — avoid over-explaining obvious things.',
  ];
  if (opts?.modelFamily && opts.modelFamily !== 'unknown') {
    parts.push('');
    parts.push(`## Instrument context`);
    parts.push(`- Model family: ${opts.modelFamily}`);
    if (opts.backend) parts.push(`- Backend: ${opts.backend}`);
    if (opts.deviceDriver) parts.push(`- Device driver: ${opts.deviceDriver}`);
  }
  return parts.join('\n');
}
