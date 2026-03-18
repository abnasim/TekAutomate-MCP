import { performance } from 'perf_hooks';
import { mkdir, writeFile } from 'fs/promises';
import * as aiActions from '../../src/utils/aiActions.ts';
import { CASE_ALIASES, CASES, type BenchmarkCase } from './level_cases.ts';

const aiActionFns = ((aiActions as unknown as { default?: Record<string, unknown> }).default ||
  aiActions) as {
  parseAiActionResponse: (text: string) => {
    actions: Array<Record<string, unknown>>;
  } | null;
  canMaterializeAiAction: (action: Record<string, unknown>) => boolean;
  applyAiActionsToSteps: <T>(steps: T[], actions: Array<Record<string, unknown>>) => T[];
};

type StepLike = {
  id: string;
  type: string;
  label: string;
  params?: Record<string, unknown>;
  children?: StepLike[];
};

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gpt-5.4';
const CASE_FILTER = process.env.CASE_FILTER || '';
const LEVEL_FILTER = process.env.LEVEL_FILTER || '';
const MAX_CASES = Number(process.env.MAX_CASES || 0);

if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY to run the live level benchmark.');
  process.exit(1);
}

function selectedCases(): BenchmarkCase[] {
  const caseSet = new Set(
    CASE_FILTER.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => CASE_ALIASES[id] || id)
  );
  const levelSet = new Set(LEVEL_FILTER.split(',').map((s) => s.trim()).filter(Boolean));
  let rows = CASES.filter((test) => {
    if (caseSet.size && !caseSet.has(test.id)) return false;
    if (levelSet.size && !levelSet.has(test.level)) return false;
    return true;
  });
  if (MAX_CASES > 0) rows = rows.slice(0, MAX_CASES);
  return rows;
}

type ChatResponse = {
  ok: boolean;
  text: string;
  displayText?: string;
  errors?: string[];
  warnings?: string[];
  metrics?: {
    totalMs?: number;
    toolCalls?: number;
    iterations?: number;
  };
};

type DebugEnvelope = {
  ok: boolean;
  debug: {
    rawOutput?: Record<string, unknown>;
    tools?: {
      trace?: Array<{ name?: string }>;
    };
  } | null;
};

type BenchmarkStatus = 'PASS' | 'WARN' | 'FAIL_CLOSED' | 'FAIL';

type BenchmarkResult = {
  caseId: string;
  level: string;
  status: BenchmarkStatus;
  totalTokens: number | null;
  toolCalls: number | null;
  iterations: number | null;
  applyable: boolean;
  actions: number;
  materializable: number;
  appliedSteps: number;
  totalMs: number;
  tools: string[];
  errors: string[];
  warnings: string[];
  preview?: string;
};

function extractTokenUsage(debug: DebugEnvelope['debug']): { totalTokens: number | null } {
  const rawOutput = debug?.rawOutput as Record<string, unknown> | undefined;
  const usage =
    (rawOutput?.usage as Record<string, unknown> | undefined) ||
    (Array.isArray(rawOutput?.requests)
      ? ((rawOutput?.requests as Array<Record<string, unknown>>).at(-1)?.usage as Record<string, unknown> | undefined)
      : undefined);
  return {
    totalTokens: typeof usage?.total_tokens === 'number' ? usage.total_tokens : null,
  };
}

function uiApplyability(text: string): {
  parsed: boolean;
  actions: number;
  chatUiApplicable: boolean;
  materializableActions: number;
  appliedSteps: number;
} {
  const normalizedText = (() => {
    const raw = String(text || '').trim();
    const marker = raw.match(/ACTIONS_JSON:\s*([\s\S]*)$/i);
    return marker?.[1]?.trim() || raw;
  })();
  const parsed = aiActionFns.parseAiActionResponse(normalizedText);
  if (!parsed) {
    return { parsed: false, actions: 0, chatUiApplicable: false, materializableActions: 0, appliedSteps: 0 };
  }
  const materializableActions = parsed.actions.filter((action) => aiActionFns.canMaterializeAiAction(action)).length;
  const allMaterializable = parsed.actions.length > 0 && materializableActions === parsed.actions.length;
  const applied = allMaterializable
    ? aiActionFns.applyAiActionsToSteps<StepLike>([], parsed.actions).length
    : 0;
  return {
    parsed: true,
    actions: parsed.actions.length,
    chatUiApplicable: allMaterializable && applied > 0,
    materializableActions,
    appliedSteps: applied,
  };
}

async function runCase(test: BenchmarkCase): Promise<BenchmarkResult> {
  const requestBody = {
    userMessage: test.userMessage,
    outputMode: 'steps_json',
    provider: 'openai',
    apiKey: OPENAI_API_KEY,
    model: MODEL,
    openaiAssistantId: '__SERVER_DEFAULT_ASSISTANT__',
    flowContext: test.flowContext,
    runContext: { runStatus: 'idle', logTail: '', auditOutput: '', exitCode: null },
    history: [],
  };

  const startedAt = performance.now();
  try {
    const response = await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const payload = (await response.json()) as ChatResponse;
    const totalMs = Math.round(performance.now() - startedAt);
    const debug = (await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/debug/last`).then((res) => res.json())) as DebugEnvelope;
    const toolsUsed = Array.from(new Set((debug.debug?.tools?.trace || []).map((entry) => String(entry.name || '')).filter(Boolean)));
    const tokenUsage = extractTokenUsage(debug.debug);
    const applyability = uiApplyability(String(payload.text || ''));
    const status =
      payload.ok && applyability.chatUiApplicable
        ? 'PASS'
        : payload.ok && applyability.parsed
          ? 'WARN'
          : payload.ok
            ? 'FAIL_CLOSED'
            : 'FAIL';
    const preview = !applyability.chatUiApplicable
      ? String(payload.text || '').slice(0, 220).replace(/\s+/g, ' ').trim()
      : undefined;
    console.log(
      [
        test.id,
        test.level,
        status,
        `tokens:${tokenUsage.totalTokens ?? '-'}`,
        `toolCalls:${payload.metrics?.toolCalls ?? '-'}`,
        `iterations:${payload.metrics?.iterations ?? '-'}`,
        `applyable:${applyability.chatUiApplicable ? 'yes' : 'no'}`,
        `actions:${applyability.actions}`,
        `materializable:${applyability.materializableActions}`,
        `appliedSteps:${applyability.appliedSteps}`,
        `totalMs:${payload.metrics?.totalMs ?? totalMs}`,
      ].join(' | ')
    );
    if (toolsUsed.length) {
      console.log(`  tools: ${toolsUsed.join(', ')}`);
    }
    if (Array.isArray(payload.errors) && payload.errors.length) {
      console.log(`  errors: ${payload.errors.join(' | ')}`);
    }
    if (Array.isArray(payload.warnings) && payload.warnings.length) {
      console.log(`  warnings: ${payload.warnings.join(' | ')}`);
    }
    if (preview) {
      console.log(`  preview: ${preview}`);
    }
    return {
      caseId: test.id,
      level: test.level,
      status,
      totalTokens: tokenUsage.totalTokens,
      toolCalls: typeof payload.metrics?.toolCalls === 'number' ? payload.metrics.toolCalls : null,
      iterations: typeof payload.metrics?.iterations === 'number' ? payload.metrics.iterations : null,
      applyable: applyability.chatUiApplicable,
      actions: applyability.actions,
      materializable: applyability.materializableActions,
      appliedSteps: applyability.appliedSteps,
      totalMs: typeof payload.metrics?.totalMs === 'number' ? payload.metrics.totalMs : totalMs,
      tools: toolsUsed,
      errors: Array.isArray(payload.errors) ? payload.errors : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      preview,
    };
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);
    console.log(`${test.id} | ${test.level} | FAIL | totalMs:${totalMs} | ${String(error)}`);
    return {
      caseId: test.id,
      level: test.level,
      status: 'FAIL',
      totalTokens: null,
      toolCalls: null,
      iterations: null,
      applyable: false,
      actions: 0,
      materializable: 0,
      appliedSteps: 0,
      totalMs,
      tools: [],
      errors: [String(error)],
      warnings: [],
    };
  }
}

async function writeLatestResults(results: BenchmarkResult[]): Promise<void> {
  const outDir = new URL('../benchmark_results/', import.meta.url);
  await mkdir(outDir, { recursive: true });
  const counts = results.reduce(
    (acc, row) => {
      if (row.status === 'PASS') acc.PASS += 1;
      else if (row.status === 'WARN') acc.WARN += 1;
      else acc.FAIL += 1;
      return acc;
    },
    { PASS: 0, WARN: 0, FAIL: 0 }
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    host: MCP_HOST,
    model: MODEL,
    totalCases: results.length,
    counts,
    results,
  };
  await writeFile(new URL('latest.json', outDir), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const tests = selectedCases();
  if (!tests.length) {
    console.log('No benchmark cases selected.');
    return;
  }
  console.log(`Running ${tests.length} live benchmark case(s) against ${MCP_HOST} with model ${MODEL}`);
  const results: BenchmarkResult[] = [];
  for (const test of tests) {
    results.push(await runCase(test));
  }
  await writeLatestResults(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
