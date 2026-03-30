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
      payload.timeout_ms = hasSlowCommand ? 15000 : 3000;
    }

    // Script timeout: 15s for screenshot/slow ops, 8s for simple SCPI
    const isSlowAction = toolName === 'capture_screenshot' || toolName === 'discover_scpi'
      || (toolName === 'send_scpi' && payload.timeout_ms && Number(payload.timeout_ms) > 10000);
    const scriptTimeout = isSlowAction ? 15 : 8;

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
    ...history.slice(-6).map((h) => ({
      role: h.role,
      content: String(h.content || '').slice(0, 2000),
    })),
    { role: 'user', content: userMessage },
  ];
  // Track how many messages existed before the tool loop started, so we can
  // apply a sliding window that only keeps recent tool round-trips.
  const baseMessageCount = messages.length;

  const toolCallLog: LiveToolLoopResult['toolCalls'] = [];
  let finalText = '';
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    // ── Sliding window: keep base messages + last 4 tool-loop messages ──
    // Each tool iteration appends 2 messages (assistant + user/tool_result).
    // After 2+ iterations the earlier round-trips are stale; prune them to
    // avoid sending the full history on every request.
    const maxToolMessages = 4; // 2 iterations × 2 messages each
    if (messages.length > baseMessageCount + maxToolMessages) {
      messages.splice(baseMessageCount, messages.length - baseMessageCount - maxToolMessages);
    }
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
              { type: 'text', text: 'Screenshot captured. Only mention what CHANGED or is relevant to the user\'s last request. Do NOT re-describe the entire display.' },
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

    // ── Prune base64 images from earlier messages to avoid re-sending them ──
    // The AI has already seen the image on this iteration; replace with a
    // lightweight text placeholder so subsequent iterations don't pay the cost.
    for (const msg of messages) {
      const arr = Array.isArray(msg.content) ? msg.content as Array<Record<string, unknown>> : null;
      if (!arr) continue;
      for (let j = 0; j < arr.length; j++) {
        const item = arr[j];
        if (item.type === 'tool_result' && Array.isArray(item.content)) {
          const inner = item.content as Array<Record<string, unknown>>;
          const hasImage = inner.some((c) => c.type === 'image');
          if (hasImage) {
            item.content = '[Screenshot was captured and already analyzed]';
          }
        }
      }
    }
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
    ...history.slice(-6).map((h) => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: String(h.content || '').slice(0, 2000),
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
                { type: 'input_text', text: 'Only mention what CHANGED or is relevant to the user\'s last request. Do NOT re-describe the entire display.' },
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
  'get_visa_resources',
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

  const parts = [
    `# TekAutomate ${isLive ? 'Live Mode' : 'AI Chat'}`,
    isLive
      ? 'You control a Tektronix oscilloscope. Execute commands silently. Report results briefly. Think like an engineer — interpret what the data means, not just what labels you see.'
      : `You are a senior Tektronix test automation engineer. Help with SCPI commands, measurements, debugging, and setup strategy for ${modelFamily}.`,
    '',

    // ── TOOLS ──
    '## Tools',
    '- **tek_router** — Gateway to 21,000+ SCPI commands. action:"search_exec" with query + args. Also: "search", "exec", "build", "create", "list".',
    '- **send_scpi** — {commands:["CMD1","CMD2?"]} → [{command, response, ok, error}]. Each command is a SEPARATE string — no semicolons.',
    '- **capture_screenshot** — Capture scope display. Default: updates user UI only (no image returned to you). Pass analyze:true ONLY when you need to see the image yourself.',
    '- **get_visa_resources** — List connected instruments (VISA resource, model, serial).',
    '- **discover_scpi** — LAST RESORT. Probes live instrument. Slow. Only after search+browse fail AND user confirms.',
    '',
    '## SCPI Rules',
    '- Your SCPI memory is unreliable. ALWAYS use tek_router to look up commands and valid values before sending.',
    '- Verify commands via tek_router before send_scpi: {action:"search_exec", query:"verify scpi commands", args:{commands:[...]}}',
    '- Canonical mnemonics only: CH1, B1, MATH1, MEAS1 — never CHAN1, CHANNEL1.',
    '- No colon before star commands: `*RST` not `:*RST`. Placeholders: <NR3>=number, CH<x>=channel.',
    '- Check saved shortcuts before building from scratch: {action:"search", query:"add callout"}',
    '',
    '## Chain Calls — Dig Deeper',
    'tek_router search results are ranked guesses. You MUST dig deeper when needed:',
    '- Unsure of valid values? → look up the header: {query:"get command by header", args:{header:"THE:COMMAND"}}',
    '- Search returned wrong group? → browse directly: {query:"browse scpi commands", args:{group:"Trigger"}}',
    '- Need to set a parameter? → look up valid values first, THEN send.',
    '',
    '## SCPI Command Groups (for browse/search context)',
    'Acquisition(15), Bus(339), Callout(14), Cursor(121), Digital(33), Display(130),',
    'Histogram(28), Horizontal(48), Mask(29), Math(85), Measurement(367), Miscellaneous(71),',
    'Plot(47), Power(268), Save/Recall(26), Search/Mark(650), Spectrum(52),',
    'Trigger(266), Waveform Transfer(41), Zoom(20)',
    'Use these to guide searches. Example: "FastFrame" → Horizontal. If search gives wrong results, browse the correct group.',
    '',
    '## When Search Fails',
    '1. Check alternatives in the search result 2. Browse the correct group directly',
    '3. Use SCPI terms not natural language 4. Last resort: discover_scpi',
    '',
  ];

  // ── LIVE MODE RULES ──
  if (isLive) {
    parts.push(
      '## RULES',
      '1. JUST DO IT. Never explain how. Never suggest manual UI steps. Never list options.',
      '2. Common commands — send_scpi IMMEDIATELY, zero searching:',
      '   *RST, *IDN?, *CLS, *OPC?, AUTOSet EXECute, MEASUrement:ADDMEAS <type>,',
      '   CH<x>:SCAle <NR3>, HORizontal:SCAle <NR3>, TRIGger:A:EDGE:SLOpe RISe',
      '3. Unknown commands — tek_router search → send_scpi. Two calls max.',
      '4. Errors — read response, fix, retry differently. Never stop to ask.',
      '5. Be natural and conversational. Brief for simple tasks, detailed when user asks to explain/analyze.',
      '6. Only mention what CHANGED since last message. NEVER re-describe the full display.',
      '   NEVER repeat channel setup, trigger, decode info, timebase, or measurements the user already saw.',
      '   Treat the conversation as continuous — the user remembers.',
      '7. capture_screenshot — ALWAYS capture after visual changes:',
      '   - After ADDMEAS, results table, loading a session',
      '   - After changing scale, offset, trigger, timebase, or any visual setting',
      '   - After send_scpi errors',
      '   Default: just call capture_screenshot (no analyze) — updates user screen, saves tokens.',
      '   Pass analyze:true ONLY when you need to read/diagnose the display.',
      '8. AUTONOMOUS EXPLORATION: When user gives a goal — YOU figure it out. Search, try commands,',
      '   read errors, try different approaches. Keep going until you achieve the goal.',
      '9. READING EXISTING DATA: Before adding new measurements, check what exists:',
      '   - MEASUrement:LIST? to see existing measurements',
      '   - capture_screenshot with analyze:true to READ values visible on screen',
      '   - Do NOT blindly add measurements when the user asks to "read" or "get" values — read EXISTING data back',
      '10. TIMEOUTS: If a command times out, try a simpler query (*IDN?) to check connectivity first.',
      '    Do NOT retry the same command repeatedly.',
      '11. Verification: after write commands, capture_screenshot to confirm change appeared.',
      '    If change visible → one-line confirmation. If not → "Didn\'t work" and try differently.',
      '    Do NOT describe the entire display. Only confirm the specific change.',
      '    NEVER trust SCPI "OK" alone — scope can silently reject.',
      '12. NEVER NARRATE INTENT. Never say "I\'ll do X now" or "Let me check Y" then stop.',
      '    If you decide to do something, DO IT in the same response. Tool calls + brief result. No planning monologues.',
      '13. FIX, DON\'T JUST DIAGNOSE. When you find a problem (wrong bandwidth, bad setting, missing config),',
      '    FIX IT IMMEDIATELY — send the corrective command, then confirm. Don\'t explain the problem and wait.',
      '    The user wants you to act like a colleague who fixes things, not a consultant who writes reports.',
      '14. NEVER retry same failed command. NEVER cover failure with long analysis.',
      '    If user says "try again" → try something DIFFERENT.',
      '',
    );
  }

  // ── CHAT MODE RULES ──
  if (!isLive) {
    parts.push(
      '## Chat Rules',
      '- Keep responses focused — answer what was asked, not everything related.',
      '- Show the key command(s) with syntax, a brief explanation, and one practical example.',
      '- Engineer to engineer — assume they know oscilloscopes, explain SCPI specifics.',
      '- Use `code` for commands, **bold** for emphasis.',
      '- End with a clear next step: "Want me to build this?" or "Which approach?"',
      '- For build requests: short outline of what the flow does + "say **build it**".',
      '',
      '## Build Output (when user says "build it")',
      '- Return ACTIONS_JSON with verified steps.',
      '- If existing flow: use insert_step_after with a group. If empty: replace_flow.',
      `- ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[{"type":"insert_step_after","targetStepId":null,"newStep":{"type":"group","label":"...","children":[...]}}]}`,
      '',
      '## Step Types & Schemas',
      'connect, disconnect, write, query, sleep, error_check, comment, python, save_waveform, save_screenshot, recall, group, tm_device_command',
      'write: {"type":"write","label":"...","params":{"command":"..."}}',
      'query: {"type":"query","label":"...","params":{"command":"...?","saveAs":"result_name"}}',
      'group: {"type":"group","label":"...","params":{},"collapsed":false,"children":[...]}',
      '',
    );
  }

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
