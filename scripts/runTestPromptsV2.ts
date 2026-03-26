/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { TEST_PROMPTS_V2, validateBlocklyOutput, validateStepsOutput } from '../e2e/testPrompts_v2';

interface StepLike {
  id: string;
  type: string;
  label?: string;
  params?: Record<string, unknown>;
  children?: StepLike[];
}

interface CaseResult {
  id: string;
  mode: 'steps_json' | 'blockly_xml';
  ok: boolean;
  errorCount: number;
  errors: string[];
  stepCount?: number;
  rawPreview?: string;
}

const ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'e2e-output', 'eval');
const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.AI_MODEL || process.env.EVAL_MODEL || 'gpt-5-mini';
const TEST_IDS = new Set(
  String(process.env.TEST_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
);

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function parseSseToText(sse: string): { text: string; error?: string } {
  const normalized = sse.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const events = normalized.split('\n\n');
  let text = '';
  let error: string | undefined;
  let lastEvent: string | undefined;

  for (const ev of events) {
    const lines = ev.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.replace(/^event:\s?/, '').trim();
    const dataStart = lines.findIndex((line) => line.startsWith('data:'));
    const data =
      dataStart >= 0
        ? lines
            .slice(dataStart)
            .map((line, idx) => (idx === 0 ? line.replace(/^data:\s?/, '') : line))
            .join('\n')
        : '';
    const rawBlock = lines.join('\n').trim();

    if (data) {
      if (event === 'chunk') text += data;
      if (event === 'error') error = data;
      lastEvent = event || lastEvent;
      continue;
    }

    if (rawBlock) {
      if (lastEvent === 'chunk') {
        text += `${text ? '\n\n' : ''}${rawBlock}`;
      } else if (lastEvent === 'error') {
        error = error ? `${error}\n\n${rawBlock}` : rawBlock;
      }
    }
  }

  return { text, error };
}

function extractFirstJsonObject(input: string): string | null {
  const start = input.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function extractSteps(text: string): StepLike[] {
  const tagged = text.match(/ACTIONS_JSON:\s*([\s\S]*?)$/i);
  const rawCandidate = tagged?.[1]?.trim() || text.trim();
  const fenced = rawCandidate.match(/```json\s*([\s\S]*?)```/i);
  const payload = fenced?.[1]?.trim() || rawCandidate;
  const jsonText = extractFirstJsonObject(payload);
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const actions = Array.isArray(parsed.actions) ? (parsed.actions as Array<Record<string, unknown>>) : [];
    const replace = actions.find((a) => String(a.action_type || a.type || '') === 'replace_flow');
    const flow = replace?.flow as Record<string, unknown> | undefined;
    const payloadObj = replace?.payload as Record<string, unknown> | undefined;
    const steps =
      (Array.isArray(flow?.steps) ? flow.steps : null) ||
      (Array.isArray(payloadObj?.steps) ? payloadObj.steps : null) ||
      (Array.isArray(replace?.steps) ? replace.steps : null);
    return Array.isArray(steps) ? (steps as StepLike[]) : [];
  } catch {
    return [];
  }
}

function extractXml(text: string): string {
  const match = text.match(/<xml[\s\S]*<\/xml>/i);
  return match?.[0]?.trim() || text.trim();
}

function clip(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

async function runOne(tc: (typeof TEST_PROMPTS_V2)[number]): Promise<CaseResult> {
  const payload = {
    userMessage: tc.prompt,
    outputMode: tc.outputMode,
    provider: 'openai',
    apiKey: API_KEY,
    model: MODEL,
    flowContext: {
      backend: tc.backend,
      host: '192.168.1.10',
      connectionType: 'tcpip',
      modelFamily: tc.modelFamily,
      steps: [],
      selectedStepId: null,
      executionSource: tc.outputMode === 'blockly_xml' ? 'blockly' : 'steps',
    },
    runContext: {
      runStatus: 'idle',
      logTail: '',
      auditOutput: '',
      exitCode: null,
    },
  };

  const res = await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const sse = await res.text();
  const parsed = parseSseToText(sse);

  if (tc.outputMode === 'steps_json') {
    const steps = extractSteps(parsed.text);
    const errors = parsed.error ? [parsed.error] : validateStepsOutput(steps as any, tc.stepValidation);
    return {
      id: tc.id,
      mode: tc.outputMode,
      ok: errors.length === 0,
      errorCount: errors.length,
      errors,
      stepCount: steps.length,
      rawPreview: clip(parsed.text),
    };
  }

  const xml = extractXml(parsed.text);
  const errors = parsed.error ? [parsed.error] : validateBlocklyOutput(xml, tc.xmlValidation);
  return {
    id: tc.id,
    mode: tc.outputMode,
    ok: errors.length === 0,
    errorCount: errors.length,
    errors,
    rawPreview: clip(xml),
  };
}

async function main() {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY is required');
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = nowStamp();
  const results: CaseResult[] = [];

  const testCases = TEST_IDS.size
    ? TEST_PROMPTS_V2.filter((tc) => TEST_IDS.has(tc.id))
    : TEST_PROMPTS_V2;

  for (const tc of testCases) {
    console.log(`Running ${tc.id} (${tc.outputMode})`);
    results.push(await runOne(tc));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const summary = { model: MODEL, passed, failed, results };

  const jsonPath = join(OUTPUT_DIR, `testPrompts_v2_${stamp}.json`);
  const mdPath = join(OUTPUT_DIR, `testPrompts_v2_${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  const lines = [
    '# Test Prompts v2 Results',
    '',
    `Model: ${MODEL}`,
    `Passed: ${passed}`,
    `Failed: ${failed}`,
    '',
    '| Case | Mode | Result | Notes |',
    '|------|------|--------|-------|',
    ...results.map((r) => `| ${r.id} | ${r.mode} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.errors.join(' ; ') || '-'} |`),
    '',
  ];
  writeFileSync(mdPath, lines.join('\n'), 'utf8');

  console.log(`JSON written: ${jsonPath}`);
  console.log(`MD written: ${mdPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('runTestPromptsV2 failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
