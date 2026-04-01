import { getRuntimeContextState } from './runtimeContextStore';

export type LiveActionToolName =
  | 'send_scpi'
  | 'capture_screenshot'
  | 'get_instrument_state'
  | 'probe_command';

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
  resolve: (value: LiveActionResultEnvelope) => void;
  reject: (reason?: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface LiveActionResultEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
  completedAt: string;
}

const LIVE_ACTION_TIMEOUT_MS = 45_000;
const liveActionQueue: PendingActionRecord[] = [];
const liveActionWaiters = new Map<string, Array<(action: LiveActionRequest | null) => void>>();

function createActionId(): string {
  return `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function notifySession(sessionKey: string) {
  const waiters = liveActionWaiters.get(sessionKey);
  if (!waiters?.length) return;
  const action = liveActionQueue.find((item) => item.sessionKey === sessionKey && item.status === 'queued');
  if (!action) return;
  liveActionWaiters.delete(sessionKey);
  waiters.forEach((resolve) => resolve(stripRecord(action)));
}

function stripRecord(record: PendingActionRecord): LiveActionRequest {
  const { resolve: _resolve, reject: _reject, timeoutHandle: _timeoutHandle, ...action } = record;
  return action;
}

function cleanupRecord(id: string) {
  const index = liveActionQueue.findIndex((item) => item.id === id);
  if (index >= 0) {
    liveActionQueue.splice(index, 1);
  }
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
    throw new Error('No active live TekAutomate session is registered with MCP.');
  }

  const timeoutMs = Math.max(5_000, Math.min(params.timeoutMs ?? LIVE_ACTION_TIMEOUT_MS, 120_000));
  return new Promise<LiveActionResultEnvelope>((resolve, reject) => {
    const id = createActionId();
    const timeoutHandle = setTimeout(() => {
      cleanupRecord(id);
      reject(new Error(`Timed out waiting for TekAutomate live action result for ${params.toolName}.`));
    }, timeoutMs);

    const record: PendingActionRecord = {
      id,
      sessionKey,
      toolName: params.toolName,
      args: params.args,
      createdAt: new Date().toISOString(),
      status: 'queued',
      resolve,
      reject,
      timeoutHandle,
    };

    liveActionQueue.push(record);
    notifySession(sessionKey);
  });
}

export async function waitForNextLiveAction(sessionKey: string, timeoutMs = 25_000): Promise<LiveActionRequest | null> {
  const normalized = String(sessionKey || '').trim();
  if (!normalized) return null;

  const queued = liveActionQueue.find((item) => item.sessionKey === normalized && item.status === 'queued');
  if (queued) {
    queued.status = 'claimed';
    queued.claimedAt = new Date().toISOString();
    return stripRecord(queued);
  }

  return new Promise<LiveActionRequest | null>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      const waiters = liveActionWaiters.get(normalized) || [];
      liveActionWaiters.set(
        normalized,
        waiters.filter((waiter) => waiter !== wrappedResolve),
      );
      resolve(null);
    }, Math.max(1_000, Math.min(timeoutMs, 30_000)));

    const wrappedResolve = (action: LiveActionRequest | null) => {
      clearTimeout(timeoutHandle);
      if (!action) {
        resolve(null);
        return;
      }
      const queuedRecord = liveActionQueue.find((item) => item.id === action.id);
      if (queuedRecord && queuedRecord.status === 'queued') {
        queuedRecord.status = 'claimed';
        queuedRecord.claimedAt = new Date().toISOString();
        resolve(stripRecord(queuedRecord));
        return;
      }
      resolve(action);
    };

    const waiters = liveActionWaiters.get(normalized) || [];
    waiters.push(wrappedResolve);
    liveActionWaiters.set(normalized, waiters);
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
  record.resolve(payload);
  cleanupRecord(record.id);
  return true;
}

