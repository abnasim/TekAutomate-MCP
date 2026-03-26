import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import * as aiActions from '../../src/utils/aiActions.ts';
import { CASES, type BenchmarkCase } from './level_cases.ts';

const aiActionFns = ((aiActions as unknown as { default?: Record<string, unknown> }).default ||
  aiActions) as {
  parseAiActionResponse: (text: string) => {
    summary?: string;
    findings?: string[];
    suggestedFixes?: string[];
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

type ModeName = 'mcp_only' | 'hosted_multi';

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
    prompts?: {
      resolutionPath?: string;
    };
    tools?: {
      trace?: Array<{ name?: string }>;
    };
  } | null;
};

type QualityCapture = {
  caseId: string;
  level: string;
  mode: ModeName;
  totalMs: number;
  toolCalls: number;
  iterations: number;
  tokens: number | null;
  pass: boolean;
  applyable: boolean;
  actionCount: number;
  appliedSteps: number;
  materializable: number;
  queryMissingSaveAs: number;
  resolutionPath: string;
  actionsJson: Record<string, unknown> | null;
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  actionTypes: string[];
  stepTypes: string[];
  scpiCommands: string[];
  warnings: string[];
  errors: string[];
  rawText: string;
};

type ComparisonRow = {
  caseId: string;
  level: string;
  mcp_only?: QualityCapture;
  hosted_multi?: QualityCapture;
};

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gpt-5.4';

if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY to run eval:quality.');
  process.exit(1);
}

function extractTokenUsage(debug: DebugEnvelope['debug']): number | null {
  const rawOutput = debug?.rawOutput as Record<string, unknown> | undefined;
  const usage =
    (rawOutput?.usage as Record<string, unknown> | undefined) ||
    (Array.isArray(rawOutput?.requests)
      ? ((rawOutput?.requests as Array<Record<string, unknown>>).at(-1)?.usage as Record<string, unknown> | undefined)
      : undefined);
  return typeof usage?.total_tokens === 'number' ? usage.total_tokens : null;
}

function extractActionsJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  const marker = raw.match(/ACTIONS_JSON:\s*([\s\S]*)$/i);
  const candidate = (marker?.[1] || raw).trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function flattenSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (items: Array<Record<string, unknown>>) => {
    items.forEach((item) => {
      out.push(item);
      if (Array.isArray(item.children)) {
        walk(item.children as Array<Record<string, unknown>>);
      }
    });
  };
  walk(steps);
  return out;
}

function collectStepsFromActions(actionsJson: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!actionsJson || !Array.isArray(actionsJson.actions)) return [];
  const steps: Array<Record<string, unknown>> = [];
  for (const action of actionsJson.actions as Array<Record<string, unknown>>) {
    const type = String(action.type || action.action_type || '');
    if (type === 'replace_flow') {
      const flow = action.flow && typeof action.flow === 'object' ? (action.flow as Record<string, unknown>) : {};
      if (Array.isArray(flow.steps)) {
        steps.push(...(flow.steps as Array<Record<string, unknown>>));
      }
      continue;
    }
    if (type === 'insert_step_after') {
      const newStep =
        action.newStep && typeof action.newStep === 'object'
          ? (action.newStep as Record<string, unknown>)
          : action.payload && typeof action.payload === 'object' && (action.payload as Record<string, unknown>).newStep && typeof (action.payload as Record<string, unknown>).newStep === 'object'
            ? ((action.payload as Record<string, unknown>).newStep as Record<string, unknown>)
            : null;
      if (newStep) steps.push(newStep);
    }
  }
  return steps;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function normalizePathCode(path: string): string {
  switch (path) {
    case 'shortcut':
      return 'sc';
    case 'build:action':
      return 'ba';
    case 'build:info':
    case 'build:info_fallback':
      return 'bi';
    case 'model':
    case 'model:planner_gap_fill':
    case 'model:json_retry':
    case 'model:shortcut_fallback':
      return 'mod';
    default:
      return path.slice(0, 3) || 'na';
  }
}

function compareCommands(a: string[], b: string[]): string {
  const left = Array.from(new Set(a));
  const right = Array.from(new Set(b));
  if (left.length === right.length && left.every((cmd, index) => cmd === right[index])) {
    return 'YES';
  }
  const rightSet = new Set(right);
  const matches = left.filter((cmd) => rightSet.has(cmd)).length;
  const denom = Math.max(left.length, right.length);
  if (matches === 0) return 'NO';
  if (matches === denom && left.length === right.length) return 'YES';
  return `PARTIAL (${matches}/${denom})`;
}

function summarizeStepsMatch(a: QualityCapture, b: QualityCapture): string {
  return a.appliedSteps === b.appliedSteps ? 'YES' : `NO (${a.appliedSteps}v${b.appliedSteps})`;
}

function captureFromResponse(
  test: BenchmarkCase,
  mode: ModeName,
  payload: ChatResponse,
  debug: DebugEnvelope,
  elapsedMs: number
): QualityCapture {
  const rawText = String(payload.text || payload.displayText || '');
  const actionsJson = extractActionsJsonObject(rawText);
  const normalizedText = (() => {
    const raw = rawText.trim();
    const marker = raw.match(/ACTIONS_JSON:\s*([\s\S]*)$/i);
    return (marker?.[1] || raw).trim();
  })();
  const parsed = aiActionFns.parseAiActionResponse(normalizedText);
  const actionCount =
    parsed?.actions.length ||
    (Array.isArray(actionsJson?.actions) ? (actionsJson.actions as Array<unknown>).length : 0);
  const materializable = parsed?.actions.filter((action) => aiActionFns.canMaterializeAiAction(action)).length || 0;
  const allMaterializable = actionCount > 0 && materializable === actionCount;
  const appliedSteps = allMaterializable
    ? aiActionFns.applyAiActionsToSteps<StepLike>([], parsed?.actions || []).length
    : 0;
  const applyable = allMaterializable && appliedSteps > 0;
  const steps = flattenSteps(collectStepsFromActions(actionsJson));
  const stepTypes = steps.map((step) => String(step.type || ''));
  const scpiCommands = steps
    .filter((step) => ['write', 'query', 'set_and_query'].includes(String(step.type || '').toLowerCase()))
    .map((step) => String((step.params || {}).command || ''))
    .filter(Boolean);
  const queryMissingSaveAs = steps.filter((step) => String(step.type || '').toLowerCase() === 'query' && !String((step.params || {}).saveAs || '').trim()).length;
  const resolutionPath = String(debug.debug?.prompts?.resolutionPath || 'unknown');
  const tokens = extractTokenUsage(debug.debug);
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(String) : [];
  const errors = Array.isArray(payload.errors) ? payload.errors.map(String) : [];
  const actionTypes = Array.isArray(actionsJson?.actions)
    ? (actionsJson?.actions as Array<Record<string, unknown>>).map((action) => String(action.type || action.action_type || ''))
    : [];

  return {
    caseId: test.id,
    level: test.level,
    mode,
    totalMs: typeof payload.metrics?.totalMs === 'number' ? payload.metrics.totalMs : elapsedMs,
    toolCalls: typeof payload.metrics?.toolCalls === 'number' ? payload.metrics.toolCalls : 0,
    iterations: typeof payload.metrics?.iterations === 'number' ? payload.metrics.iterations : 0,
    tokens,
    pass: payload.ok === true && applyable,
    applyable,
    actionCount,
    appliedSteps,
    materializable,
    queryMissingSaveAs,
    resolutionPath,
    actionsJson,
    summary: String(actionsJson?.summary || ''),
    findings: Array.isArray(actionsJson?.findings) ? (actionsJson?.findings as unknown[]).map(String) : [],
    suggestedFixes: Array.isArray(actionsJson?.suggestedFixes) ? (actionsJson?.suggestedFixes as unknown[]).map(String) : [],
    actionTypes,
    stepTypes,
    scpiCommands,
    warnings,
    errors,
    rawText,
  };
}

async function runCase(test: BenchmarkCase, mode: ModeName): Promise<QualityCapture> {
  const requestBody: Record<string, unknown> = {
    userMessage: test.userMessage,
    outputMode: 'steps_json',
    flowContext: test.flowContext,
    runContext: { runStatus: 'idle', logTail: '', auditOutput: '', exitCode: null },
    history: [],
  };

  if (mode === 'mcp_only') {
    requestBody.mode = 'mcp_only';
    requestBody.routerEnabled = false;
    requestBody.routerPreferred = false;
    requestBody.routerOnly = false;
  } else {
    requestBody.mode = 'mcp_ai';
    requestBody.toolCallMode = true;
    requestBody.provider = 'openai';
    requestBody.apiKey = OPENAI_API_KEY;
    requestBody.model = MODEL;
    requestBody.openaiAssistantId = '__SERVER_DEFAULT_ASSISTANT__';
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as ChatResponse;
      if (!response.ok) {
        throw new Error(payload.error || payload.text || payload.displayText || `HTTP ${response.status}`);
      }
      const debug = (await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/debug/last`).then((res) => res.json())) as DebugEnvelope;
      return captureFromResponse(test, mode, payload, debug, Math.round(performance.now() - startedAt));
    } catch (error) {
      lastError = error;
      if (attempt >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function saveReport(reportPath: string, rows: ComparisonRow[]): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const outDir = fileURLToPath(new URL('../reports/', import.meta.url));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(outDir, `quality_comparison_${stamp}.json`);
  const rows = new Map<string, ComparisonRow>();

  for (const test of CASES) {
    rows.set(test.id, { caseId: test.id, level: test.level });
  }

  for (const mode of ['mcp_only', 'hosted_multi'] as ModeName[]) {
    console.log(`\n=== ${mode} ===`);
    for (const test of CASES) {
      const capture = await runCase(test, mode);
      const row = rows.get(test.id)!;
      row[mode] = capture;
      await saveReport(reportPath, Array.from(rows.values()));
      console.log(
        [
          test.id,
          test.level,
          mode,
          capture.pass ? 'PASS' : 'FAIL',
          `applyable:${capture.applyable ? 'yes' : 'no'}`,
          `actions:${capture.actionCount}`,
          `steps:${capture.appliedSteps}`,
          `totalMs:${capture.totalMs}`,
          `path:${capture.resolutionPath}`,
        ].join(' | ')
      );
    }
  }

  const finalRows = Array.from(rows.values());

  console.log('\nCase         | mcp_only      | hosted_multi  | Steps Match | Commands Match');
  let stepsMatchCount = 0;
  let commandsMatchCount = 0;
  let exactMatchCount = 0;

  for (const row of finalRows) {
    const left = row.mcp_only!;
    const right = row.hosted_multi!;
    const stepsMatch = summarizeStepsMatch(left, right);
    const commandsMatch = compareCommands(left.scpiCommands, right.scpiCommands);
    if (stepsMatch === 'YES') stepsMatchCount += 1;
    if (commandsMatch === 'YES') commandsMatchCount += 1;
    const exactMatch =
      stableStringify(left.actionsJson) === stableStringify(right.actionsJson) &&
      left.actionsJson !== null &&
      right.actionsJson !== null;
    if (exactMatch) exactMatchCount += 1;

    console.log(
      `${row.caseId.padEnd(12)} | ` +
      `${`${left.pass ? 'PASS' : 'FAIL'} ${String(left.totalMs)}ms ${normalizePathCode(left.resolutionPath)}`.padEnd(13)} | ` +
      `${`${right.pass ? 'PASS' : 'FAIL'} ${String(right.totalMs)}ms ${normalizePathCode(right.resolutionPath)}`.padEnd(13)} | ` +
      `${stepsMatch.padEnd(11)} | ${commandsMatch}`
    );
  }

  const mcpOnlyRows = finalRows.map((row) => row.mcp_only!);
  const hostedRows = finalRows.map((row) => row.hosted_multi!);
  const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
  const avg = (values: number[]) => (values.length ? Math.round(sum(values) / values.length) : 0);

  const pathBreakdown = (captures: QualityCapture[]) =>
    captures.reduce<Record<string, number>>((acc, capture) => {
      acc[capture.resolutionPath] = (acc[capture.resolutionPath] || 0) + 1;
      return acc;
    }, {});

  console.log('\n=== AGGREGATE ===');
  console.log('                  mcp_only    hosted_multi');
  console.log(`Cases:            ${String(mcpOnlyRows.length).padEnd(10)}${hostedRows.length}`);
  console.log(`Pass:             ${String(mcpOnlyRows.filter((row) => row.pass).length).padEnd(10)}${hostedRows.filter((row) => row.pass).length}`);
  console.log(`Applyable:        ${String(mcpOnlyRows.filter((row) => row.applyable).length).padEnd(10)}${hostedRows.filter((row) => row.applyable).length}`);
  console.log(`Avg latency:      ${String(avg(mcpOnlyRows.map((row) => row.totalMs))) + 'ms'.padEnd(0)}       ${avg(hostedRows.map((row) => row.totalMs))}ms`);
  console.log(`Avg tokens:       ${String(avg(mcpOnlyRows.map((row) => row.tokens || 0))).padEnd(10)}${avg(hostedRows.map((row) => row.tokens || 0))}`);
  console.log(`Total tokens:     ${String(sum(mcpOnlyRows.map((row) => row.tokens || 0))).padEnd(10)}${sum(hostedRows.map((row) => row.tokens || 0))}`);
  console.log(`Steps match:      ${stepsMatchCount}/${finalRows.length}`);
  console.log(`Commands match:   ${commandsMatchCount}/${finalRows.length}`);
  console.log(`Exact match:      ${exactMatchCount}/${finalRows.length}`);

  const mcpBreakdown = pathBreakdown(mcpOnlyRows);
  const hostedBreakdown = pathBreakdown(hostedRows);
  const formatBreakdown = (value: Record<string, number>) =>
    Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])).map(([key, count]) => `${key}:${count}`).join(' ');
  console.log(`Path breakdown:   ${formatBreakdown(mcpBreakdown)}  |  ${formatBreakdown(hostedBreakdown)}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
