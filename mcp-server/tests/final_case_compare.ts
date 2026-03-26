import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import * as aiActions from '../../src/utils/aiActions.ts';

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

type ModeName = 'mcp_only' | 'hosted_multi';

type ExternalCaseRow = {
  id: string;
  level: string;
  userMessage: string;
  expectedBackend?: string;
  expectedDeviceType?: string;
};

type FlowContext = {
  backend: string;
  modelFamily: string;
  deviceType: string;
  steps: Array<Record<string, unknown>>;
  host?: string;
  connectionType?: string;
  selectedStepId?: string | null;
  executionSource?: string;
  alias?: string;
  instrumentMap?: Array<Record<string, unknown>>;
};

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

type Capture = {
  caseId: string;
  level: string;
  prompt: string;
  mode: ModeName;
  pass: boolean;
  applyable: boolean;
  totalMs: number;
  tokens: number | null;
  toolCalls: number;
  iterations: number;
  resolutionPath: string;
  actionCount: number;
  materializable: number;
  appliedSteps: number;
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  warnings: string[];
  errors: string[];
  actionTypes: string[];
  stepTypes: string[];
  scpiCommands: string[];
  tmDeviceCommands: string[];
  actionsJson: Record<string, unknown> | null;
  rawText: string;
};

type ComparisonRow = {
  caseId: string;
  level: string;
  prompt: string;
  mcp_only: Capture;
  hosted_multi: Capture;
  verdict: 'AI better' | 'Local better' | 'Equivalent' | 'Both inadequate';
};

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gpt-5.4';
const CASES_FILE = process.env.BENCH_CASES_FILE || 'tests/case_bank_200.json';
const TARGET_IDS = (process.env.CASE_FILTER || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const BENCH_SAMPLE_SIZE = Number(process.env.BENCH_SAMPLE_SIZE || 0);
const BENCH_SEED = Number(process.env.BENCH_SEED || Date.now());

if (!OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY to run final case compare.');
  process.exit(1);
}

function normalizeBackend(value: string | undefined): string {
  return String(value || 'pyvisa').trim().toLowerCase() === 'tm_devices' ? 'tm_devices' : 'pyvisa';
}

function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function benchmarkGroupKey(row: ExternalCaseRow): string {
  const match = row.id.match(/^(L\d+|GEN)_/i);
  if (match) return match[1].toUpperCase();
  const levelMatch = row.level.match(/Level\s+(\d+)/i);
  if (levelMatch) return `L${levelMatch[1]}`;
  const alpha = row.id.match(/^[A-Z]+/i);
  return (alpha?.[0] || row.id).toUpperCase();
}

function stratifiedSample(rows: ExternalCaseRow[], sampleSize: number, seed: number): ExternalCaseRow[] {
  if (sampleSize <= 0 || sampleSize >= rows.length) return rows;
  const rand = createSeededRandom(seed);
  const groups = new Map<string, ExternalCaseRow[]>();
  rows.forEach((row) => {
    const key = benchmarkGroupKey(row);
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  });
  const keys = Array.from(groups.keys()).sort();
  keys.forEach((key) => shuffleInPlace(groups.get(key) || [], rand));
  const picked: ExternalCaseRow[] = [];
  if (sampleSize >= keys.length) {
    keys.forEach((key) => {
      const first = groups.get(key)?.shift();
      if (first) picked.push(first);
    });
  }
  const leftovers = shuffleInPlace(keys.flatMap((key) => groups.get(key) || []), rand);
  picked.push(...leftovers.slice(0, sampleSize - picked.length));
  return picked.slice(0, sampleSize);
}

function normalizeDeviceType(value: string | undefined): string {
  const raw = String(value || 'SCOPE').trim().toUpperCase();
  if (['SCOPE', 'AFG', 'SMU', 'AWG', 'RSA'].includes(raw)) return raw;
  return 'SCOPE';
}

function buildFlowContextFromCase(row: ExternalCaseRow): FlowContext {
  const backend = normalizeBackend(row.expectedBackend);
  const deviceType = normalizeDeviceType(row.expectedDeviceType);
  const alias =
    deviceType === 'AFG' ? 'afg1'
    : deviceType === 'SMU' ? 'smu1'
    : 'scope1';
  const modelFamily =
    deviceType === 'AFG' ? 'AFG31000'
    : deviceType === 'SMU' ? 'Keithley 2450 SMU'
    : 'MSO4/5/6 Series';
  const deviceDriver =
    deviceType === 'AFG' ? 'AFG31000'
    : deviceType === 'SMU' ? 'Keithley2450'
    : 'MSO6B';

  return {
    backend,
    modelFamily,
    deviceType,
    steps: [],
    host: '127.0.0.1',
    connectionType: 'tcpip',
    selectedStepId: null,
    executionSource: 'steps',
    alias,
    instrumentMap: [
      {
        alias,
        backend,
        host: '127.0.0.1',
        connectionType: 'tcpip',
        deviceType,
        deviceDriver,
        visaBackend: 'system',
      },
    ],
  };
}

function extractTokenUsage(debug: DebugEnvelope['debug']): number | null {
  const rawOutput = debug?.rawOutput as Record<string, unknown> | undefined;
  const usage =
    (rawOutput?.usage as Record<string, unknown> | undefined) ||
    (Array.isArray(rawOutput?.requests)
      ? ((rawOutput.requests as Array<Record<string, unknown>>).at(-1)?.usage as Record<string, unknown> | undefined)
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

function collectStepsFromActions(actionsJson: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (!actionsJson || !Array.isArray(actionsJson.actions)) return [];
  const steps: Array<Record<string, unknown>> = [];
  for (const action of actionsJson.actions as Array<Record<string, unknown>>) {
    const type = String(action.type || action.action_type || '');
    if (type === 'replace_flow') {
      const flow = action.flow && typeof action.flow === 'object' ? (action.flow as Record<string, unknown>) : {};
      if (Array.isArray(flow.steps)) steps.push(...(flow.steps as Array<Record<string, unknown>>));
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

function flattenSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (items: Array<Record<string, unknown>>) => {
    items.forEach((item) => {
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children as Array<Record<string, unknown>>);
    });
  };
  walk(steps);
  return out;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prettyJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function summarizeCommands(left: string[], right: string[]): string {
  const a = Array.from(new Set(left));
  const b = Array.from(new Set(right));
  if (a.length === b.length && a.every((cmd, index) => cmd === b[index])) return 'Exact';
  const rightSet = new Set(b);
  const matches = a.filter((cmd) => rightSet.has(cmd)).length;
  if (matches === 0) return 'None';
  return `Partial (${matches}/${Math.max(a.length, b.length)})`;
}

function classifyRow(local: Capture, hosted: Capture): ComparisonRow['verdict'] {
  if (local.pass && !hosted.pass) return 'Local better';
  if (!local.pass && hosted.pass) return 'AI better';
  if (local.pass && hosted.pass) return 'Equivalent';
  return 'Both inadequate';
}

function captureFromResponse(row: ExternalCaseRow, mode: ModeName, payload: ChatResponse, debug: DebugEnvelope, elapsedMs: number): Capture {
  const rawText = String(payload.text || payload.displayText || '');
  const normalizedText = (() => {
    const raw = rawText.trim();
    const marker = raw.match(/ACTIONS_JSON:\s*([\s\S]*)$/i);
    return (marker?.[1] || raw).trim();
  })();
  const actionsJson = extractActionsJsonObject(rawText);
  const parsed = aiActionFns.parseAiActionResponse(normalizedText);
  const actionCount =
    parsed?.actions.length ||
    (Array.isArray(actionsJson?.actions) ? (actionsJson.actions as Array<unknown>).length : 0);
  const materializable = parsed?.actions.filter((action) => aiActionFns.canMaterializeAiAction(action)).length || 0;
  const allMaterializable = actionCount > 0 && materializable === actionCount;
  const appliedSteps = allMaterializable ? aiActionFns.applyAiActionsToSteps([], parsed?.actions || []).length : 0;
  const applyable = allMaterializable && appliedSteps > 0;
  const steps = flattenSteps(collectStepsFromActions(actionsJson));
  const scpiCommands = steps
    .filter((step) => ['write', 'query', 'set_and_query'].includes(String(step.type || '').toLowerCase()))
    .map((step) => String((step.params || {}).command || ''))
    .filter(Boolean);
  const tmDeviceCommands = steps
    .filter((step) => String(step.type || '').toLowerCase() === 'tm_device_command')
    .map((step) => String((step.params || {}).code || ''))
    .filter(Boolean);
  const actionTypes = Array.isArray(actionsJson?.actions)
    ? (actionsJson.actions as Array<Record<string, unknown>>).map((action) => String(action.type || action.action_type || ''))
    : [];

  return {
    caseId: row.id,
    level: row.level,
    prompt: row.userMessage,
    mode,
    pass: payload.ok === true && applyable,
    applyable,
    totalMs: typeof payload.metrics?.totalMs === 'number' ? payload.metrics.totalMs : elapsedMs,
    tokens: extractTokenUsage(debug.debug),
    toolCalls: typeof payload.metrics?.toolCalls === 'number' ? payload.metrics.toolCalls : 0,
    iterations: typeof payload.metrics?.iterations === 'number' ? payload.metrics.iterations : 0,
    resolutionPath: String(debug.debug?.prompts?.resolutionPath || 'unknown'),
    actionCount,
    materializable,
    appliedSteps,
    summary: String(actionsJson?.summary || ''),
    findings: Array.isArray(actionsJson?.findings) ? (actionsJson.findings as unknown[]).map(String) : [],
    suggestedFixes: Array.isArray(actionsJson?.suggestedFixes) ? (actionsJson.suggestedFixes as unknown[]).map(String) : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
    errors: Array.isArray(payload.errors) ? payload.errors.map(String) : [],
    actionTypes,
    stepTypes: steps.map((step) => String(step.type || '')),
    scpiCommands,
    tmDeviceCommands,
    actionsJson,
    rawText,
  };
}

async function fetchChat(row: ExternalCaseRow, mode: ModeName): Promise<Capture> {
  const requestBody: Record<string, unknown> = {
    userMessage: row.userMessage,
    outputMode: 'steps_json',
    flowContext: buildFlowContextFromCase(row),
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

  const startedAt = performance.now();
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
  return captureFromResponse(row, mode, payload, debug, Math.round(performance.now() - startedAt));
}

async function loadCases(): Promise<ExternalCaseRow[]> {
  const text = await readFile(CASES_FILE, 'utf8');
  const parsed = JSON.parse(text) as ExternalCaseRow[];
  const selected = !TARGET_IDS.length ? parsed : (() => {
    const byId = new Map(parsed.map((row) => [row.id, row]));
    return TARGET_IDS.map((id) => {
      const row = byId.get(id);
      if (!row) throw new Error(`Case not found in ${CASES_FILE}: ${id}`);
      return row;
    });
  })();
  if (BENCH_SAMPLE_SIZE > 0) {
    return stratifiedSample(selected, BENCH_SAMPLE_SIZE, BENCH_SEED);
  }
  return selected;
}

function renderBadge(value: string, cls: string): string {
  return `<span class="badge ${cls}">${escapeHtml(value)}</span>`;
}

function renderList(items: string[], empty = 'None'): string {
  if (!items.length) return `<div class="muted">${escapeHtml(empty)}</div>`;
  return `<ul>${items.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`;
}

function renderTextList(items: string[], empty = 'None'): string {
  if (!items.length) return `<div class="muted">${escapeHtml(empty)}</div>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderCapture(title: string, capture: Capture): string {
  const statusCls = capture.pass ? 'pass' : capture.applyable ? 'warn' : 'fail';
  const combinedCommands = capture.mode === 'mcp_only' ? capture.scpiCommands.concat(capture.tmDeviceCommands) : capture.scpiCommands.concat(capture.tmDeviceCommands);
  return `
    <section class="pane">
      <h3>${escapeHtml(title)}</h3>
      <div class="meta">
        ${renderBadge(capture.pass ? 'PASS' : capture.applyable ? 'APPLYABLE' : 'NO_ACTION', statusCls)}
        ${renderBadge(capture.resolutionPath, 'path')}
        <span><strong>${capture.totalMs}ms</strong></span>
        <span>tokens: <strong>${capture.tokens ?? 0}</strong></span>
        <span>toolCalls: <strong>${capture.toolCalls}</strong></span>
      </div>
      <p><strong>Summary:</strong> ${escapeHtml(capture.summary || 'No summary')}</p>
      <details open>
        <summary>Commands (${combinedCommands.length})</summary>
        ${renderList(combinedCommands, 'No commands')}
      </details>
      <details>
        <summary>Step Types</summary>
        ${renderList(capture.stepTypes, 'No steps')}
      </details>
      <details>
        <summary>Findings</summary>
        ${renderTextList(capture.findings)}
      </details>
      <details>
        <summary>Suggested Fixes</summary>
        ${renderTextList(capture.suggestedFixes)}
      </details>
      <details>
        <summary>Warnings / Errors</summary>
        <div class="split">
          <div><h4>Warnings</h4>${renderTextList(capture.warnings)}</div>
          <div><h4>Errors</h4>${renderTextList(capture.errors)}</div>
        </div>
      </details>
      <details>
        <summary>Parsed ACTIONS_JSON</summary>
        <pre>${prettyJson(capture.actionsJson)}</pre>
      </details>
      <details>
        <summary>Raw Text</summary>
        <pre>${escapeHtml(capture.rawText)}</pre>
      </details>
    </section>
  `;
}

function renderHtml(rows: ComparisonRow[]): string {
  const localPasses = rows.filter((row) => row.mcp_only.pass).length;
  const aiPasses = rows.filter((row) => row.hosted_multi.pass).length;
  const aiRescues = rows.filter((row) => !row.mcp_only.pass && row.hosted_multi.pass).length;
  const localWins = rows.filter((row) => row.mcp_only.pass && !row.hosted_multi.pass).length;
  const bothPass = rows.filter((row) => row.mcp_only.pass && row.hosted_multi.pass).length;
  const bothFail = rows.filter((row) => !row.mcp_only.pass && !row.hosted_multi.pass).length;
  const verdictCounts = {
    aiBetter: rows.filter((row) => row.verdict === 'AI better').length,
    localBetter: rows.filter((row) => row.verdict === 'Local better').length,
    equivalent: rows.filter((row) => row.verdict === 'Equivalent').length,
    bothInadequate: rows.filter((row) => row.verdict === 'Both inadequate').length,
  };
  const timestamp = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Router Final Case Comparison</title>
  <style>
    body { font-family: "Segoe UI", sans-serif; margin: 0; background: #f5f3ee; color: #1f2937; }
    header { padding: 24px 32px; background: linear-gradient(135deg, #153243, #284b63); color: white; }
    main { padding: 24px 32px 48px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0 28px; }
    .card { background: white; border-radius: 14px; padding: 16px 18px; box-shadow: 0 4px 18px rgba(21,50,67,0.08); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 20px; }
    .toolbar button { border: 0; border-radius: 999px; padding: 10px 14px; background: #e2e8f0; color: #153243; font-weight: 700; cursor: pointer; }
    .toolbar button.active { background: #153243; color: white; }
    .case { background: white; border-radius: 16px; padding: 18px; margin-bottom: 18px; box-shadow: 0 6px 24px rgba(21,50,67,0.08); }
    .case h2 { margin: 0 0 6px; font-size: 20px; }
    .prompt { background: #fff7ed; border-left: 4px solid #c2410c; padding: 12px; border-radius: 8px; margin: 12px 0 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .pane { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; background: #fcfcfb; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 10px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0.02em; }
    .pass { background: #dcfce7; color: #166534; }
    .warn { background: #fef3c7; color: #92400e; }
    .fail { background: #fee2e2; color: #991b1b; }
    .path { background: #dbeafe; color: #1d4ed8; }
    .muted { color: #6b7280; }
    pre { white-space: pre-wrap; word-break: break-word; background: #111827; color: #e5e7eb; padding: 12px; border-radius: 10px; overflow: auto; }
    code { font-family: Consolas, monospace; }
    ul { margin: 8px 0 0 18px; }
    details { margin-top: 10px; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .compareline { margin-top: 10px; padding: 10px 12px; background: #eff6ff; border-radius: 8px; }
    @media (max-width: 900px) { .grid, .split { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Router Final Case Comparison</h1>
    <p>Generated ${escapeHtml(timestamp)}. Side-by-side view of local MCP router vs MCP router + AI on the final unresolved case set.</p>
  </header>
  <main>
    <section class="summary">
      <div class="card"><h3>Cases</h3><p><strong>${rows.length}</strong></p></div>
      <div class="card"><h3>Local Pass</h3><p><strong>${localPasses}/${rows.length}</strong></p></div>
      <div class="card"><h3>AI Pass</h3><p><strong>${aiPasses}/${rows.length}</strong></p></div>
      <div class="card"><h3>AI Rescues</h3><p><strong>${aiRescues}</strong></p></div>
      <div class="card"><h3>Local Better</h3><p><strong>${localWins}</strong></p></div>
      <div class="card"><h3>Both Pass</h3><p><strong>${bothPass}</strong></p></div>
      <div class="card"><h3>Both Fail</h3><p><strong>${bothFail}</strong></p></div>
      <div class="card"><h3>Equivalent</h3><p><strong>${verdictCounts.equivalent}</strong></p></div>
      <div class="card"><h3>AI Better</h3><p><strong>${verdictCounts.aiBetter}</strong></p></div>
      <div class="card"><h3>Local Better</h3><p><strong>${verdictCounts.localBetter}</strong></p></div>
      <div class="card"><h3>Both Inadequate</h3><p><strong>${verdictCounts.bothInadequate}</strong></p></div>
    </section>
    <section class="toolbar">
      <button class="active" data-filter="all">All</button>
      <button data-filter="both-pass">Both Pass</button>
      <button data-filter="ai-rescued">AI Rescued</button>
      <button data-filter="local-better">Local Better</button>
      <button data-filter="both-fail">Both Fail</button>
      <button data-filter="verdict-ai-better">AI Better</button>
      <button data-filter="verdict-local-better">Local Better</button>
      <button data-filter="verdict-equivalent">Equivalent</button>
      <button data-filter="verdict-both-inadequate">Both Inadequate</button>
    </section>
    ${rows.map((row) => {
      const filterTags = [
        row.mcp_only.pass && row.hosted_multi.pass ? 'both-pass' : '',
        !row.mcp_only.pass && row.hosted_multi.pass ? 'ai-rescued' : '',
        row.mcp_only.pass && !row.hosted_multi.pass ? 'local-better' : '',
        !row.mcp_only.pass && !row.hosted_multi.pass ? 'both-fail' : '',
        row.verdict === 'AI better' ? 'verdict-ai-better' : '',
        row.verdict === 'Local better' ? 'verdict-local-better' : '',
        row.verdict === 'Equivalent' ? 'verdict-equivalent' : '',
        row.verdict === 'Both inadequate' ? 'verdict-both-inadequate' : '',
      ].filter(Boolean).join(' ');
      return `
      <article class="case" data-tags="${escapeHtml(filterTags)}">
        <h2>${escapeHtml(row.caseId)} <span class="muted">- ${escapeHtml(row.level)}</span></h2>
        <div class="prompt"><strong>Prompt:</strong> ${escapeHtml(row.prompt)}</div>
        <div class="compareline">
          <strong>Verdict:</strong> ${escapeHtml(row.verdict)}<br/>
          <strong>Command overlap:</strong> ${escapeHtml(summarizeCommands(
            row.mcp_only.scpiCommands.concat(row.mcp_only.tmDeviceCommands),
            row.hosted_multi.scpiCommands.concat(row.hosted_multi.tmDeviceCommands)
          ))}
        </div>
        <div class="grid">
          ${renderCapture('MCP Local', row.mcp_only)}
          ${renderCapture('MCP + AI', row.hosted_multi)}
        </div>
      </article>
    `;
    }).join('')}
  </main>
  <script>
    const buttons = Array.from(document.querySelectorAll('[data-filter]'));
    const cases = Array.from(document.querySelectorAll('.case'));
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const filter = button.getAttribute('data-filter');
        for (const b of buttons) b.classList.toggle('active', b === button);
        for (const card of cases) {
          const tags = (card.getAttribute('data-tags') || '').split(/\\s+/).filter(Boolean);
          const show = filter === 'all' || tags.includes(filter);
          card.style.display = show ? '' : 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}

async function writeLandingPage(reportsDir: string, latestHtml: string, latestJson: string): Promise<void> {
  const landing = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Router Reports</title>
  <style>
    body { font-family: "Segoe UI", sans-serif; margin: 0; background: #f5f3ee; color: #1f2937; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 48px; }
    .card { background: white; border-radius: 16px; padding: 18px; margin-bottom: 16px; box-shadow: 0 6px 24px rgba(21,50,67,0.08); }
    a { color: #1d4ed8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { margin: 10px 0 0 18px; }
  </style>
</head>
<body>
  <main>
    <h1>Router Report Index</h1>
    <div class="card">
      <h2>Latest Full Compare</h2>
      <ul>
        <li><a href="${escapeHtml(path.basename(latestHtml))}">${escapeHtml(path.basename(latestHtml))}</a></li>
        <li><a href="${escapeHtml(path.basename(latestJson))}">${escapeHtml(path.basename(latestJson))}</a></li>
      </ul>
    </div>
    <div class="card">
      <h2>Other Key Reports</h2>
      <ul>
        <li><a href="quality_comparison_2026-03-21T10-20-52-357Z.json">quality_comparison_2026-03-21T10-20-52-357Z.json</a></li>
        <li><a href="router_integration_summary.md">router_integration_summary.md</a></li>
        <li><a href="planner_gap_report.md">planner_gap_report.md</a></li>
        <li><a href="planner_gap_implementation_plan.md">planner_gap_implementation_plan.md</a></li>
        <li><a href="build_action_gating_report.md">build_action_gating_report.md</a></li>
      </ul>
    </div>
  </main>
</body>
</html>`;
  await writeFile(path.join(reportsDir, 'index.html'), landing, 'utf8');
}

async function main(): Promise<void> {
  const rows = await loadCases();
  const comparisons: ComparisonRow[] = [];

  console.log(`Running final compare for ${rows.length} case(s) against ${MCP_HOST}${BENCH_SAMPLE_SIZE > 0 ? ` (sample seed ${BENCH_SEED})` : ''}`);
  for (const row of rows) {
    const local = await fetchChat(row, 'mcp_only');
    const hosted = await fetchChat(row, 'hosted_multi');
    comparisons.push({
      caseId: row.id,
      level: row.level,
      prompt: row.userMessage,
      mcp_only: local,
      hosted_multi: hosted,
      verdict: classifyRow(local, hosted),
    });
    console.log(
      `${row.id} | local:${local.pass ? 'PASS' : 'NO'} ${local.totalMs}ms | ai:${hosted.pass ? 'PASS' : 'NO'} ${hosted.totalMs}ms`
    );
  }

  const reportsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reports');
  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, '-');
  const jsonPath = path.join(reportsDir, `final_case_compare_${stamp}.json`);
  const htmlPath = path.join(reportsDir, `final_case_compare_${stamp}.html`);
  await writeFile(jsonPath, `${JSON.stringify(comparisons, null, 2)}\n`, 'utf8');
  await writeFile(htmlPath, renderHtml(comparisons), 'utf8');
  await writeLandingPage(reportsDir, htmlPath, jsonPath);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`HTML report: ${htmlPath}`);
  console.log(`Landing page: ${path.join(reportsDir, 'index.html')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
