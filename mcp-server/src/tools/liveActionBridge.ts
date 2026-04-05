import { getRuntimeContextState } from './runtimeContextStore';

export type LiveActionToolName =
  | 'send_scpi'
  | 'capture_screenshot'
  | 'get_instrument_state'
  | 'probe_command'
  | 'get_visa_resources'
  | 'get_environment'
  | 'discover_scpi';

export interface LiveActionRequest {
  id: string;
  sessionKey: string;
  toolName: LiveActionToolName;
  args: Record<string, unknown>;
  createdAt: string;
  claimedAt?: string;
  status: 'queued' | 'claimed' | 'completed' | 'failed';
}

interface PendingActionRecord extends LiveActionRequest {
  resolveHandlers: Array<(value: LiveActionResultEnvelope) => void>;
  rejectHandlers: Array<(reason?: unknown) => void>;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface LiveActionResultEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
  completedAt: string;
}

const LIVE_ACTION_TIMEOUT_MS = 20_000;
const liveActionQueue: PendingActionRecord[] = [];

// ── SSE streams — one per session key ──────────────────────────────
// When the browser opens GET /live-actions/stream?sessionKey=X, we store
// the response object here. When a new action is enqueued, we push it
// immediately via SSE — zero polling gap.
const sseStreams = new Map<string, Set<import('http').ServerResponse>>();

export function addSseStream(sessionKey: string, res: import('http').ServerResponse): void {
  let set = sseStreams.get(sessionKey);
  if (!set) {
    set = new Set();
    sseStreams.set(sessionKey, set);
  }
  set.add(res);
}

export function removeSseStream(sessionKey: string, res: import('http').ServerResponse): void {
  const set = sseStreams.get(sessionKey);
  if (set) {
    set.delete(res);
    if (set.size === 0) sseStreams.delete(sessionKey);
  }
}

export function getSseStreamCount(sessionKey?: string): number {
  if (sessionKey) return sseStreams.get(sessionKey)?.size ?? 0;
  let total = 0;
  for (const set of sseStreams.values()) total += set.size;
  return total;
}

function pushActionToSseStreams(sessionKey: string, action: LiveActionRequest): boolean {
  const set = sseStreams.get(sessionKey);
  if (!set?.size) return false;
  const data = JSON.stringify(action);
  const msg = `event: action\ndata: ${data}\n\n`;
  for (const res of set) {
    try { res.write(msg); } catch { /* stream dead, will be cleaned up */ }
  }
  return true;
}

function createActionId(): string {
  return `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isScreenshotAction(record: LiveActionRequest | PendingActionRecord): boolean {
  return record.toolName === 'capture_screenshot';
}

function getNextQueuedRecord(sessionKey: string): PendingActionRecord | null {
  const queued = liveActionQueue.filter((item) => item.sessionKey === sessionKey && item.status === 'queued');
  if (!queued.length) return null;
  const commandLike = queued.find((item) => !isScreenshotAction(item));
  if (commandLike) return commandLike;
  return queued[queued.length - 1]; // latest screenshot
}

function stripRecord(record: PendingActionRecord): LiveActionRequest {
  const { resolveHandlers: _, rejectHandlers: __, timeoutHandle: ___, ...action } = record;
  return action;
}

function cleanupRecord(id: string) {
  const index = liveActionQueue.findIndex((item) => item.id === id);
  if (index >= 0) liveActionQueue.splice(index, 1);
}

function getDefaultLiveSessionKey(): string | null {
  const runtime = getRuntimeContextState();
  if (!runtime.instrument.connected || !runtime.instrument.liveMode) return null;
  const key = String(runtime.liveSession?.sessionKey || '').trim();
  return key || null;
}

export function getPendingLiveActionCount(sessionKey?: string | null): number {
  return liveActionQueue.filter((item) => {
    if (item.status !== 'queued' && item.status !== 'claimed') return false;
    if (!sessionKey) return true;
    return item.sessionKey === sessionKey;
  }).length;
}

export async function enqueueLiveAction(params: {
  toolName: LiveActionToolName;
  args: Record<string, unknown>;
  sessionKey?: string | null;
  timeoutMs?: number;
}): Promise<LiveActionResultEnvelope> {
  const sessionKey = String(params.sessionKey || getDefaultLiveSessionKey() || '').trim();
  if (!sessionKey) {
    throw new Error('No active live TekAutomate session. Open TekAutomate in the browser with an instrument connected.');
  }

  // Check if any browser is listening
  const hasStream = getSseStreamCount(sessionKey) > 0;
  if (!hasStream) {
    throw new Error('No TekAutomate browser session is listening. Open TekAutomate in the browser and switch to Live mode.');
  }

  const timeoutMs = Math.max(5_000, Math.min(params.timeoutMs ?? LIVE_ACTION_TIMEOUT_MS, 60_000));
  return new Promise<LiveActionResultEnvelope>((resolve, reject) => {
    // Deduplicate screenshots — replace queued one instead of adding another
    if (params.toolName === 'capture_screenshot') {
      const existing = liveActionQueue.find(
        (item) => item.sessionKey === sessionKey && item.status === 'queued' && item.toolName === 'capture_screenshot',
      );
      if (existing) {
        existing.args = params.args;
        existing.createdAt = new Date().toISOString();
        existing.resolveHandlers.push(resolve);
        existing.rejectHandlers.push(reject);
        return;
      }
    }

    const id = createActionId();
    const timeoutHandle = setTimeout(() => {
      const record = liveActionQueue.find((item) => item.id === id);
      cleanupRecord(id);
      const error = new Error(`Tool ${params.toolName} timed out after ${Math.round(timeoutMs / 1000)}s. TekAutomate browser may not be responding.`);
      if (record) {
        record.rejectHandlers.forEach((handler) => handler(error));
      } else {
        reject(error);
      }
    }, timeoutMs);

    const record: PendingActionRecord = {
      id,
      sessionKey,
      toolName: params.toolName,
      args: params.args,
      createdAt: new Date().toISOString(),
      status: 'queued',
      resolveHandlers: [resolve],
      rejectHandlers: [reject],
      timeoutHandle,
    };

    liveActionQueue.push(record);

    // Push to SSE stream immediately — no polling gap
    const action = stripRecord(record);
    const pushed = pushActionToSseStreams(sessionKey, action);
    if (pushed) {
      record.status = 'claimed';
      record.claimedAt = new Date().toISOString();
    }
  });
}

// Keep the old poll endpoint working as fallback
export async function waitForNextLiveAction(sessionKey: string, timeoutMs = 25_000): Promise<LiveActionRequest | null> {
  const normalized = String(sessionKey || '').trim();
  if (!normalized) return null;

  const queued = getNextQueuedRecord(normalized);
  if (queued) {
    queued.status = 'claimed';
    queued.claimedAt = new Date().toISOString();
    return stripRecord(queued);
  }

  return new Promise<LiveActionRequest | null>((resolve) => {
    // Just wait briefly — SSE should handle delivery
    setTimeout(() => resolve(null), Math.min(timeoutMs, 5_000));
  });
}

export function completeLiveAction(input: {
  id: string;
  sessionKey?: string | null;
  ok: boolean;
  result?: unknown;
  error?: string;
}): boolean {
  const record = liveActionQueue.find((item) => item.id === input.id);
  if (!record) return false;
  if (input.sessionKey && record.sessionKey !== input.sessionKey) return false;

  clearTimeout(record.timeoutHandle);
  record.status = input.ok ? 'completed' : 'failed';
  const payload: LiveActionResultEnvelope = {
    ok: input.ok,
    result: input.result,
    error: input.error,
    completedAt: new Date().toISOString(),
  };
  record.resolveHandlers.forEach((handler) => handler(payload));
  cleanupRecord(record.id);
  return true;
}
