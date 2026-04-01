import { captureScreenshotProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
  scopeType?: 'modern' | 'legacy';
  modelFamily?: string;
  deviceDriver?: string;
  analyze?: boolean;
}

export async function captureScreenshot(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate(
      'capture_screenshot',
      input as unknown as Record<string, unknown>,
      90_000,
    );
    return {
      ok: bridged.ok,
      data: bridged.ok
        ? ((bridged.result && typeof bridged.result === 'object'
            ? bridged.result
            : { result: bridged.result }) as Record<string, unknown>)
        : { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to capture screenshot.' },
      sourceMeta: [],
      warnings: bridged.ok ? [] : [bridged.error || 'TekAutomate live action failed.'],
    };
  }

  input = withRuntimeInstrumentDefaults(input);
  if (!input.executorUrl) {
    return { ok: false, data: { error: 'NO_INSTRUMENT', message: 'No instrument connected. Connect to a scope via the Execute page first.' }, sourceMeta: [], warnings: ['No executorUrl - instrument not connected.'] };
  }
  if (!input.liveMode) {
    return { ok: false, data: { error: 'NOT_LIVE', message: 'liveMode must be true to capture screenshots.' }, sourceMeta: [], warnings: ['liveMode is not enabled.'] };
  }
  return captureScreenshotProxy(input);
}
