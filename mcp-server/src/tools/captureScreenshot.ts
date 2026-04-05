import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input extends Record<string, unknown> {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  scopeType?: 'modern' | 'legacy' | 'export';
  modelFamily?: string;
  deviceDriver?: string;
  analyze?: boolean;
}

/**
 * Capture a screenshot from the connected scope.
 *
 * The executor handles the SCPI flow (SAVE:IMAGE / HARDCOPY / EXPort)
 * and returns { ok, scopeType, mimeType, sizeBytes, capturedAt, base64 }.
 *
 * analyze:false (default) — strips base64 from the response (UI-only capture).
 * analyze:true — returns the full base64 so the AI can see the image.
 */
export async function captureScreenshot(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  // ── Bridge through TekAutomate browser if live session is active ──
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate('capture_screenshot', input, 90_000);
    if (!bridged.ok) {
      return {
        ok: false,
        data: { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to capture screenshot.' },
        sourceMeta: [],
        warnings: [bridged.error || 'TekAutomate live action failed.'],
      };
    }
    const data = (bridged.result && typeof bridged.result === 'object'
      ? bridged.result
      : { result: bridged.result }) as Record<string, unknown>;
    return {
      ok: true,
      data: input.analyze ? data : stripBase64(data),
      sourceMeta: [],
      warnings: [],
    };
  }

  // ── Direct executor call ──
  input = withRuntimeInstrumentDefaults(input);
  if (!input.executorUrl) {
    return { ok: false, data: { error: 'NO_INSTRUMENT', message: 'No instrument connected.' }, sourceMeta: [], warnings: ['No executorUrl.'] };
  }
  if (!input.liveMode) {
    return { ok: false, data: { error: 'NOT_LIVE', message: 'liveMode must be true to capture screenshots.' }, sourceMeta: [], warnings: ['liveMode is not enabled.'] };
  }

  try {
    const res = await fetch(`${input.executorUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action: 'capture_screenshot',
        scope_visa: input.visaResource,
        scope_type: input.scopeType || detectScopeType(input.modelFamily, input.deviceDriver),
        timeout_sec: 30,
        liveMode: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { ok: false, data: { error: `Executor error ${res.status}` }, sourceMeta: [], warnings: [`Executor returned ${res.status}`] };
    }
    const json = await res.json() as Record<string, unknown>;
    const data = (json.result_data ?? json) as Record<string, unknown>;
    return {
      ok: true,
      data: input.analyze ? data : stripBase64(data),
      sourceMeta: [],
      warnings: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: { error: msg }, sourceMeta: [], warnings: [msg] };
  }
}

/** Remove base64 from the response when analyze is false. */
function stripBase64(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: data.ok !== false,
    captured: true,
    scopeType: data.scopeType,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    capturedAt: data.capturedAt,
  };
}

/** Detect scope type from model family / device driver. */
function detectScopeType(modelFamily?: string, deviceDriver?: string): string {
  const hint = `${modelFamily || ''} ${deviceDriver || ''}`.toLowerCase();
  if (/dpo.*70|70k|70000/.test(hint)) return 'export';
  if (/dpo|mdo|tds|5k|7k/.test(hint)) return 'legacy';
  return 'modern';
}
