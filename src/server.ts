import http from 'http';
import { initCommandIndex } from './core/commandIndex';
import { providerSupplementsEnabled } from './core/providerCatalog';
import { runToolLoop } from './core/toolLoop';
import type { McpChatRequest } from './core/schemas';
import { bootRouter, createReloadProvidersHandler, createRouterHandler, getRouterHealth } from './core/routerIntegration';
import { getCommandIndex } from './core/commandIndex';
import { getRagIndexes } from './core/ragIndex';
import { getTemplateIndex } from './core/templateIndex';
import fs from 'fs';
import path from 'path';
import util from 'util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverStartedAt = Date.now();

let lastAiDebug: Record<string, unknown> | null = null;
const REQUEST_LOG_DIR = path.join(__dirname, 'logs', 'requests');
const MAX_LOG_FILES = 500;
const MAX_IN_MEMORY_LOGS = 250;
let startupState: 'starting' | 'ready' | 'error' = 'starting';
let startupError: string | null = null;
let startupInitPromise: Promise<void> | null = null;
type LogLevel = 'log' | 'info' | 'warn' | 'error';
type InMemoryLogEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
};
const inMemoryLogs: InMemoryLogEntry[] = [];
let consolePatched = false;

function stringifyLogArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      return util.inspect(arg, { depth: 4, breakLength: 120, colors: false });
    })
    .join(' ');
}

function appendInMemoryLog(level: LogLevel, args: unknown[]) {
  inMemoryLogs.push({
    timestamp: new Date().toISOString(),
    level,
    message: stringifyLogArgs(args),
  });
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.splice(0, inMemoryLogs.length - MAX_IN_MEMORY_LOGS);
  }
}

function patchConsoleOnce() {
  if (consolePatched) return;
  consolePatched = true;
  const methods: LogLevel[] = ['log', 'info', 'warn', 'error'];
  for (const method of methods) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      appendInMemoryLog(method, args);
      original(...args);
    }) as typeof console[typeof method];
  }
}

function ensureLogDir() {
  fs.mkdirSync(REQUEST_LOG_DIR, { recursive: true });
}

function readRecentRequestSummaries(limit = 12): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(REQUEST_LOG_DIR)) return [];
    return fs
      .readdirSync(REQUEST_LOG_DIR)
      .map((name) => {
        const full = path.join(REQUEST_LOG_DIR, name);
        const stat = fs.statSync(full);
        return { name, time: stat.mtimeMs, full };
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map((file) => {
        try {
          const raw = fs.readFileSync(file.full, 'utf8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          return {
            timestamp: parsed.timestamp,
            requestId: parsed.requestId,
            ok: parsed.ok,
            provider: parsed.provider,
            model: parsed.model,
            backend: (parsed.flowContext as Record<string, unknown> | undefined)?.backend,
            userMessage: parsed.userMessage,
            durationMs: parsed.durationMs,
            postCheckErrors:
              ((parsed.postCheck as Record<string, unknown> | undefined)?.errors as unknown[]) || [],
          };
        } catch {
          return {
            timestamp: new Date(file.time).toISOString(),
            requestId: file.name,
            ok: false,
            provider: '(unparsed)',
            model: '(unparsed)',
            userMessage: 'Failed to parse request log',
          };
        }
      });
  } catch {
    return [];
  }
}

function rotateLogs() {
  const files = fs.readdirSync(REQUEST_LOG_DIR).map((name) => {
    const full = path.join(REQUEST_LOG_DIR, name);
    const stat = fs.statSync(full);
    return { name, time: stat.mtimeMs };
  });
  if (files.length <= MAX_LOG_FILES) return;
  const excess = files.length - MAX_LOG_FILES;
  files
    .sort((a, b) => a.time - b.time)
    .slice(0, excess)
    .forEach((f) => {
      try {
        fs.unlinkSync(path.join(REQUEST_LOG_DIR, f.name));
      } catch {
        // ignore
      }
    });
}

function flattenStepTypes(steps: unknown[]): string[] {
  const types: string[] = [];
  const walk = (items: unknown[]) => {
    items.forEach((s) => {
      if (!s || typeof s !== 'object') return;
      const step = s as Record<string, unknown>;
      if (step.type) types.push(String(step.type));
      if (Array.isArray(step.children)) walk(step.children);
    });
  };
  walk(steps || []);
  return Array.from(new Set(types));
}

function extractActionsJson(text: string): Record<string, unknown> | null {
  // FIX BUG-004: Previous regex was too greedy, matching from first { to last }
  // This causes it to consume text after the JSON object
  try {
    // Step 1: Find ACTIONS_JSON marker
    const actionJsonMatch = text.match(/ACTIONS_JSON:\s*/i);
    if (!actionJsonMatch) {
      return null;
    }

    // Step 2: Start from marker position
    const startIdx = actionJsonMatch.index! + actionJsonMatch[0].length;
    let jsonText = text.substring(startIdx).trim();

    // Step 3: Remove code block markers if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.substring('```json'.length);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.substring('```'.length);
    }

    // Step 4: Find matching braces (non-greedy: find first complete JSON object)
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < jsonText.length; i += 1) {
      const ch = jsonText[i];
      if (ch === '{') braceCount += 1;
      else if (ch === '}') {
        braceCount -= 1;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx === -1) {
      console.warn('[POST_CHECK] Could not find complete JSON object in ACTIONS_JSON');
      return null;
    }

    // Step 5: Parse the JSON
    const jsonStr = jsonText.substring(0, endIdx);
    const parsed = JSON.parse(jsonStr);

    // Step 6: Validate structure (should be object)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[POST_CHECK] ACTIONS_JSON is not an object:', typeof parsed);
      return null;
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('[POST_CHECK] Invalid JSON in ACTIONS_JSON:', error.message);
    } else {
      console.warn('[POST_CHECK] Error parsing ACTIONS_JSON:', error);
    }
    return null;
  }
}

function logRequest(payload: {
  requestId: string;
  startedAt: number;
  req: McpChatRequest;
  result?: { text: string; displayText?: string; errors: string[]; warnings?: string[] };
  ok: boolean;
}) {
  ensureLogDir();
  rotateLogs();
  const { req, result, requestId, startedAt } = payload;
  const safeReq = ((req || {}) as Partial<McpChatRequest>);
  const flowContext =
    safeReq.flowContext && typeof safeReq.flowContext === 'object'
      ? safeReq.flowContext
      : ({
          backend: '(unknown)',
          host: '(unknown)',
          connectionType: '(unknown)',
          modelFamily: '(unknown)',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
        } as McpChatRequest['flowContext']);
  const actionsJson = result ? extractActionsJson(result.text) : null;
  const actions = actionsJson && Array.isArray(actionsJson.actions) ? (actionsJson.actions as unknown[]) : [];
  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    provider: safeReq.provider,
    model: safeReq.model,
    outputMode: safeReq.outputMode,
    deviceType: flowContext.deviceType,
    modelFamily: flowContext.modelFamily,
    backend: flowContext.backend,
    userMessage: safeReq.userMessage,
    flowContext: {
      stepCount: Array.isArray(flowContext.steps) ? flowContext.steps.length : 0,
      stepTypes: flattenStepTypes(Array.isArray(flowContext.steps) ? flowContext.steps : []),
      validationErrors: flowContext.validationErrors || [],
    },
    scpiContextHits: Array.isArray(safeReq.scpiContext) ? safeReq.scpiContext.length : 0,
    toolCalls: [],
    postCheck: {
      errors: result?.errors || [],
      warnings: result?.warnings || [],
      autoRepairTriggered: false,
    },
    response: result
      ? {
          text: result.text,
          actionsJson,
          stepCount: actions.length,
          stepTypes: actions.map((a: any) => a?.type).filter(Boolean),
        }
      : null,
    durationMs: Date.now() - startedAt,
    ok: payload.ok,
  };
  const file = path.join(REQUEST_LOG_DIR, `${Date.now()}_${requestId}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(logEntry, null, 2), 'utf8');
  } catch {
    // ignore logging errors
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}') as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStatusPayload() {
  const warmMode = String(process.env.MCP_WARM_START_MODE || 'minimal').trim().toLowerCase() || 'minimal';
  return {
    ok: startupState !== 'error',
    status: startupState,
    service: 'TekAutomate MCP',
    uptimeSec: Math.floor((Date.now() - serverStartedAt) / 1000),
    routerEnabled: String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true',
    providerSupplementsEnabled: providerSupplementsEnabled(),
    warmStartMode: warmMode,
    port: Number(process.env.MCP_PORT || process.env.PORT || 8787),
    timestamp: new Date().toISOString(),
    ...(startupError ? { startupError } : {}),
  };
}

function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(html);
}

function renderStatusPage() {
  const status = getStatusPayload();
  const checks = [
    ['Health JSON', '/health'],
    ['Status JSON', '/status'],
    ['Debug Console', '/debug'],
    ['Log Feed JSON', '/logs'],
    ['Last AI Debug', '/ai/debug/last'],
  ];
  const items = checks
    .map(([label, href]) => `<li><a href="${href}">${escapeHtml(label)}</a></li>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TekAutomate MCP</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b1220;
      --panel: #111a2b;
      --text: #e8edf7;
      --muted: #9fb0d0;
      --accent: #24c8db;
      --ok: #34d399;
    }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: linear-gradient(135deg, #0b1220, #16233c);
      color: var(--text);
    }
    main {
      max-width: 760px;
      margin: 48px auto;
      padding: 24px;
    }
    .card {
      background: rgba(17, 26, 43, 0.92);
      border: 1px solid rgba(159, 176, 208, 0.2);
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 32px;
    }
    p, li {
      color: var(--muted);
      line-height: 1.5;
    }
    .pill {
      display: inline-block;
      margin: 8px 0 18px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(52, 211, 153, 0.14);
      color: var(--ok);
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-size: 12px;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 8px 14px;
      margin: 18px 0 24px;
    }
    dt {
      color: var(--text);
      font-weight: 700;
    }
    dd {
      margin: 0;
      color: var(--muted);
    }
    a {
      color: var(--accent);
    }
    code {
      background: rgba(159, 176, 208, 0.12);
      padding: 2px 6px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>TekAutomate MCP</h1>
      <div class="pill">Service Healthy</div>
      <p>This deployment is up and ready to serve TekAutomate MCP requests.</p>
      <dl>
        <dt>Status</dt><dd>${escapeHtml(status.status)}</dd>
        <dt>Port</dt><dd>${status.port}</dd>
        <dt>Router Enabled</dt><dd>${status.routerEnabled ? 'Yes' : 'No'}</dd>
        <dt>Provider Supplements</dt><dd>${status.providerSupplementsEnabled ? 'Enabled' : 'Disabled'}</dd>
        <dt>Uptime</dt><dd>${status.uptimeSec}s</dd>
        <dt>Timestamp</dt><dd>${escapeHtml(status.timestamp)}</dd>
      </dl>
      <p>Useful endpoints:</p>
      <ul>${items}</ul>
      <p>TekAutomate clients can point their MCP URL to this server root, for example <code>${escapeHtml('https://your-mcp-host.example')}</code>.</p>
    </section>
  </main>
</body>
</html>`;
}

function renderDebugPage() {
  const status = getStatusPayload();
  const recentLogs = inMemoryLogs
    .slice(-40)
    .reverse()
    .map(
      (entry) =>
        `<div class="line"><span class="ts">${escapeHtml(entry.timestamp)}</span> <span class="lvl ${entry.level}">${escapeHtml(entry.level.toUpperCase())}</span> <span class="msg">${escapeHtml(entry.message)}</span></div>`
    )
    .join('');
  const requests = readRecentRequestSummaries(10)
    .map((entry) => {
      const errors = Array.isArray(entry.postCheckErrors) ? entry.postCheckErrors.length : 0;
      return `<tr>
        <td>${escapeHtml(String(entry.timestamp || ''))}</td>
        <td>${escapeHtml(String(entry.ok ? 'ok' : 'error'))}</td>
        <td>${escapeHtml(String(entry.provider || ''))}</td>
        <td>${escapeHtml(String(entry.model || ''))}</td>
        <td>${escapeHtml(String(entry.durationMs || ''))}</td>
        <td>${escapeHtml(String(errors))}</td>
        <td>${escapeHtml(String(entry.userMessage || ''))}</td>
      </tr>`;
    })
    .join('');
  const debugJson = escapeHtml(JSON.stringify(lastAiDebug || { ok: true, message: 'No debug payload yet.' }, null, 2));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="10" />
  <title>TekAutomate MCP Debug</title>
  <style>
    :root {
      --bg: #071018;
      --panel: #0d1722;
      --panel2: #101d2c;
      --text: #d6e2f2;
      --muted: #8ea0bd;
      --accent: #39d0ff;
      --green: #31d0aa;
      --yellow: #ffd166;
      --red: #ff6b6b;
      --border: rgba(142, 160, 189, 0.18);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Consolas, Monaco, 'Courier New', monospace;
      background: radial-gradient(circle at top, #112034, var(--bg));
      color: var(--text);
    }
    main {
      max-width: 1280px;
      margin: 24px auto;
      padding: 0 16px 24px;
    }
    .header, .panel {
      background: rgba(13, 23, 34, 0.94);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.24);
    }
    .header {
      padding: 18px 20px;
      margin-bottom: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 16px;
    }
    .panel { padding: 16px; }
    .terminal {
      background: #050b12;
      border: 1px solid rgba(57, 208, 255, 0.12);
      border-radius: 12px;
      padding: 14px;
      min-height: 420px;
      overflow: auto;
    }
    .line { padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .ts { color: var(--muted); }
    .lvl { display: inline-block; min-width: 52px; font-weight: 700; margin: 0 10px; }
    .lvl.log, .lvl.info { color: var(--accent); }
    .lvl.warn { color: var(--yellow); }
    .lvl.error { color: var(--red); }
    .msg { white-space: pre-wrap; word-break: break-word; }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
    .pill {
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(49, 208, 170, 0.12);
      color: var(--green);
      border: 1px solid rgba(49, 208, 170, 0.18);
      font-size: 12px;
      font-weight: 700;
    }
    h1, h2 { margin: 0 0 10px; }
    h1 { font-size: 28px; }
    h2 { font-size: 16px; color: var(--accent); }
    p, a, td, th { color: var(--muted); }
    a { color: var(--accent); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      vertical-align: top;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: #050b12;
      border: 1px solid rgba(57, 208, 255, 0.12);
      border-radius: 12px;
      padding: 14px;
      max-height: 360px;
      overflow: auto;
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="header">
      <h1>TekAutomate MCP Debug Console</h1>
      <p>Auto-refreshes every 10 seconds. Use this page as a lightweight hosted debug terminal.</p>
      <div class="meta">
        <span class="pill">Status: ${escapeHtml(status.status)}</span>
        <span class="pill">Uptime: ${status.uptimeSec}s</span>
        <span class="pill">Port: ${status.port}</span>
        <span class="pill">Router: ${status.routerEnabled ? 'enabled' : 'disabled'}</span>
      </div>
      <p><a href="/">Home</a> · <a href="/health">/health</a> · <a href="/status">/status</a> · <a href="/logs">/logs</a> · <a href="/ai/debug/last">/ai/debug/last</a></p>
    </section>
    <section class="grid">
      <section class="panel">
        <h2>Recent Server Logs</h2>
        <div class="terminal">${recentLogs || '<div class="line"><span class="msg">No logs captured yet.</span></div>'}</div>
      </section>
      <section class="panel">
        <h2>Latest AI Debug Payload</h2>
        <pre>${debugJson}</pre>
      </section>
    </section>
    <section class="panel" style="margin-top: 16px;">
      <h2>Recent Requests</h2>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Result</th>
            <th>Provider</th>
            <th>Model</th>
            <th>ms</th>
            <th>Errors</th>
            <th>User Message</th>
          </tr>
        </thead>
        <tbody>${requests || '<tr><td colspan="7">No request logs yet.</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function sendSseStart(res: http.ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function parseProviderError(status: number, raw: string): { code: string; message: string; hint: string } {
  let code = `http_${status}`;
  let message = raw || `Provider error ${status}`;
  let type = '';
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const err = (j.error && typeof j.error === 'object' ? j.error : j) as Record<string, unknown>;
    code = String(err.code || err.type || code);
    message = String(err.message || message);
    type = String(err.type || '');
  } catch {
    // Keep defaults if body is not JSON.
  }

  const k = `${code} ${type} ${message}`.toLowerCase();
  let hint = 'Check provider/key/model configuration.';
  if (k.includes('insufficient_quota') || k.includes('quota')) {
    hint = 'Key is valid but project quota/budget is exhausted or not enabled for this key.';
  } else if (k.includes('invalid_api_key') || k.includes('authentication') || k.includes('unauthorized')) {
    hint = 'Invalid API key or provider mismatch.';
  } else if (k.includes('model_not_found') || k.includes('not_permitted') || k.includes('permission')) {
    hint = 'Model is not available for this key/account.';
  }
  return { code, message, hint };
}

async function warmStartup(): Promise<void> {
  if (startupInitPromise) return startupInitPromise;
  startupInitPromise = (async () => {
    patchConsoleOnce();
    startupState = 'starting';
    startupError = null;
    const startInit = Date.now();
    const warmMode = String(process.env.MCP_WARM_START_MODE || 'minimal').trim().toLowerCase() || 'minimal';
    console.log(`[SERVER] Initializing indexes in background (mode=${warmMode})...`);

    const tasks: Promise<unknown>[] = [initCommandIndex()];
    const names = ['CommandIndex'];
    if (warmMode === 'full') {
      tasks.push(
        import('./core/tmDevicesIndex').then(({ initTmDevicesIndex }) => initTmDevicesIndex()),
        import('./core/ragIndex').then(({ initRagIndexes }) => initRagIndexes()),
        import('./core/templateIndex').then(({ initTemplateIndex }) => initTemplateIndex())
      );
      names.push('TmDevicesIndex', 'RagIndexes', 'TemplateIndex');
      if (providerSupplementsEnabled()) {
        tasks.push(import('./core/providerCatalog').then(({ initProviderCatalog }) => initProviderCatalog()));
        names.push('ProviderCatalog');
      }
    }

    const results = await Promise.allSettled(tasks);

    const failures = results
      .map((r, i) => (r.status === 'rejected' ? { index: i, error: r.reason } : null))
      .filter((f): f is { index: number; error: unknown } => Boolean(f));

    if (failures.length > 0) {
      const failedNames = failures.map((f) => names[f.index]).join(', ');
      const error = new Error(`[CRITICAL] Initialization failed: ${failedNames}`);
      startupState = 'error';
      startupError = error.message;
      console.error(error.message);
      for (const failure of failures) {
        console.error(`  ${names[failure.index]}: ${failure.error}`);
      }
      throw error;
    }

    console.log(`✅ All indexes initialized in ${Date.now() - startInit}ms`);

    if (String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true') {
      const commandIndex = await getCommandIndex();
      const ragIndexes = await getRagIndexes();
      const templates = (await getTemplateIndex()).all().map((doc) => ({
        id: doc.id,
        name: doc.name,
        description: doc.description,
        backend: 'template',
        deviceType: 'workflow',
        tags: [],
        steps: doc.steps,
      }));
      const report = await bootRouter({ commandIndex, ragIndexes, templates });
      console.log(`[MCP:router] ${report.total} tools in ${report.durationMs}ms`);
    }

    startupState = 'ready';
  })().catch((error) => {
    startupState = 'error';
    startupError = error instanceof Error ? error.message : String(error);
    throw error;
  });
  return startupInitPromise;
}

export async function createServer(port = 8787, host = '0.0.0.0'): Promise<http.Server> {
  patchConsoleOnce();

  // NOW create the HTTP server (all indexes are ready)
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.end();
      return;
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      sendHtml(res, 200, renderStatusPage());
      return;
    }

    if (req.method === 'GET' && req.url === '/debug') {
      sendHtml(res, 200, renderDebugPage());
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, getStatusPayload());
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      sendJson(res, 200, getStatusPayload());
      return;
    }

    if (req.method === 'GET' && req.url === '/logs') {
      sendJson(res, 200, {
        ok: true,
        logs: inMemoryLogs.slice(-120),
        recentRequests: readRecentRequestSummaries(20),
      });
      return;
    }

    if (startupState !== 'ready') {
      const retryable = startupState === 'starting';
      sendJson(res, retryable ? 503 : 500, {
        ok: false,
        error: retryable ? 'Server is still initializing.' : startupError || 'Server failed to initialize.',
        status: startupState,
      });
      return;
    }

    if (String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true' && req.method === 'GET' && req.url === '/ai/router/health') {
      // FIX BUG-005: getRouterHealth() can return undefined, causing malformed JSON
      const health = getRouterHealth();
      if (!health) {
        sendJson(res, 503, { ok: false, status: 'initializing', message: 'Router still initializing' });
      } else {
        sendJson(res, 200, health);
      }
      return;
    }

    if (String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true' && req.method === 'POST' && req.url === '/ai/router') {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const result = await createRouterHandler(body as any);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Router error' });
      }
      return;
    }

    if (String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true' && req.method === 'POST' && req.url === '/ai/router/reload-providers') {
      try {
        const body = (await readJsonBody(req)) as { providersDir?: string };
        const result = await createReloadProvidersHandler(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Router reload error' });
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/ai/debug/last') {
      sendJson(res, 200, { ok: true, debug: lastAiDebug });
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/responses-proxy') {
      let sseStarted = false;
      const startedAt = Date.now();
      try {
        const body = (await readJsonBody(req)) as {
          apiKey?: string;
          model?: string;
          input?: unknown[];
          systemPrompt?: string;
        };
        const serverKey = process.env.OPENAI_SERVER_API_KEY;
        const vectorStoreId = process.env.COMMAND_VECTOR_STORE_ID;
        if (!serverKey) {
          sendJson(res, 500, { ok: false, error: 'OPENAI_SERVER_API_KEY not configured on server' });
          return;
        }
        if (!body?.input) {
          sendJson(res, 400, { ok: false, error: 'Missing input' });
          return;
        }
        const requestBody: Record<string, unknown> = {
          model: body.model || 'gpt-4o',
          input: body.input,
          stream: true,
        };
        if (vectorStoreId) {
          requestBody.tools = [{ type: 'file_search', vector_store_ids: [vectorStoreId] }];
        }
        // Use server key — owns the vector store. User's apiKey is for authentication
        // to this service only; OpenAI is billed to the server account.
        const openaiRes = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serverKey}`,
          },
          body: JSON.stringify(requestBody),
        });
        if (!openaiRes.ok) {
          const errText = await openaiRes.text();
          sendJson(res, openaiRes.status, { ok: false, error: `OpenAI error ${openaiRes.status}: ${errText}` });
          return;
        }
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/responses-proxy',
          request: {
            model: body.model || 'gpt-4o',
            inputCount: Array.isArray(body.input) ? body.input.length : 0,
          },
          timings: {
            totalMs: Date.now() - startedAt,
          },
        };
        // Proxy the SSE stream directly to the client
        sendSseStart(res);
        sseStarted = true;
        const reader = openaiRes.body?.getReader();
        if (!reader) {
          sseWrite(res, 'error', { ok: false, error: 'No response body' });
          sseWrite(res, 'done', '[DONE]');
          res.end();
          return;
        }
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // Write raw SSE chunks through — client parser handles them
          res.write(chunk);
        }
        res.end();
      } catch (err) {
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/responses-proxy',
          error: err instanceof Error ? err.message : 'Server error',
          timings: {
            totalMs: Date.now() - startedAt,
          },
        };
        if (sseStarted) {
          sseWrite(res, 'error', { ok: false, error: err instanceof Error ? err.message : 'Server error' });
          res.end();
        } else {
          sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : 'Server error' });
        }
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/chat') {
      const startedAt = Date.now();
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const body = (await readJsonBody(req)) as unknown as McpChatRequest;
        const normalizedUserMessage = typeof body?.userMessage === 'string' ? body.userMessage.trim() : '';
        const mode = body?.mode === 'mcp_only' ? 'mcp_only' : 'mcp_ai';
        if (mode === 'mcp_only') {
          body.provider = (body.provider || 'openai') as McpChatRequest['provider'];
          body.model = body.model || 'gpt-5.4-mini';
          body.apiKey = body.apiKey || '__mcp_only__';
        }
        if (!normalizedUserMessage || !body?.provider || !body?.model || (mode !== 'mcp_only' && !body?.apiKey)) {
          sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
          return;
        }
        body.userMessage = normalizedUserMessage;
        const hasAssistantRoute = typeof body.openaiAssistantId === 'string' && body.openaiAssistantId.trim().length > 0;
        console.log(`[MCP] /ai/chat requestId=${requestId} openaiAssistantId=${hasAssistantRoute ? '(set)' : '(none)'} userMessageLen=${body.userMessage?.length ?? 0}`);
        const result = await runToolLoop(body);
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/chat',
          request: {
            ...body,
            apiKey: '[redacted]',
            instrumentEndpoint: body.instrumentEndpoint
              ? {
                  ...body.instrumentEndpoint,
                  visaResource: '[redacted]',
                }
              : undefined,
          },
          response: {
            text: result.text,
            displayText: result.displayText,
            errors: result.errors,
          },
          prompts: result.debug
            ? {
                promptFileText: result.debug.promptFileText,
                systemPrompt: result.debug.systemPrompt,
                userPrompt: result.debug.userPrompt,
                developerPrompt: (result.debug as Record<string, unknown>).developerPrompt,
                providerRequest: (result.debug as Record<string, unknown>).providerRequest,
                shortcutResponse: result.debug.shortcutResponse,
                resolutionPath: (result.debug as Record<string, unknown>).resolutionPath,
              }
            : undefined,
          tools: result.debug
            ? {
                available: result.debug.toolDefinitions,
                trace: result.debug.toolTrace,
              }
            : undefined,
          rawOutput: (result.debug as Record<string, unknown>).rawOutput,
          timings: {
            totalMs: Date.now() - startedAt,
            ...(result.metrics || {}),
          },
        };
        logRequest({
          requestId,
          startedAt,
          req: body,
          result,
          ok: true,
        });
        sendJson(res, 200, {
          ok: true,
          text: result.text,
          displayText: result.displayText,
          commands: result.commands, // Include commands for apply card
          openaiThreadId: result.assistantThreadId,
          errors: result.errors,
          warnings: result.warnings,
          metrics: result.metrics,
        });
      } catch (err) {
        lastAiDebug = {
          timestamp: new Date().toISOString(),
          route: '/ai/chat',
          error: err instanceof Error ? err.message : 'Server error',
          timings: {
            totalMs: Date.now() - startedAt,
          },
        };
        const body = {} as McpChatRequest;
        try {
          Object.assign(body, await readJsonBody(req));
        } catch {
          /* ignore */
        }
        logRequest({
          requestId,
          startedAt,
          req: body,
          result: err instanceof Error ? { text: err.message, errors: [err.message] } : undefined,
          ok: false,
        });
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : 'Server error',
        });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/key-test') {
      try {
        const body = (await readJsonBody(req)) as {
          provider?: 'openai' | 'anthropic';
          apiKey?: string;
          model?: string;
        };
        const provider = body?.provider;
        const apiKey = String(body?.apiKey || '').trim();
        const model = String(body?.model || '').trim();
        if (!provider || !apiKey || !model) {
          sendJson(res, 400, { ok: false, error: 'Missing provider, apiKey, or model.' });
          return;
        }

        if (provider === 'openai') {
          const openaiRes = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              input: 'ping',
              max_output_tokens: 16,
            }),
          });
          if (!openaiRes.ok) {
            const raw = await openaiRes.text();
            const parsed = parseProviderError(openaiRes.status, raw);
            sendJson(res, openaiRes.status, { ok: false, provider, model, ...parsed });
            return;
          }
        } else {
          const anthRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: 16,
              messages: [{ role: 'user', content: 'ping' }],
            }),
          });
          if (!anthRes.ok) {
            const raw = await anthRes.text();
            const parsed = parseProviderError(anthRes.status, raw);
            sendJson(res, anthRes.status, { ok: false, provider, model, ...parsed });
            return;
          }
        }

        sendJson(res, 200, {
          ok: true,
          provider,
          model,
          reachable: true,
          message: 'Provider/key/model accepted.',
        });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : 'Server error',
        });
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/ai/models') {
      try {
        const body = (await readJsonBody(req)) as {
          provider?: 'openai' | 'anthropic';
          apiKey?: string;
        };
        const provider = body?.provider;
        const apiKey = String(body?.apiKey || '').trim();
        if (!provider || !apiKey) {
          sendJson(res, 400, { ok: false, error: 'Missing provider or apiKey.' });
          return;
        }

        if (provider === 'openai') {
          const modelsRes = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          });
          const raw = await modelsRes.text();
          if (!modelsRes.ok) {
            const parsed = parseProviderError(modelsRes.status, raw);
            sendJson(res, modelsRes.status, { ok: false, provider, ...parsed });
            return;
          }
          let ids: string[] = [];
          try {
            const json = JSON.parse(raw) as { data?: Array<{ id?: string }> };
            ids = (json.data || [])
              .map((m) => String(m?.id || '').trim())
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b));
          } catch {
            ids = [];
          }
          sendJson(res, 200, { ok: true, provider, models: ids });
          return;
        }

        const anthRes = await fetch('https://api.anthropic.com/v1/models', {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        const anthRaw = await anthRes.text();
        if (!anthRes.ok) {
          const parsed = parseProviderError(anthRes.status, anthRaw);
          sendJson(res, anthRes.status, { ok: false, provider, ...parsed });
          return;
        }
        let ids: string[] = [];
        try {
          const json = JSON.parse(anthRaw) as { data?: Array<{ id?: string }> };
          ids = (json.data || [])
            .map((m) => String(m?.id || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        } catch {
          ids = [];
        }
        sendJson(res, 200, { ok: true, provider, models: ids });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : 'Server error',
        });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });
  void warmStartup().catch(() => {
    // Startup errors are surfaced through /health, /status, /debug, and route guards.
  });
  return server;
}
