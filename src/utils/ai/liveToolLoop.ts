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
 * Verify SCPI commands against the command index before sending to the instrument.
 * Bypasses verification for star commands (*IDN?, *RST, etc.) which are universal.
 */
async function verifyScpiCommands(
  commands: string[],
  flowContext?: LiveToolLoopParams['flowContext']
): Promise<{ verified: boolean; error?: string }> {
  const mcpHost = resolveMcpHost();
  if (!mcpHost) return { verified: true };

  const nonStarCommands = commands.filter(c => !String(c).trim().startsWith('*'));
  if (nonStarCommands.length === 0) return { verified: true };

  try {
    const res = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'verify_scpi_commands',
        args: { commands: nonStarCommands, modelFamily: flowContext?.modelFamily },
      }),
    });
    if (!res.ok) return { verified: true };

    const json = await res.json() as { ok: boolean; result?: { data?: Array<{ command: string; verified: boolean }> } };
    const results = json.result?.data;
    if (!Array.isArray(results)) return { verified: true };

    const failures = results.filter(r => !r.verified);
    if (failures.length === 0) return { verified: true };

    const failList = failures.map(f => `  - Unverified: ${f.command}`).join('\n');
    return {
      verified: false,
      error:
        `SCPI verify gate blocked ${failures.length} of ${nonStarCommands.length} command(s):\n${failList}\n` +
        'Use tek_router to find the correct command: {action:"search_exec", query:"search scpi commands", args:{query:"..."}}',
    };
  } catch {
    return { verified: true };
  }
}

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
    // ── Normalize commands array ──
    // OpenAI sometimes concatenates commands with semicolons into one string
    // (e.g. "*IDN?; CH1:SCAle?") instead of separate array items.
    // Split them so the executor handles each command individually.
    if (toolName === 'send_scpi' && Array.isArray(payload.commands)) {
      payload.commands = (payload.commands as string[]).flatMap(cmd =>
        String(cmd).includes(';') ? String(cmd).split(';').map(s => s.trim()).filter(Boolean) : [cmd]
      );
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

    // ── SCPI Verify Gate ──
    // Before sending ANY command via send_scpi, verify against the command index.
    // Bypass for discover_scpi (probing mode) and get_instrument_state (star commands).
    if (toolName === 'send_scpi' && action === 'send_scpi') {
      const cmds = Array.isArray(payload.commands) ? payload.commands as string[] : [];
      const verification = await verifyScpiCommands(cmds, flowContext);
      if (!verification.verified) {
        return { ok: false, error: 'VERIFY_GATE_BLOCKED', message: verification.error, commands: cmds };
      }
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

          // After send_scpi: remind AI to verify with screenshot
          const isSendScpi = toolName === 'send_scpi';
          const hasWriteCommand = isSendScpi && Array.isArray(toolArgs.commands) &&
            (toolArgs.commands as string[]).some(c => !String(c).trim().endsWith('?'));
          const verifyHint = hasWriteCommand
            ? '\n⚠️ You sent write commands. Call capture_screenshot(analyze:true) NOW to verify they applied. Do NOT claim success without checking.'
            : '';
          const truncated = resultStr.length > 3000 ? resultStr.slice(0, 3000) + '\n...(truncated)' : resultStr;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolId,
            content: truncated + verifyHint,
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

            // After send_scpi: remind AI to verify with screenshot
            const isSendScpi = toolName === 'send_scpi';
            const hasWriteCmd = isSendScpi && Array.isArray(toolArgs.commands) &&
              (toolArgs.commands as string[]).some(c => !String(c).trim().endsWith('?'));
            const verifyHint = hasWriteCmd
              ? '\n⚠️ You sent write commands. Call capture_screenshot(analyze:true) NOW to verify they applied. Do NOT claim success without checking.'
              : '';
            toolResultsInput.push({
              type: 'function_call_output',
              call_id: callId,
              output: isScreenshot ? 'Screenshot captured and displayed to user.' : truncated + verifyHint,
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
      ? 'You are a senior Tektronix engineer controlling a live oscilloscope. Execute commands silently. When reporting results or answering questions about the display, think like an engineer — interpret what the data means, not just what labels you see. Explain significance briefly (e.g. "mean near zero = good alignment, sigma 578mV = your error spread"). Never just list raw values like a parser.'
      : `You are a senior Tektronix test automation engineer. Help with SCPI commands, measurements, debugging, and setup strategy for ${modelFamily}.`,
    '',

    // ── MCP TOOLS (same for both modes) ──
    '## MCP Tools — USE THESE',
    'You have 4 tools. Use them — do NOT guess SCPI commands from memory.',
    '',
    '### Tool Decision Tree',
    '1. **Know the exact SCPI header?** → tek_router: "get command by header"',
    '   {action:"search_exec", query:"get command by header", args:{header:"PLOT:PLOT<x>:TYPe"}}',
    '2. **Need to find a command?** → tek_router: "search scpi commands"',
    '   {action:"search_exec", query:"search scpi commands", args:{query:"histogram plot"}}',
    '   Returns: best_match + alternatives. Use the best_match. If wrong, check alternatives.',
    '3. **Want to explore a group?** → tek_router: "browse scpi commands"',
    '   {action:"search_exec", query:"browse scpi commands", args:{group:"Horizontal"}}',
    '   Use this when search returns wrong results — browse the correct group directly.',
    '4. **Verify before sending** → tek_router: "verify scpi commands"',
    '   {action:"search_exec", query:"verify scpi commands", args:{commands:["CH1:SCAle 1.0"]}}',
    '5. **Build a workflow** → tek_router: build',
    '   {action:"build", query:"set up jitter measurement on CH1"}',
    '',
    '**send_scpi** — Send commands to live instrument: {commands:["CMD1","CMD2?"]}',
    '**capture_screenshot** — Capture scope display (analyze:true to see the image yourself)',
    '**discover_scpi** — LAST RESORT. Probes live instrument for undocumented commands. ONLY use after search+browse fail AND user confirms. Slow (dozens of probes).',
    '',
    '### SCPI Command Groups (use for browse/search context)',
    'Acquisition (15) — acquire modes, run/stop, sample/average',
    'Bus (339) — decode: CAN, I2C, SPI, UART, LIN, FlexRay, MIL-1553',
    'Callout (14) — annotations, bookmarks, labels on display',
    'Cursor (121) — cursor bars, readouts, delta measurements',
    'Digital (33) — digital/logic channels and probes',
    'Display (130) — graticule, intensity, waveview, stacked/overlay',
    'Histogram (28) — histogram analysis and display',
    'Horizontal (48) — timebase, record length, FastFrame, sample rate',
    'Mask (29) — mask/eye testing, pass/fail criteria',
    'Math (85) — FFT, waveform math, expressions, spectral analysis',
    'Measurement (367) — automated: freq, period, rise/fall, jitter, eye, pk2pk',
    'Miscellaneous (71) — autoset, preset, *IDN?, *RST, *OPC, common commands',
    'Plot (47) — trend plots, histogram plots, XY plots',
    'Power (268) — power analysis: harmonics, switching loss, efficiency, SOA',
    'Save and Recall (26) — save/recall setups, waveforms, screenshots',
    'Search and Mark (650) — search waveform records, mark events, bus decode results',
    'Spectrum view (52) — RF spectrum analysis, center freq, span, RBW',
    'Trigger (266) — edge, pulse, runt, logic, bus, holdoff, level, slope',
    'Waveform Transfer (41) — curve data, wfmoutpre, data source transfer',
    'Zoom (20) — magnify/expand waveform display',
    '',
    'Use these groups to guide your searches. Example: "FastFrame" → Horizontal group.',
    'If search gives wrong results, browse the correct group directly.',
    '',
    '## SAVED SHORTCUTS — CHECK BEFORE BUILDING FROM SCRATCH',
    'The router has saved shortcuts for common workflows (callouts, demos, etc.).',
    'Before building a multi-step SCPI sequence from scratch, search for an existing shortcut:',
    '  {action:"search", query:"add callout"} or {action:"search", query:"load demo"}',
    'If a shortcut exists, follow its steps — they contain learned best practices.',
    '',
    '## CRITICAL RULE — NEVER GUESS, ALWAYS LOOK UP',
    'Your SCPI memory is unreliable. ALWAYS use tek_router to look up:',
    '- The correct command header (don\'t guess from memory)',
    '- The valid parameter values (don\'t assume — the database lists exact valid values)',
    '- The correct syntax (set vs query, argument format)',
    'When setting a parameter and unsure of valid values, call:',
    '  {action:"search_exec", query:"get command by header", args:{header:"THE:COMMAND"}}',
    'The result includes valid values. USE THEM — don\'t pick a default from memory.',
    '',
    'BEFORE calling send_scpi, you MUST verify the command:',
    '1. tek_router verify: {action:"search_exec", query:"verify scpi commands", args:{commands:["YOUR COMMAND"]}}',
    '2. If verified=true → send it',
    '3. If verified=false → search for the correct command, do NOT send unverified commands',
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
      '1. JUST DO IT. Execute first, talk second.',
      '   - NEVER say "If you want, I can..." or "Would you like me to..." — JUST DO IT.',
      '   - NEVER explain what you are about to do. Do it, then report the result in 1-2 sentences.',
      '   - NEVER give a multi-paragraph analysis unless the user explicitly asks for analysis.',
      '   - When the user says "add cursors" → add cursors. When they say "yes" → do the thing. No essays.',
      '2. WHEN THE USER ASKS ABOUT SOMETHING ON SCREEN — capture_screenshot(analyze:true), then give a SHORT engineering read.',
      '   2-4 sentences max. Lead with the key insight. Do NOT list every label and value.',
      '   Good: "**TIE sigma dropped from 228ps to 58ps** — the big spur at ~100kHz is your main jitter source. Removing it cleans up the eye significantly."',
      '   Bad: 20 bullet points listing every measurement value the user can already see.',
      '3. DO NOT ASK questions you can answer yourself. Before asking the user anything:',
      '   - Use capture_screenshot(analyze:true) to see the current scope state',
      '   - Make the best judgment from what you see. Engineers expect you to act, not ask.',
      '   - Only ask when there is genuine ambiguity that the scope state cannot resolve.',
      '4. MINIMUM TOOL CALLS. Simple tasks = 1-2 calls. "check scope" = capture_screenshot. "add freq measurement" = send_scpi.',
      '5. Common commands — send_scpi IMMEDIATELY: *RST, *IDN?, AUTOSet EXECute, MEASUrement:ADDMEAS <type>, CH<x>:SCAle, HORizontal:SCAle, TRIGger:A:EDGE:SLOpe',
      '6. Unknown commands — tek_router search_exec → send_scpi. Two calls max.',
      '7. Errors — read response, fix, retry. Briefly say what failed.',
      '8. VERIFY YOUR WORK — never trust SCPI responses alone.',
      '   After ANY command that should change the display (add measurement, add math, change scale,',
      '   change trigger, etc.), ALWAYS capture_screenshot(analyze:true) and confirm it actually applied.',
      '   If the screenshot shows no change, tell the user it did not apply — do NOT claim success.',
      '   The scope can return "OK" but the command may not have taken effect (especially offline/TekScope PC).',
      '9. NEVER use discover_scpi unless search AND browse both failed AND the user confirms.',
      '   discover_scpi sends dozens of probes to the live instrument — it is slow and can timeout.',
      '   For normal commands (measurements, triggers, display, etc.) ALWAYS use tek_router search first.',
      '10. Before adding measurements: MEASUrement:LIST? to check what exists.',
      '11. TIMEOUTS: Try *IDN? first. Do NOT retry same command repeatedly.',
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
    '1. Check the alternatives in the search result — the correct command may be there',
    '2. Browse the correct group directly: {action:"search_exec", query:"browse scpi commands", args:{group:"Trigger"}}',
    '   Refer to the SCPI Command Groups list above to pick the right group.',
    '3. Use SCPI terms not natural language: "PLOT TYPe HISTOGRAM" not "histogram chart"',
    '4. ONLY if all above fail: ask user "Should I probe the live instrument with discover_scpi?"',
    '5. Parse user-pasted manual text directly',
    '6. NEVER loop on same failed search — try a different approach after 1 attempt',
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
