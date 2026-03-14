import http from 'http';
import { initCommandIndex } from './core/commandIndex';
import { initTmDevicesIndex } from './core/tmDevicesIndex';
import { initRagIndexes } from './core/ragIndex';
import { initTemplateIndex } from './core/templateIndex';
import { runToolLoop } from './core/toolLoop';
import type { McpChatRequest } from './core/schemas';

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

    if (req.method === 'POST' && req.url === '/ai/chat') {
      let sseStarted = false;
      try {
        const body = (await readJsonBody(req)) as unknown as McpChatRequest;
        if (!body?.userMessage || !body?.provider || !body?.apiKey || !body?.model) {
          sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
          return;
        }
        sendSseStart(res);
        sseStarted = true;
        sseWrite(res, 'status', { phase: 'processing' });
        const result = await runToolLoop(body);
        sseWrite(res, 'chunk', result.text);
        if (result.errors.length) {
          sseWrite(res, 'warnings', result.errors);
        }
        sseWrite(res, 'done', '[DONE]');
        res.end();
      } catch (err) {
        if (sseStarted) {
          sseWrite(res, 'error', {
            ok: false,
            error: err instanceof Error ? err.message : 'Server error',
          });
          sseWrite(res, 'done', '[DONE]');
          res.end();
        } else {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'Server error',
          });
        }
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
