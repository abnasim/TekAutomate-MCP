import type { StepPreview } from '../../components/ExecutePage/StepsListPreview';
import { searchCommands as searchScpiCommands } from './scpiSearch';
import { searchTmCommands } from './tmSearch';

export const MCP_HOST_STORAGE_KEY = 'tekautomate.mcp.host';

export interface McpChatRequest {
  userMessage: string;
  attachments?: McpChatAttachment[];
  outputMode: 'steps_json' | 'blockly_xml' | 'chat';
  interactionMode?: 'build' | 'chat' | 'live';
  buildNew?: boolean;
  buildBrief?: {
    intent: string;
    diagnosticDomain: string[];
    channels: string[];
    protocols: string[];
    signalType?: string;
    dataRate?: string;
    closureType?: string;
    probing?: string;
    measurementGoals: string[];
    artifactGoals: string[];
    operatingModeHints: string[];
    unresolvedQuestions: string[];
    suggestedChecks: string[];
    secondaryEvidence?: string[];
  };
  intent?: 'default' | 'command_explain';
  mode?: 'mcp_only' | 'mcp_ai';
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  toolCallMode?: boolean;
  openaiAssistantId?: string;
  openaiThreadId?: string;
  scpiContext?: unknown[];
  tmContext?: unknown[];
  flowContext: {
    backend: string;
    host: string;
    connectionType: string;
    modelFamily: string;
    firmware?: string;
    steps: StepPreview[];
    selectedStepId: string | null;
    selectedStep?: Record<string, unknown> | null;
    executionSource: 'steps' | 'blockly' | 'live';
    deviceType?: string;
    deviceDriver?: string;
    visaBackend?: string;
    alias?: string;
    validationErrors?: string[];
    instrumentMap?: Array<{
      alias: string;
      backend: string;
      host?: string;
      connectionType?: string;
      deviceType?: string;
      deviceDriver?: string;
    }>;
  };
  runContext: {
    runStatus: 'idle' | 'connecting' | 'running' | 'done' | 'error';
    logTail: string;
    auditOutput: string;
    exitCode: number | null;
    duration?: string;
  };
  instrumentEndpoint?: {
    executorUrl: string;
    visaResource: string;
    backend: string;
    liveMode?: boolean;
    outputMode?: 'clean' | 'verbose';
    liveToken?: string;
  };
}

export interface McpChatAttachment {
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  textExcerpt?: string;
}

/**
 * Disconnect a live VISA session. Call when leaving live mode or before
 * running on scope (run flow, command checker, etc.) to free the VXI/TCPIP port.
 */
export async function disconnectLiveSession(instrumentEndpoint?: {
  executorUrl: string;
  visaResource: string;
  liveToken?: string;
} | null): Promise<boolean> {
  if (!instrumentEndpoint?.executorUrl || !instrumentEndpoint?.visaResource) return false;
  const mcpHost = resolveMcpHost();
  if (!mcpHost) return false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = String(instrumentEndpoint.liveToken || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/disconnect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instrumentEndpoint }),
    });
    const json = await res.json() as { ok: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

function isLocalHostName(hostname: string): boolean {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * Check if the current MCP host is local (localhost/127.0.0.1).
 * When MCP is remote/hosted, tool execution should go direct to executor from browser.
 */
export function isMcpLocal(): boolean {
  const host = resolveMcpHost();
  if (!host) return true; // default to local
  try {
    const url = new URL(host);
    return isLocalHostName(url.hostname);
  } catch {
    return host.includes('localhost') || host.includes('127.0.0.1');
  }
}

/**
 * Execute a tool call directly on the executor (bypass MCP).
 * Used in hosted MCP mode where MCP can't reach the local executor.
 */
export async function executeToolDirect(
  executorUrl: string,
  action: string,
  payload: Record<string, unknown>,
  scopeVisa?: string,
  liveToken?: string
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = String(liveToken || '').trim();
  if (token) headers['X-Live-Token'] = token;
  const res = await fetch(`${executorUrl.replace(/\/$/, '')}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      protocol_version: 1,
      action,
      timeout_sec: 90,
      scope_visa: scopeVisa,
      keep_alive: true,
      ...payload,
    }),
  });
  if (!res.ok) {
    throw new Error(`Executor error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

function resolveStoredMcpHost(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(localStorage.getItem(MCP_HOST_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function getStoredMcpHost(): string {
  return resolveStoredMcpHost();
}

export function setStoredMcpHost(host: string): void {
  if (typeof window === 'undefined') return;
  const value = String(host || '').trim();
  try {
    if (value) {
      localStorage.setItem(MCP_HOST_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(MCP_HOST_STORAGE_KEY);
    }
  } catch {
    // Ignore storage availability issues.
  }
}

export function clearStoredMcpHost(): void {
  setStoredMcpHost('');
}

export function resolveMcpHostCandidates(): string[] {
  const stored = resolveStoredMcpHost();
  if (stored) return [stored.replace(/\/+$/, '')];

  return [];
}

export function resolveMcpHost(): string {
  const stored = resolveStoredMcpHost();
  return stored ? stored.replace(/\/+$/, '') : '';
}

export async function buildMcpRequest(params: McpChatRequest): Promise<McpChatRequest> {
  const scpiContext = await searchScpiCommands(
    params.userMessage,
    params.flowContext.modelFamily,
    params.flowContext.deviceType,
    5
  );

  const tmContext =
    params.flowContext.backend === 'tm_devices'
      ? await searchTmCommands(params.userMessage, params.flowContext.modelFamily, 5)
      : [];

  return {
    ...params,
    model: params.model || 'gpt-4o',
    scpiContext,
    tmContext,
  };
}

async function streamSse(res: Response, onChunk: (chunk: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const eventName = event.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n');
      if (!data) continue;
      if (eventName === 'chunk') onChunk(data);
    }
  }
}

export async function streamMcpChat(
  request: McpChatRequest,
  onChunk: (chunk: string) => void
): Promise<{ openaiThreadId?: string; parseText?: string; screenshots?: Array<{ base64: string; mimeType: string; capturedAt: string }> }> {
  const enriched = await buildMcpRequest(request);
  const hosts = resolveMcpHostCandidates();
  if (!hosts.length) {
    throw new Error(
      'MCP host is not configured for hosted mode. Set localStorage key "tekautomate.mcp.host" to your HTTPS MCP URL.'
    );
  }
  let res: Response | null = null;
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      res = await fetch(`${host.replace(/\/$/, '')}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enriched),
      });
      if (res.ok || hosts.length === 1) break;
      if (![502, 503, 504].includes(res.status)) break;
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  if (!res) {
    throw new Error(lastError instanceof Error ? lastError.message : 'Failed to reach any configured MCP host.');
  }
  if (!res.ok) {
    let details = await res.text();
    try {
      const parsed = JSON.parse(details) as { error?: string };
      if (parsed?.error) details = parsed.error;
    } catch {
      // keep raw details
    }
    throw new Error(`MCP error ${res.status}: ${details}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = (await res.json()) as {
      text?: string;
      displayText?: string;
      openaiThreadId?: string;
      screenshots?: Array<{ base64: string; mimeType: string; capturedAt: string }>;
    };
    const displayText =
      typeof payload?.displayText === 'string' && payload.displayText
        ? payload.displayText
        : payload?.text;
    if (typeof displayText === 'string' && displayText) {
      onChunk(displayText);
    }
    return {
      openaiThreadId: typeof payload.openaiThreadId === 'string' ? payload.openaiThreadId : undefined,
      parseText: typeof payload?.text === 'string' ? payload.text : undefined,
      screenshots: Array.isArray(payload?.screenshots) ? payload.screenshots : undefined,
    };
  }

  await streamSse(res, onChunk);
  return {};
}
