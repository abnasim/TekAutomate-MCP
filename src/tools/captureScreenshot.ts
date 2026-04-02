import { captureScreenshotProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input extends Record<string, unknown> {
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

async function compressAnalyzedScreenshotPayload(
  payload: Record<string, unknown>,
  analyze?: boolean,
): Promise<Record<string, unknown>> {
  if (analyze !== true) return payload;

  const base64 = typeof payload.base64 === 'string' ? payload.base64 : '';
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : '';
  if (!base64 || !mimeType.startsWith('image/')) return payload;

  try {
    const sharp = (await import('sharp')).default;
    const rawBuffer = Buffer.from(base64, 'base64');
    const variants = [
      { width: 640, height: 384, quality: 55 },
      { width: 480, height: 288, quality: 45 },
    ];

    let best: Buffer = rawBuffer;
    for (const variant of variants) {
      const candidate: Buffer = await sharp(rawBuffer)
        .resize(variant.width, variant.height, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: variant.quality, mozjpeg: true })
        .toBuffer();

      if (candidate.length < best.length) {
        best = candidate;
      }

      if (candidate.length <= 25 * 1024) {
        best = candidate;
        break;
      }
    }

    if (best.length >= rawBuffer.length) {
      return payload;
    }

    return {
      ...payload,
      mimeType: 'image/jpeg',
      sizeBytes: best.length,
      originalMimeType: mimeType,
      originalSizeBytes: rawBuffer.length,
      base64: best.toString('base64'),
    };
  } catch {
    return payload;
  }
}

export async function captureScreenshot(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (shouldBridgeToTekAutomate(input)) {
    const bridged = await dispatchLiveActionThroughTekAutomate(
      'capture_screenshot',
      input,
      90_000,
    );
    const data = bridged.ok
      ? ((bridged.result && typeof bridged.result === 'object'
          ? bridged.result
          : { result: bridged.result }) as Record<string, unknown>)
      : { error: 'LIVE_ACTION_FAILED', message: bridged.error || 'TekAutomate failed to capture screenshot.' };
    const maybeCompressed = bridged.ok
      ? await compressAnalyzedScreenshotPayload(data, input.analyze)
      : data;
    return {
      ok: bridged.ok,
      data: maybeCompressed,
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
  const result = await captureScreenshotProxy(input);
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    return result;
  }
  return {
    ...result,
    data: await compressAnalyzedScreenshotPayload(result.data as Record<string, unknown>, input.analyze),
  };
}
