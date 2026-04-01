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
    backend?: string;
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

export const EXECUTOR_TOOLS = new Set([
  'send_scpi', 'capture_screenshot', 'get_instrument_state',
  'probe_command', 'get_visa_resources', 'get_environment',
]);

function splitScpiCommandString(command: string): string[] {
  const text = String(command || '');
  if (!text.includes(';')) return [text];

  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ';' && !inQuotes) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts.length ? parts : [text];
}

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
export async function executeMcpTool(
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
        splitScpiCommandString(String(cmd))
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

    // Script timeout: screenshots can take significantly longer than plain SCPI.
    const isScreenshotAction = toolName === 'capture_screenshot';
    const isSlowAction = isScreenshotAction || toolName === 'discover_scpi'
      || (toolName === 'send_scpi' && payload.timeout_ms && Number(payload.timeout_ms) > 10000);
    const scriptTimeout = isScreenshotAction ? 75 : (isSlowAction ? 20 : 8);

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

export async function prepareFlowActionsViaMcp(params: {
  summary?: string;
  findings?: string[];
  suggestedFixes?: string[];
  actions: Record<string, unknown>[];
  currentWorkflow?: Array<Record<string, unknown>>;
  selectedStepId?: string | null;
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    deviceDriver?: string;
  };
}): Promise<{
  ok: boolean;
  summary: string;
  actions: Record<string, unknown>[];
  warnings: string[];
  errors: string[];
  applyMode?: string;
}> {
  const result = await executeMcpTool(
    'prepare_flow_actions',
    {
      summary: params.summary || '',
      findings: params.findings || [],
      suggestedFixes: params.suggestedFixes || [],
      actions: params.actions,
      currentWorkflow: params.currentWorkflow || [],
      selectedStepId: params.selectedStepId || null,
      backend: params.flowContext?.backend,
      modelFamily: params.flowContext?.modelFamily,
    },
    undefined,
    params.flowContext
  );

  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const data = record.data && typeof record.data === 'object'
    ? (record.data as Record<string, unknown>)
    : record;

  return {
    ok: data.ok !== false,
    summary: String(data.summary || params.summary || ''),
    actions: Array.isArray(data.actions) ? (data.actions as Record<string, unknown>[]) : [],
    warnings: Array.isArray(data.warnings) ? data.warnings.map((item) => String(item)) : [],
    errors: Array.isArray(data.errors) ? data.errors.map((item) => String(item)) : [],
    applyMode: typeof data.applyMode === 'string' ? data.applyMode : undefined,
  };
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
    const maxToolMessages = 12; // 6 iterations × 2 messages each
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

    let prevToolNameOai = '';
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

        // Let the scope settle between SCPI commands and screenshot capture.
        if (toolName === 'capture_screenshot' && prevToolNameOai === 'send_scpi') {
          await new Promise(r => setTimeout(r, 1500));
        }

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
        prevToolNameOai = toolName;
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
  'stage_workflow_proposal',
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
  const backend = instrument?.backend || 'pyvisa';

  const parts = [
    `# TekAutomate ${isLive ? 'Live Mode' : 'AI Chat'}`,
    isLive
      ? 'You are a senior Tektronix engineer controlling a live oscilloscope. Execute commands silently. When reporting results or answering questions about the display, think like an engineer — interpret what the data means, not just what labels you see. Explain significance briefly (e.g. "mean near zero = good alignment, sigma 578mV = your error spread"). Never just list raw values like a parser.'
      : `You are a senior Tektronix test automation engineer. Your goal is to help the user refine one workflow into something reliable, readable, and executable for ${modelFamily}. Prefer the smallest correct workflow change over broad rewrites.`,
    '',

    // ── MCP TOOLS (same for both modes) ──
    '## MCP Tools — USE THESE',
    'Use these tools deliberately — do NOT guess SCPI commands from memory, and do NOT waste calls on long search chains when one smart workflow tool can do the job.',
    '',
    '### Tool Decision Tree',
    '0. **Need to build, edit, or fix a workflow?** -> inspect current workflow only if needed, look up exact commands only as needed, then build the actions yourself.',
    '0b. **Need to diagnose a failed run or read execution logs?** -> get_run_log and reason from the evidence yourself.',
    '0c. **Have a workflow proposal ready for TekAutomate UI?** -> stage_workflow_proposal',
    '   Send your exact summary/findings/suggestedFixes/actions.',
    '   Never call stage_workflow_proposal with an empty actions array.',
    '1. **Know the exact SCPI header?** → tek_router: "get command by header"',
    '   {action:"search_exec", query:"get command by header", args:{header:"PLOT:PLOT<x>:TYPe"}}',
    '2. **Need to find a command?** → tek_router: "search scpi commands"',
    '   {action:"search_exec", query:"search scpi commands", args:{query:"histogram plot"}}',
    '   Returns: best_match + alternatives. If best_match looks wrong, check alternatives or browse the group.',
    '3. **Want to explore a group?** → tek_router: "browse scpi commands"',
    '   {action:"search_exec", query:"browse scpi commands", args:{group:"Horizontal"}}',
    '   Use this when search returns wrong results — browse the correct group directly.',
    '4. **Verify before sending** → tek_router: "verify scpi commands"',
    '   {action:"search_exec", query:"verify scpi commands", args:{commands:["CH1:SCAle 1.0"]}}',
    '5. **What instruments are connected?** → get_visa_resources',
    '',
    '### IMPORTANT: Chain calls — don\'t stop at one',
    'tek_router is NOT a database with exact records. Search results are ranked guesses.',
    'You MUST dig deeper when needed:',
    '  - Search returned something unfamiliar? → look it up: "get command by header" to see full syntax + valid values',
    '  - Not sure about valid values? → look up the command header, the result includes exact valid values',
    '  - Search returned wrong group? → browse the correct group: "browse scpi commands" with the right group name',
    '  - Need to set a parameter? → look up the command first to see valid values, THEN send',
    'Example chain for "add arrow callout":',
    '  1. Search: {query:"search scpi commands", args:{query:"callout type"}} → finds CALLOUTS:CALLOUT<x>:TYPe',
    '  2. Lookup: {query:"get command by header", args:{header:"CALLOUTS:CALLOUT<x>:TYPe"}} → sees valid values: NOTE|ARROW|RECTANGLE|BOOKMARK',
    '  3. Send: send_scpi({commands:["CALLOUTS:CALLOUT1:TYPe ARROW"]})',
    'Do NOT skip step 2 and guess the value from memory.',
    '',
    '### Learning — save what works',
    'When user says "learn this", "save this", or "remember this workflow":',
    '  tek_router({action:"create", toolName:"<name>", toolDescription:"<what it does>",',
    '    toolTriggers:["<phrases that should find this>"],',
    '    toolCategory:"shortcut",',
    '    toolSteps:[{tool:"send_scpi", args:{commands:["<the commands>"]}}]})',
    'This saves the workflow so next time the AI finds it instantly via search.',
    '',
    '**send_scpi** — Send commands to live instrument: {commands:["CMD1","CMD2?"]}',
    '**capture_screenshot** — Capture scope display (analyze:true to see the image yourself)',
    '**get_visa_resources** — List all connected instruments on the network (VISA resource, model, serial)',
    '**discover_scpi** — Probes live instrument for undocumented commands. Slow (dozens of probes). Use only when search and browse return nothing useful.',
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
      '## Live Rules — YOU ARE THE HANDS ON THE SCOPE',
      '',
      '### Response format',
      '- Execute the command. Report result in ONE line. Screenshot if visual.',
      '- NEVER write more than 3 sentences unless the user asks for analysis.',
      '- NEVER stop and wait for permission. If you say "Let me try" — then try it. Don\'t stop and ask.',
      '- NEVER say "If you want..." or "Would you like..." — just do it.',
      '- NEVER give bullet-point essays. NEVER repeat analysis the user already saw.',
      '- If something FAILED: say "Didn\'t work — [reason]" and try a different approach immediately.',
      '- If told "wrong command": look up the correct one via tek_router, don\'t re-analyze the screenshot.',
      '',
      '### Execution',
      '- SESSION STARTUP: on the first live request in a session, call get_instrument_info, then send_scpi("*IDN?") to ground yourself before making assumptions about the scope.',
      '- Treat get_instrument_info as a hint and *IDN? as live proof of the connected scope when identity matters.',
      '- BATCH tool calls: call send_scpi AND capture_screenshot in the SAME response when possible.',
      '  Don\'t waste a round-trip just to take a screenshot — include it alongside your commands.',
      '- Pack ALL related SCPI commands into ONE send_scpi call. Don\'t send them one at a time.',
      '- Common commands → send_scpi IMMEDIATELY. No search needed for: *RST, *IDN?, AUTOSet, ADDMEAS, SCAle, TRIGger:A:EDGE.',
      '- Unknown commands → tek_router search → send_scpi. Two calls max.',
      '- Don\'t know the right command? Search it. Don\'t guess. Don\'t send wrong commands twice.',
      '- Before adding measurements: MEASUrement:LIST? to check what exists.',
      '- For direct requests like trigger setup, decode setup, zoom, measurements, or "fix clipping": use MCP lookup tools immediately, act, then verify. Do NOT spend turns brainstorming in text.',
      '',
      '### Verification — confirm you fulfilled the request',
      '- When the user asks you to DO something (add cursor, add measurement, change setting, add callout, etc.):',
      '  1. Send the SCPI commands',
      '  2. Query back the changed setting when a query exists',
      '  3. capture_screenshot(analyze:true) when display state matters',
      '  4. Check: did the thing the user asked for actually appear/change on screen?',
      '  5. If YES → report success briefly. If NO → say "Didn\'t work" and try a different approach.',
      '- RULE: After any SCPI write that changes acquisition, trigger, measurement, zoom, decode, or display config, you MUST query back the setting to confirm it took effect whenever a query exists.',
      '- Example: after sending TRIGger:A:EDGE:LEVel 1.5, send TRIGger:A:EDGE:LEVel? and verify the response.',
      '- Do NOT claim success based on SCPI "OK" alone. The scope can silently reject commands.',
      '- If the user says "I don\'t see it" or "try again" → take a fresh screenshot, see what\'s actually there, and try differently.',
      '- If a measurement reads 9.9E37 or similar invalid sentinel values, treat it as "no valid measurement" and check channel enable, signal presence, and trigger/acquisition state.',
      '- If the screenshot shows a flat line, check whether the channel is enabled, the vertical scale is reasonable, and the probe/signal is actually present.',
      '- After changing trigger settings, reacquire before trusting measurement or screenshot results.',
      '',
      '### Restrictions',
      '- NEVER use discover_scpi for normal tasks. It is a last resort for truly unknown commands.',
      '- NEVER retry the same failed command. Try a different approach or search for the right one.',
      '- NEVER repeat yourself. If user says "try again" → try something DIFFERENT, not the same thing.',
      '- NEVER write long thinking text, option comparisons, or speculation when MCP tools can answer the exact command path faster.',
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
      '- For clear build, edit, fix, or apply requests: do the work immediately instead of asking the user to say "build it".',
      '- Keep pre-JSON prose to 1-2 short sentences max for workflow proposals.',
      '- Do NOT narrate your search process, tool selection, or internal uncertainty unless you are blocked.',
      '- Use the minimum tool path: get_current_workflow only when current flow matters, get_instrument_info only when live instrument context matters, and lookup tools only when exact commands need verification.',
      '- Prefer MCP/runtime/SCPI tools over local file search. Use get_current_workflow, get_instrument_info, get_run_log, search_scpi, get_command_by_header, browse_scpi_commands, and verify_scpi_commands before inspecting repository files.',
      '- For runtime debugging: get_run_log first and reason from the evidence. Only use command lookup tools if exact repair commands must be verified.',
      '- Treat the workflow as a living artifact: preserve good steps, fix one concrete issue at a time, and prefer targeted edits over broad rewrites.',
      '- For diagnostic questions: ask 1-2 narrowing questions to guide the right path.',
      '',
      '## Build Output',
      '- For clear build, edit, fix, or apply requests: return plain ACTIONS_JSON with verified steps.',
      '- Do NOT wrap ACTIONS_JSON in HTML tags.',
      '- Do NOT use markdown code fences around ACTIONS_JSON.',
      '- If existing flow: prefer targeted edits and use insert_step_after, replace_step, set_step_param, or remove_step instead of rebuilding the whole flow.',
      '- If empty flow: use replace_flow.',
      '- Once you have a real workflow proposal, call stage_workflow_proposal instead of dumping raw ACTIONS_JSON into chat.',
      '- Build the actions yourself from the verified commands and workflow context.',
      '- Do not use stage_workflow_proposal for summary-only notes. It must carry a non-empty actions array.',
      '- TekAutomate will call prepare_flow_actions automatically when the user clicks Apply to Flow or auto-apply is enabled. Do NOT call prepare_flow_actions yourself when proposing changes.',
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
    '4. Last resort: use discover_scpi to probe the live instrument (slow, only for truly unknown commands).',
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

// ── Workstream 2: Workflow-aware Anthropic AI Chat ──────────────────────

/**
 * Build a compact workflow context string from current flow steps.
 * Injected into the user message so the AI knows what's already in the flow.
 */
export function buildWorkflowContext(
  steps: Array<{ id?: string; type: string; label?: string; params?: Record<string, unknown>; children?: unknown[] }>,
  validationErrors?: string[],
  selectedStepId?: string | null,
): string {
  if (!steps?.length) return '';

  const recursiveStepLines: string[] = [];
  const walk = (
    nodes: Array<{ id?: string; type: string; label?: string; params?: Record<string, unknown>; children?: unknown[] }>,
    prefix = '',
  ) => {
    nodes.forEach((s, i) => {
      const indexPath = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const cmd = s.params?.command || s.params?.code || s.label || s.type;
      const marker = selectedStepId && s.id === selectedStepId ? ' <- selected' : '';
      recursiveStepLines.push(`  ${indexPath}. [${s.type}] ${cmd}${marker}`);
      const children = Array.isArray(s.children)
        ? (s.children as Array<{ id?: string; type: string; label?: string; params?: Record<string, unknown>; children?: unknown[] }>)
        : [];
      if (children.length) walk(children, indexPath);
    });
  };
  walk(steps);

  let recursiveBody: string;
  if (recursiveStepLines.length > 12) {
    recursiveBody = [
      ...recursiveStepLines.slice(0, 5),
      `  ... (${recursiveStepLines.length - 10} more steps)`,
      ...recursiveStepLines.slice(-5),
    ].join('\n');
  } else {
    recursiveBody = recursiveStepLines.join('\n');
  }

  let recursiveCtx = `## Current Workflow (${recursiveStepLines.length} steps)\n${recursiveBody}`;
  if (validationErrors?.length) {
    recursiveCtx += `\n\nValidation errors:\n${(validationErrors ?? []).map((e) => `  - ${e}`).join('\n')}`;
  }
  return recursiveCtx;
}

/***
 * Lean system prompt for Anthropic AI Chat (flow-building mode).
 * ~6-8K chars / 1,500-2,000 tokens — down from 28-32K in buildLiveSystemPrompt.
 *
 * Drops: SCPI groups reference (AI can browse via tools), tek_router examples
 * (direct tools now), live mode rules, full tool decision tree.
 */
export function buildAnthropicChatPrompt(opts: {
  modelFamily?: string;
  backend?: string;
  deviceDriver?: string;
}): string {
  const modelFamily = opts.modelFamily || 'scope';
  const backend = opts.backend || 'pyvisa';

  return [
    '# TekAutomate AI Chat',
    `You are a senior Tektronix test automation engineer. Help build SCPI workflows for ${modelFamily} (backend: ${backend}).`,
    '',

    '## Tools — call directly by name',
    '- **stage_workflow_proposal** — hand a structured workflow proposal back to TekAutomate UI',
    '- **get_current_workflow** — inspect current steps, selected step, backend, and validation state',
    '- **get_instrument_info** — inspect connected instrument/model/backend when hardware context matters',
    '- **get_run_log** — inspect the latest execution log tail from the browser when debugging a failed run',
    '- **search_scpi** — fuzzy search by feature/keyword',
    '- **smart_scpi_lookup** — natural language lookup when needed',
    '- **get_command_by_header** — exact lookup when you know the header',
    '- **browse_scpi_commands** — 3-level drill-down: groups → commands → details',
    '- **verify_scpi_commands** — batch-verify commands before returning steps',
    '- **get_template_examples** — find workflow templates',
    '- **tek_router** — fallback for advanced materialize/save/learn flows',
    '',

    '## Workflow',
    '1. If the request is a clear workflow build/edit/fix/apply task, build the proposal yourself.',
    '2. Call get_current_workflow only when the current flow matters for the answer.',
    '3. Call get_instrument_info only when connected instrument/model/backend affects the answer.',
    '4. For runtime failures or "check the logs" requests, call get_run_log first and reason from the evidence.',
    '5. Prefer MCP/runtime/SCPI tools over local file search. Use workflow/runtime context and SCPI lookup tools first; inspect repository files only when MCP tools cannot answer the question.',
    '6. When you have a real workflow proposal, call stage_workflow_proposal so TekAutomate can show Apply to Flow.',
    '7. If your actions array is empty, do not call stage_workflow_proposal.',
    '8. Use the minimum number of tool calls. For normal build/edit requests, 1-3 calls is the goal.',
    '9. Do not dump raw workflow proposal JSON into chat when stage_workflow_proposal is available.',
    '10. Do not call stage_workflow_proposal with summary-only payloads.',
    '',

    '## CRITICAL: Never guess SCPI commands from memory. Always look up and verify.',
    '',

    '## Chat Rules',
    '- Keep responses focused — answer what was asked.',
    '- Always start with conversational, human-readable text before any ACTIONS_JSON.',
    '- Keep pre-JSON prose to 1-2 short sentences for workflow proposals.',
    '- Show key command(s) with syntax, brief explanation, and one example when answering command questions.',
    '- Never dump raw tool results — summarize what the user needs.',
    '- Do NOT narrate your search process, tool choices, or internal uncertainty unless you are blocked.',
    '- Engineer to engineer — assume they know oscilloscopes.',
    '- For clear build/edit/fix requests, do the work immediately instead of asking the user to say "build it".',
    '- For runtime review, explain the failure briefly with concrete evidence from the log before proposing changes.',
    '- End with a clear next step only when the request genuinely needs a decision.',
    '',

    '## ACTIONS_JSON Format',
    'For build, edit, fix, or apply requests, prefer stage_workflow_proposal over raw ACTIONS_JSON transcript output.',
    '- Do NOT wrap ACTIONS_JSON in HTML tags or markdown code fences.',
    '- Existing flow → prefer targeted edits and use insert_step_after, replace_step, set_step_param, or remove_step.',
    '- Empty flow → use replace_flow.',
    '- TekAutomate will call prepare_flow_actions automatically after Apply to Flow or auto-apply; do not call that tool while drafting the proposal.',
    '',

    '## Valid Step Types',
    'connect, disconnect, write, query, sleep, error_check, comment, python, save_waveform, save_screenshot, recall, group, tm_device_command',
    '',

    '## Step Schemas',
    'write: {"type":"write","label":"...","params":{"command":"..."}}',
    'query: {"type":"query","label":"...","params":{"command":"...?","saveAs":"result_name"}}',
    'group: {"type":"group","label":"...","params":{},"collapsed":false,"children":[...]}',
    '',

    '## Command Language',
    '- Canonical mnemonics: CH<x> (CH1), B<x> (B1), MATH<x> (MATH1), MEAS<x> (MEAS1).',
    '- Never invent aliases like CHAN1, CHANNEL1, BUS1.',
    '- SCPI: colon-separated headers, space before args, no colon before star commands (*OPC?).',
    '- Placeholders: <NR3>=number, CH<x>=channel, {A|B}=pick one, <Qstring>=quoted string.',
    '',

    opts.deviceDriver ? `## Instrument: ${modelFamily} (driver: ${opts.deviceDriver}, backend: ${backend})` : '',
  ].filter(Boolean).join('\n');
}
