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
        max_tokens: 2048,
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
        // Check both top-level (executor direct) and nested in data (MCP tool result)
        const topLevel = resultObj && typeof resultObj.base64 === 'string' ? resultObj : null;
        const nested = resultObj?.data && typeof resultObj.data === 'object'
          ? (resultObj.data as Record<string, unknown>)
          : null;
        const imageData = topLevel || (nested && typeof nested.base64 === 'string' ? nested : null);
        const hasImage = imageData && typeof imageData.base64 === 'string' && typeof imageData.mimeType === 'string';

        if (hasImage) {
          // Always send the image to Claude so it can see and analyze the scope display
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
              { type: 'text', text: 'Screenshot captured. Describe what you see on the scope.' },
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
        max_completion_tokens: 2048,
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
        // Screenshots: send image to AI so it can see the scope display
        const resultObj = result && typeof result === 'object' ? result as Record<string, unknown> : null;
        const isScreenshot = resultObj && typeof resultObj.base64 === 'string';
        if (isScreenshot) {
          const wantsAnalysis = toolArgs.analyze === true;
          if (wantsAnalysis) {
            const base64 = resultObj.base64 as string;
            const mimeType = (resultObj.mimeType as string) || 'image/png';
            messages.push({ role: 'tool', tool_call_id: toolId, content: 'Screenshot captured. See image below.' });
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: 'Here is the current scope display. Describe what you see briefly.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              ],
            });
          } else {
            messages.push({ role: 'tool', tool_call_id: toolId, content: 'Screenshot captured and displayed to user.' });
          }
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
// Slim MCP surface — only these tools are exposed to the AI provider.
// Everything else is routed internally via tek_router.
const MCP_SLIM_TOOLS = new Set([
  'tek_router',
  'smart_scpi_lookup',
  'send_scpi',
  'capture_screenshot',
  'discover_scpi',
]);

export async function fetchLiveTools(): Promise<LiveToolDef[]> {
  const mcpHost = resolveMcpHost();
  if (!mcpHost) return [];
  try {
    const res = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/list`);
    if (!res.ok) return [];
    const json = await res.json() as { ok: boolean; tools: LiveToolDef[] };
    if (!json.ok) return [];
    // Filter to slim surface — tek_router handles everything else internally
    return json.tools.filter(t => MCP_SLIM_TOOLS.has(t.name));
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
    '- **tek_router** — Gateway to 21,000+ internal tools. Use action:"search_exec" for SCPI lookup, verify, build, RAG, templates.',
    '  Fuzzy search: {action:"search_exec", query:"search scpi commands", args:{query:"your description"}}',
    '  Exact lookup: {action:"search_exec", query:"get command by header", args:{header:"EXACT:HEADER"}}',
    '  Verify: {action:"search_exec", query:"verify scpi commands", args:{commands:["CMD1"]}}',
    '  RAG: {action:"search_exec", query:"retrieve rag chunks", args:{corpus:"app_logic", query:"..."}}',
    '  Browse group: {action:"search_exec", query:"browse scpi commands", args:{group:"Trigger"}}',
    '- **smart_scpi_lookup** — Natural language SCPI search. Quick single-call shortcut.',
    '- **send_scpi** — {commands:["CMD1","CMD2?"]} → [{command, response, ok, error}]',
    '- **capture_screenshot** — Capture scope display as image. You WILL receive the image and can see it.',
    '- **discover_scpi** — Probe live instrument for undocumented commands: {basePath:"TRIGger:A:LEVel", liveMode:true}',
    '',
    '## RULES',
    '1. JUST DO IT. Never explain how. Never suggest manual UI steps.',
    '2. MINIMUM TOOL CALLS. Simple tasks = 1-2 calls max. "check scope" = just capture_screenshot. "add freq measurement" = just send_scpi. Do NOT search for commands you already know.',
    '3. Common commands — send_scpi IMMEDIATELY: *RST, *IDN?, AUTOSet EXECute, MEASUrement:ADDMEAS <type>, MEASUrement:DELete, CH<x>:SCAle, HORizontal:SCAle, TRIGger:A:EDGE:SLOpe, MEASUrement:STATIstics:CYCLEMode',
    '4. Unknown commands — smart_scpi_lookup → send_scpi. Two calls max.',
    '5. Errors — read response, fix, retry. Briefly say what failed before trying next.',
    '6. Be natural. Brief for actions, detailed only when asked to explain.',
    '7. Replace placeholders: <NR3>→number, CH<x>→CH1.',
    '8. capture_screenshot — ALWAYS capture after these (updates user UI):',
    '   - After adding a measurement (ADDMEAS), results table, or loading a session',
    '   - After changing scale, offset, trigger, timebase, or any visual setting',
    '   - After send_scpi errors',
    '   Default: just call capture_screenshot (no analyze). Image updates on user screen but is NOT sent back to you — saves tokens.',
    '   Pass analyze:true ONLY when you need to read/diagnose the display (errors, verifying measurement values, user asks to look).',
    '9. AUTONOMOUS EXPLORATION: Only when user gives an open-ended goal ("find a way to...", "figure out..."). Search, try, read errors, adjust. Keep going until achieved.',
    '10. READING EXISTING DATA: Before adding new measurements, check what exists:',
    '   - MEASUrement:LIST? to see existing measurements',
    '   - capture_screenshot with analyze:true to READ on-screen badges/tables/phasor values',
    '   - IMDA/Power Quality badges show VMAG, IMAG, TrPwr, etc. — read from screenshot, do NOT add redundant measurements',
    '   - Standard results: MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN?',
    '11. TIMEOUTS: If command times out, try *IDN? first to check connectivity. Do NOT retry same command repeatedly.',
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
