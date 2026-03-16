import http from 'http';
import { initCommandIndex } from './core/commandIndex';
import { initTmDevicesIndex } from './core/tmDevicesIndex';
import { initRagIndexes } from './core/ragIndex';
import { initTemplateIndex } from './core/templateIndex';
import { runToolLoop } from './core/toolLoop';
import type { McpChatRequest } from './core/schemas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let lastAiDebug: Record<string, unknown> | null = null;
const REQUEST_LOG_DIR = path.join(__dirname, 'logs', 'requests');
const MAX_LOG_FILES = 500;

function ensureLogDir() {
  fs.mkdirSync(REQUEST_LOG_DIR, { recursive: true });
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
  const cleaned = text.replace(/ACTIONS_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ').replace(/```/g, '');
  const match = cleaned.match(/ACTIONS_JSON:\s*(\{[\s\S]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function logRequest(payload: {
  requestId: string;
  startedAt: number;
  req: McpChatRequest;
  result?: { text: string; errors: string[]; warnings?: string[] };
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

export async function createServer(port = 8787): Promise<http.Server> {
  await Promise.all([
    initCommandIndex(),
    initTmDevicesIndex(),
    initRagIndexes(),
    initTemplateIndex(),
  ]);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, status: 'ready' });
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
        if (!body?.userMessage || !body?.provider || !body?.apiKey || !body?.model) {
          sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
          return;
        }
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
            errors: result.errors,
          },
          prompts: result.debug
            ? {
                promptFileText: result.debug.promptFileText,
                systemPrompt: result.debug.systemPrompt,
                userPrompt: result.debug.userPrompt,
                developerPrompt: (result.debug as Record<string, unknown>).developerPrompt,
                shortcutResponse: result.debug.shortcutResponse,
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

    sendJson(res, 404, { ok: false, error: 'Not found' });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve());
  });
  return server;
}
