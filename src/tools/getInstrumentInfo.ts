import type { ToolResult } from '../core/schemas';
import { getInstrumentInfoState } from './runtimeContextStore';
import { sendScpi } from './sendScpi';

function normalizeScpiText(value: unknown): string {
  return String(value || '').replace(/^["']|["']$/g, '').trim();
}

function extractResponseTexts(result: unknown): string[] {
  if (!result) return [];
  if (typeof result === 'string') return [normalizeScpiText(result)].filter(Boolean);
  if (Array.isArray(result)) return result.flatMap((entry) => extractResponseTexts(entry));
  if (typeof result !== 'object') return [];

  const record = result as Record<string, unknown>;
  const collected: string[] = [];
  const push = (value: unknown) => {
    const text = normalizeScpiText(value);
    if (text) collected.push(text);
  };

  if (Array.isArray(record.responses)) {
    (record.responses as unknown[]).forEach((entry) => {
      if (entry && typeof entry === 'object') {
        const responseRecord = entry as Record<string, unknown>;
        push(responseRecord.response);
        push(responseRecord.output);
        push(responseRecord.stdout);
        push(responseRecord.combinedOutput);
      } else {
        push(entry);
      }
    });
  }

  push(record.stdout);
  push(record.output);
  push(record.response);
  push(record.combinedOutput);
  return collected.filter(Boolean);
}

function parseBandwidthFromOptions(optionsText: string): string | null {
  const normalized = normalizeScpiText(optionsText);
  if (!normalized) return null;
  const mhzMatch = normalized.match(/(\d+(?:\.\d+)?)\s*MHz\s*bandwidth/i);
  if (mhzMatch) return `${mhzMatch[1]} MHz`;
  const ghzMatch = normalized.match(/(\d+(?:\.\d+)?)\s*GHz\s*bandwidth/i);
  if (ghzMatch) return `${ghzMatch[1]} GHz`;
  return null;
}

function deriveModelMetadata(modelText: string): {
  deviceDriver: string | null;
  modelFamily: string | null;
  channelCount: string | null;
} {
  const model = normalizeScpiText(modelText).toUpperCase();
  if (!model) {
    return { deviceDriver: null, modelFamily: null, channelCount: null };
  }

  const exactMatch = model.match(/^([A-Z]+)(\d)(\d)([A-Z]*)$/);
  if (exactMatch) {
    const [, prefix, familyDigit, channelDigit] = exactMatch;
    return {
      deviceDriver: model,
      modelFamily: `${prefix}${familyDigit}`,
      channelCount: channelDigit,
    };
  }

  const familyOnly = model.match(/^([A-Z]+)(\d)([A-Z]*)$/);
  if (familyOnly) {
    const [, prefix, familyDigit] = familyOnly;
    return {
      deviceDriver: model,
      modelFamily: `${prefix}${familyDigit}`,
      channelCount: null,
    };
  }

  return {
    deviceDriver: model,
    modelFamily: null,
    channelCount: null,
  };
}

export async function getInstrumentInfo(): Promise<ToolResult<Record<string, unknown>>> {
  const base = getInstrumentInfoState() as Record<string, unknown>;
  const connected = Boolean(base.connected);
  const executorUrl = typeof base.executorUrl === 'string' ? base.executorUrl : '';
  const visaResource = typeof base.visaResource === 'string' ? base.visaResource : '';
  const backend = typeof base.backend === 'string' ? base.backend : 'pyvisa';
  const liveMode = Boolean(base.liveMode);

  if (!connected || !executorUrl || !visaResource) {
    return {
      ok: true,
      data: base,
      sourceMeta: [],
      warnings: [],
    };
  }

  try {
    const scpiResult = await sendScpi({
      commands: ['*IDN?', '*OPT?'],
      executorUrl,
      visaResource,
      backend,
      liveMode,
      outputMode: 'clean',
      timeoutMs: 5000,
      modelFamily: typeof base.modelFamily === 'string' ? base.modelFamily : undefined,
    });

    const responses = extractResponseTexts(scpiResult.data);
    const idn = responses.find((text) => text.includes(',') || /^TEK/i.test(text)) || '';
    const options = responses.find((text) => /MHz|GHz/i.test(text) && text !== idn) || responses[1] || '';
    const idnParts = idn.split(',').map((part) => part.trim()).filter(Boolean);

    const manufacturer = idnParts[0] || null;
    const model = idnParts[1] || (typeof base.deviceDriver === 'string' ? base.deviceDriver : '');
    const serial = idnParts[2] || null;
    const firmware = idnParts[3] || null;
    const derived = deriveModelMetadata(model);
    const bandwidth = parseBandwidthFromOptions(options);

    return {
      ok: true,
      data: {
        ...base,
        manufacturer,
        deviceDriver: derived.deviceDriver || base.deviceDriver || null,
        modelFamily: derived.modelFamily || base.modelFamily || 'unknown',
        serial,
        firmware,
        channelCount: derived.channelCount,
        bandwidth,
        idn,
        options: options || null,
      },
      sourceMeta: scpiResult.sourceMeta || [],
      warnings: scpiResult.warnings || [],
    };
  } catch (error) {
    return {
      ok: true,
      data: base,
      sourceMeta: [],
      warnings: [error instanceof Error ? error.message : 'Failed to enrich instrument info.'],
    };
  }

}
