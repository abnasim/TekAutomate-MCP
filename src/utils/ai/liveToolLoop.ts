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
      payload = { commands: ['*IDN?', '*ESR?', 'ALLEV?'], timeout_ms: 5000 };
    }
    // Default per-command timeout for live mode: 5s for simple commands.
    // Slow commands (acquisition, transfer, save, reset) get 30s.
    if (toolName === 'send_scpi' && !payload.timeout_ms) {
      const cmds = Array.isArray(payload.commands) ? payload.commands as string[] : [];
      const hasSlowCommand = cmds.some(c => {
        const upper = String(c).toUpperCase();
        return upper.includes('*OPC') || upper.includes('*RST') || upper.includes('*WAI')
          || upper.includes('CURVE') || upper.includes('WFMOUTPRE')
          || upper.startsWith('SAVE:') || upper.startsWith('RECALL:') || upper.startsWith('RECAL:')
          || upper.includes('ACQUIRE:STATE') || upper.includes('ACQU:STATE')
          || upper.includes('AUTOSET') || upper.includes('AUTOSCALE');
      });
      payload.timeout_ms = hasSlowCommand ? 30000 : 5000;
    }

    // Script timeout: 30s for screenshot/slow ops, 15s for simple SCPI
    const isSlowAction = toolName === 'capture_screenshot' || toolName === 'discover_scpi'
      || (toolName === 'send_scpi' && payload.timeout_ms && Number(payload.timeout_ms) > 10000);
    const scriptTimeout = isSlowAction ? 30 : 15;

    const res = await fetch(`${execUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action,
        timeout_sec: scriptTimeout,
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

// ── OpenAI Responses API Loop ──

async function runOpenAiLoop(params: LiveToolLoopParams): Promise<LiveToolLoopResult> {
  const {
    apiKey, model, systemPrompt, userMessage, history = [],
    tools, instrumentEndpoint, flowContext,
    maxIterations = 8, onChunk, onToolCall, onToolResult,
  } = params;

  const openAiTools = tools.map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  // Build initial input with history + current message
  const initialInput: Array<Record<string, unknown>> = [
    ...history.slice(-12).map((h) => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: String(h.content || '').slice(0, 3000),
    })),
    { role: 'user', content: userMessage },
  ];

  const toolCallLog: LiveToolLoopResult['toolCalls'] = [];
  let finalText = '';
  let iterations = 0;
  let previousResponseId: string | undefined;
  let currentInput: Array<Record<string, unknown>> = initialInput;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;

    const requestBody: Record<string, unknown> = {
      model,
      instructions: systemPrompt,
      tools: openAiTools,
      max_output_tokens: 4096,
    };

    if (previousResponseId) {
      // Follow-up: use previous_response_id for conversation continuity
      requestBody.previous_response_id = previousResponseId;
      requestBody.input = currentInput;
    } else {
      // First call: send full input
      requestBody.input = currentInput;
    }

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { text: finalText, toolCalls: toolCallLog, iterations, error: `OpenAI ${res.status}: ${errText}` };
    }

    const json = await res.json() as {
      id: string;
      output: Array<Record<string, unknown>>;
      status: string;
    };

    previousResponseId = json.id;
    const output = Array.isArray(json.output) ? json.output : [];
    let hasToolCalls = false;
    const toolResultsInput: Array<Record<string, unknown>> = [];

    for (const item of output) {
      // Extract text from message items
      if (item.type === 'message') {
        const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
        for (const c of content) {
          if (c.type === 'output_text' && typeof c.text === 'string') {
            finalText = c.text;
            onChunk?.(c.text);
          }
        }
      }

      // Handle tool calls
      if (item.type === 'function_call') {
        hasToolCalls = true;
        const toolName = String(item.name || '');
        const callId = String(item.call_id || '');
        let toolArgs: Record<string, unknown> = {};
        try {
          toolArgs = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : {};
        } catch { /* ignore */ }

        onToolCall?.(toolName, toolArgs);

        try {
          const result = await executeMcpTool(toolName, toolArgs, instrumentEndpoint, flowContext);
          onToolResult?.(toolName, result);
          toolCallLog.push({ tool: toolName, args: toolArgs, result });

          const resultObj = result && typeof result === 'object' ? result as Record<string, unknown> : null;
          const isScreenshot = resultObj && typeof resultObj.base64 === 'string';

          if (isScreenshot && toolArgs.analyze === true) {
            // Send screenshot for AI analysis
            toolResultsInput.push({
              type: 'function_call_output',
              call_id: callId,
              output: 'Screenshot captured. Analyze the image below.',
            });
            toolResultsInput.push({
              role: 'user',
              content: [
                {
                  type: 'input_image',
                  image_url: `data:${(resultObj.mimeType as string) || 'image/png'};base64,${resultObj.base64}`,
                },
                { type: 'input_text', text: 'Describe what you see on the scope display.' },
              ],
            });
          } else {
            // Strip verbose fields, truncate
            let lean = result;
            if (typeof result === 'object' && result !== null) {
              const r = result as Record<string, unknown>;
              const { rawStdout, rawStderr, combinedOutput, transcript, outputMode, durationSec, ...rest } = r;
              lean = rest;
            }
            const resultStr = typeof lean === 'string' ? lean : JSON.stringify(lean);
            const truncated = resultStr.length > 3000 ? resultStr.slice(0, 3000) + '\n...(truncated)' : resultStr;
            toolResultsInput.push({
              type: 'function_call_output',
              call_id: callId,
              output: isScreenshot ? 'Screenshot captured and displayed to user.' : truncated,
            });
          }
        } catch (err) {
          toolResultsInput.push({
            type: 'function_call_output',
            call_id: callId,
            output: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
          toolCallLog.push({ tool: toolName, args: toolArgs, result: { error: String(err) } });
        }
      }
    }

    if (!hasToolCalls) break;

    // Feed tool results back for next iteration
    currentInput = toolResultsInput;
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
// smart_scpi_lookup stays internal (MCP-only deterministic planner).
// Everything else is routed internally via tek_router.
const MCP_SLIM_TOOLS = new Set([
  'tek_router',
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
/**
 * Unified system prompt for browser-direct AI calls (both AI Chat and Live mode).
 * One prompt, one source of truth.
 */
export function buildLiveSystemPrompt(instrument?: {
  executorUrl?: string;
  visaResource?: string;
  backend?: string;
  modelFamily?: string;
  deviceDriver?: string;
}, options?: { mode?: 'live' | 'chat' }): string {
  const mode = options?.mode || 'live';
  const isLive = mode === 'live';
  const modelFamily = instrument?.modelFamily || 'scope';
  const backend = instrument?.backend || 'pyvisa';

  const parts = [
    `# TekAutomate ${isLive ? 'Live Mode' : 'AI Chat'}`,
    isLive
      ? 'You control a Tektronix oscilloscope. Execute commands silently. Report results briefly.'
      : `You are a senior Tektronix test automation engineer. Help with SCPI commands, measurements, debugging, and setup strategy for ${modelFamily}.`,
    '',

    // ── MCP TOOLS (same for both modes) ──
    '## MCP Tools — USE THESE',
    'You have 4 tools. Use them — do NOT guess SCPI commands from memory.',
    '',
    '**tek_router** — PRIMARY tool. Gateway to 21,000+ SCPI commands.',
    '  Search: {action:"search_exec", query:"search scpi commands", args:{query:"histogram plot"}}',
    '  Exact:  {action:"search_exec", query:"get command by header", args:{header:"PLOT:PLOT<x>:TYPe"}}',
    '  Browse: {action:"search_exec", query:"browse scpi commands", args:{group:"Measurement"}}',
    '  Verify: {action:"search_exec", query:"verify scpi commands", args:{commands:["CH1:SCAle 1.0"]}}',
    '  Build:  {action:"build", query:"set up jitter measurement on CH1"}',
    '  RAG:    {action:"search_exec", query:"retrieve rag chunks", args:{corpus:"app_logic", query:"..."}}',
    '',
    '**send_scpi** — Send commands to live instrument: {commands:["CMD1","CMD2?"]}',
    '**capture_screenshot** — Capture scope display (analyze:true to see the image yourself)',
    '**discover_scpi** — Probe live instrument for undocumented commands: {basePath:"TRIGger:A", liveMode:true}',
    '',
    'TOOL PRIORITY: tek_router FIRST for any SCPI question. NEVER guess commands from memory.',
    '',

    // ── COMMAND LANGUAGE ──
    '## Command Language',
    '- Canonical mnemonics: CH<x> (CH1), B<x> (B1), MATH<x> (MATH1), MEAS<x> (MEAS1), SEARCH<x> (SEARCH1).',
    '- Never invent aliases like CHAN1, CHANNEL1, BUS1.',
    '- SCPI: colon-separated headers, space before args, no colon before star commands (*OPC?).',
    '- Placeholders: <NR3>=number, CH<x>=channel, {A|B}=pick one, <Qstring>=quoted string.',
    '',
  ];

  // ── LIVE MODE RULES ──
  if (isLive) {
    parts.push(
      '## Live Rules',
      '1. JUST DO IT. Never explain how. Never suggest manual UI steps.',
      '2. MINIMUM TOOL CALLS. Simple tasks = 1-2 calls. "check scope" = capture_screenshot. "add freq measurement" = send_scpi.',
      '3. Common commands — send_scpi IMMEDIATELY: *RST, *IDN?, AUTOSet EXECute, MEASUrement:ADDMEAS <type>, CH<x>:SCAle, HORizontal:SCAle, TRIGger:A:EDGE:SLOpe',
      '4. Unknown commands — tek_router search_exec → send_scpi. Two calls max.',
      '5. Errors — read response, fix, retry. Briefly say what failed.',
      '6. capture_screenshot — ALWAYS after: ADDMEAS, scale/trigger/timebase changes, errors.',
      '   Default: no analyze. Pass analyze:true ONLY to read/diagnose the display.',
      '7. AUTONOMOUS EXPLORATION: For open-ended goals ("find a way to..."), search → try → read errors → adjust. Keep going.',
      '8. Before adding measurements: MEASUrement:LIST? to check what exists.',
      '9. TIMEOUTS: Try *IDN? first. Do NOT retry same command repeatedly.',
      '',
    );
  }

  // ── CHAT MODE RULES ──
  if (!isLive) {
    parts.push(
      '## Chat Rules',
      '- Keep responses focused — answer what was asked, not everything related.',
      '- Show the key command(s) with syntax, a brief explanation of what each does, and one practical example.',
      '- NEVER dump raw tool results. Summarize and present only what the user needs.',
      '- If there are multiple approaches, mention them in one line each — let user pick.',
      '- Do NOT add large tables unless the user asks for a comparison.',
      '- Do NOT repeat warnings, caveats, or rules the user already knows.',
      '- Engineer to engineer — assume they know oscilloscopes, explain SCPI specifics.',
      '- Use `code` for commands, **bold** for emphasis.',
      '- End with a clear next step: "Want me to build this?" or "Which approach?"',
      '- For build requests: short outline of what the flow does + "say **build it**".',
      '- For diagnostic questions: ask 1-2 narrowing questions to guide the right path.',
      '',
      '## Build Output (when user says "build it")',
      '- Return ACTIONS_JSON with verified steps.',
      '- If existing flow: use insert_step_after with a group. Do NOT replace_flow.',
      '- If empty flow: use replace_flow.',
      `- ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[{"type":"insert_step_after","targetStepId":null,"newStep":{"type":"group","label":"...","children":[...]}}]}`,
      '',
      '## Valid Step Types',
      'connect, disconnect, write, query, sleep, error_check, comment, python, save_waveform, save_screenshot, recall, group, tm_device_command',
      '',
      '## Step Schemas',
      'write: {"type":"write","label":"...","params":{"command":"..."}}',
      'query: {"type":"query","label":"...","params":{"command":"...?","saveAs":"result_name"}}',
      'group: {"type":"group","label":"...","params":{},"collapsed":false,"children":[...]}',
      '',
    );
  }

  // ── SEARCH FAILURE RECOVERY ──
  parts.push(
    '## When Search Fails',
    '1. Browse by group: {action:"search_exec", query:"browse scpi commands", args:{group:"Display"}}',
    '2. Use SCPI terms not natural language: "PLOT TYPe HISTOGRAM" not "histogram chart"',
    '3. discover_scpi to probe live instrument',
    '4. Parse user-pasted manual text directly',
    '5. NEVER loop on same failed search',
    '',
  );

  // ── INSTRUMENT CONTEXT ──
  if (instrument) {
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
 * Delegates to the unified buildLiveSystemPrompt with mode:'chat'.
 */
export function buildAiSystemPrompt(opts?: {
  modelFamily?: string;
  backend?: string;
  deviceDriver?: string;
}): string {
  return buildLiveSystemPrompt(
    { modelFamily: opts?.modelFamily, backend: opts?.backend, deviceDriver: opts?.deviceDriver },
    { mode: 'chat' },
  );
}
