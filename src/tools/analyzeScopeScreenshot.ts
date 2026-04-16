import type { ToolResult } from '../core/schemas';
import { captureScreenshot } from './captureScreenshot';

interface AnalyzeScopeScreenshotInput extends Record<string, unknown> {
  executorUrl?: string;
  visaResource?: string;
  backend?: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
  scopeType?: 'modern' | 'legacy';
  modelFamily?: string;
  deviceDriver?: string;
  timeoutMs?: number;
  prompt?: string;
  question?: string;
  model?: string;
  apiKey?: string;
  detail?: 'low' | 'high' | 'auto' | 'original';
}

interface OpenAiResponsesResult {
  output_text?: string;
  usage?: Record<string, unknown>;
}

function getAnalysisPrompt(input: AnalyzeScopeScreenshotInput): string {
  const explicit = String(input.prompt || input.question || '').trim();
  if (explicit) return explicit;
  return 'Describe only what is visually visible in this oscilloscope screenshot. Include channel labels, volts/div, timebase, sample rate, trigger indicators, and visible measurements or anomalies. Do not infer from SCPI state.';
}

function getAnalysisModel(input: AnalyzeScopeScreenshotInput): string {
  return String(input.model || process.env.OPENAI_SCREENSHOT_MODEL || 'gpt-4.1-mini').trim();
}

function getAnalysisDetail(input: AnalyzeScopeScreenshotInput): 'low' | 'high' | 'auto' | 'original' {
  const detail = String(input.detail || 'original').trim().toLowerCase();
  if (detail === 'low' || detail === 'high' || detail === 'auto' || detail === 'original') {
    return detail;
  }
  return 'original';
}

function getScreenshotImagePayload(data: Record<string, unknown>): { mimeType: string; base64: string } | null {
  const rawMimeType = typeof data.mimeType === 'string' ? data.mimeType : '';
  const rawBase64 = typeof data.base64 === 'string' ? data.base64 : '';
  if (rawMimeType.startsWith('image/') && rawBase64) {
    return { mimeType: rawMimeType, base64: rawBase64 };
  }

  const analysisMimeType = typeof data.analysisMimeType === 'string' ? data.analysisMimeType : '';
  const analysisBase64 = typeof data.analysisBase64 === 'string' ? data.analysisBase64 : '';
  if (analysisMimeType.startsWith('image/') && analysisBase64) {
    return { mimeType: analysisMimeType, base64: analysisBase64 };
  }

  return null;
}

async function analyzeWithOpenAi(
  apiKey: string,
  model: string,
  prompt: string,
  detail: 'low' | 'high' | 'auto' | 'original',
  image: { mimeType: string; base64: string },
): Promise<OpenAiResponsesResult> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            {
              type: 'input_image',
              image_url: `data:${image.mimeType};base64,${image.base64}`,
              detail,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`OpenAI screenshot analysis failed (${response.status}): ${raw}`);
  }

  return await response.json() as OpenAiResponsesResult;
}

export async function analyzeScopeScreenshot(
  input: AnalyzeScopeScreenshotInput,
): Promise<ToolResult<Record<string, unknown>>> {
  const apiKey = String(input.apiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return {
      ok: false,
      data: {
        error: 'MISSING_OPENAI_API_KEY',
        message: 'Missing apiKey (or set OPENAI_API_KEY env var) for screenshot analysis.',
      },
      sourceMeta: [],
      warnings: ['OpenAI API key is required for analyze_scope_screenshot.'],
    };
  }

  const screenshotResult = await captureScreenshot({
    ...input,
    analyze: true,
    analysisTransport: 'base64',
  } as any);
  if (!screenshotResult.ok || !screenshotResult.data || typeof screenshotResult.data !== 'object') {
    return screenshotResult as ToolResult<Record<string, unknown>>;
  }

  const screenshotData = screenshotResult.data as Record<string, unknown>;
  const image = getScreenshotImagePayload(screenshotData);
  if (!image) {
    return {
      ok: false,
      data: {
        error: 'SCREENSHOT_IMAGE_UNAVAILABLE',
        message: 'Screenshot capture succeeded but no image bytes were available for analysis.',
        screenshot: screenshotData,
      },
      sourceMeta: [],
      warnings: ['Screenshot payload did not include image bytes.'],
    };
  }

  try {
    const prompt = getAnalysisPrompt(input);
    const model = getAnalysisModel(input);
    const detail = getAnalysisDetail(input);
    const analysis = await analyzeWithOpenAi(apiKey, model, prompt, detail, image);

    return {
      ok: true,
      data: {
        analysis: typeof analysis.output_text === 'string' ? analysis.output_text : '',
        model,
        detail,
        prompt,
        screenshot: {
          capturedAt: typeof screenshotData.capturedAt === 'string' ? screenshotData.capturedAt : undefined,
          scopeType: typeof screenshotData.scopeType === 'string' ? screenshotData.scopeType : undefined,
          mimeType: image.mimeType,
          sizeBytes: typeof screenshotData.originalSizeBytes === 'number'
            ? screenshotData.originalSizeBytes
            : typeof screenshotData.sizeBytes === 'number'
              ? screenshotData.sizeBytes
              : undefined,
        },
        usage: analysis.usage || undefined,
      },
      sourceMeta: [],
      warnings: [],
    };
  } catch (err) {
    return {
      ok: false,
      data: {
        error: 'SCREENSHOT_ANALYSIS_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
      sourceMeta: [],
      warnings: ['Screenshot capture worked, but vision analysis failed.'],
    };
  }
}
