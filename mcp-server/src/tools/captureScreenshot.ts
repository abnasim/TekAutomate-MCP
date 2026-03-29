import { captureScreenshotProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

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
  if (!input.executorUrl) {
    return { ok: false, data: { error: 'NO_INSTRUMENT', message: 'No instrument connected. Connect to a scope via the Execute page first.' }, sourceMeta: [], warnings: ['No executorUrl — instrument not connected.'] };
  }
  if (!input.liveMode) {
    return { ok: false, data: { error: 'NOT_LIVE', message: 'liveMode must be true to capture screenshots.' }, sourceMeta: [], warnings: ['liveMode is not enabled.'] };
  }
  return captureScreenshotProxy(input);
}
