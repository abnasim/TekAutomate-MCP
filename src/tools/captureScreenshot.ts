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

function fail(error: string, hint: string): ToolResult<Record<string, unknown>> {
  return { ok: false, data: { error, hint }, sourceMeta: [], warnings: [hint] };
}

/**
 * Capture a screenshot from the connected scope.
 *
 * analyze:false (default) — capture only, updates TekAutomate UI.
 * analyze:true — returns base64 image for AI analysis.
 */
export async function captureScreenshot(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  input = withRuntimeInstrumentDefaults(input);

  // ── Fast validation — tell the AI exactly what's wrong ──
  if (!input.executorUrl && !input.visaResource) {
    return fail('MISSING_CONTEXT',
      'No instrument context. Call get_instrument_info first, then pass executorUrl, visaResource, backend, and liveMode from its response.');
  }
  if (!input.executorUrl) {
    return fail('MISSING_EXECUTOR_URL',
      'executorUrl is required. Call get_instrument_info to get it.');
  }
  if (!input.visaResource) {
    return fail('MISSING_VISA_RESOURCE',
      'visaResource is required. Call get_instrument_info or get_visa_resources to get it.');
  }
  if (!input.liveMode) {
    return fail('NOT_LIVE',
      'No live instrument session. Make sure TekAutomate is open with an instrument connected in Live mode.');
  }

  // ── Bridge through TekAutomate browser if live session is active ──
  if (shouldBridgeToTekAutomate(input)) {
    try {
      const bridged = await dispatchLiveActionThroughTekAutomate('capture_screenshot', input, 20_000);
      if (!bridged.ok) {
        return fail('BRIDGE_FAILED', bridged.error || 'TekAutomate browser did not complete the screenshot. Is TekAutomate open in the browser?');
      }
      const data = (bridged.result && typeof bridged.result === 'object'
        ? bridged.result
        : { result: bridged.result }) as Record<string, unknown>;
      return { ok: true, data: input.analyze ? data : stripBase64(data), sourceMeta: [], warnings: [] };
    } catch (err) {
      return fail('BRIDGE_TIMEOUT', `Screenshot bridge timed out: ${err instanceof Error ? err.message : String(err)}. Is TekAutomate open in the browser?`);
    }
  }

  // ── Direct executor call ──
  try {
    const res = await fetch(`${input.executorUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action: 'capture_screenshot',
        scope_visa: input.visaResource,
        scope_type: input.scopeType || detectScopeType(input.modelFamily, input.deviceDriver),
        timeout_sec: 15,
        liveMode: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return fail('EXECUTOR_ERROR', `Executor returned ${res.status}. ${body}`.trim());
    }
    const json = await res.json() as Record<string, unknown>;
    const data = (json.result_data ?? json) as Record<string, unknown>;
    if (data.ok === false || data.error) {
      return fail('CAPTURE_FAILED', String(data.error || 'Scope did not return screenshot data.'));
    }
    return { ok: true, data: input.analyze ? data : stripBase64(data), sourceMeta: [], warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timed out') || msg.includes('abort')) {
      return fail('EXECUTOR_TIMEOUT', 'Executor did not respond in 20s. The VISA session may be locked — try sending *RST or restart the executor.');
    }
    return fail('EXECUTOR_UNREACHABLE', `Could not reach executor at ${input.executorUrl}. Is the executor running?`);
  }
}

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

function detectScopeType(modelFamily?: string, deviceDriver?: string): string {
  const hint = `${modelFamily || ''} ${deviceDriver || ''}`.toLowerCase();
  if (/dpo.*70|70k|70000/.test(hint)) return 'export';
  if (/dpo|mdo|tds|5k|7k/.test(hint)) return 'legacy';
  return 'modern';
}
