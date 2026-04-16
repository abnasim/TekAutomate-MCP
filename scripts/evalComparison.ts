/* eslint-disable no-console */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { parseAiActionResponse, applyAiActionsToSteps, type StepLike } from '../src/utils/aiActions';
import { genStepsClassic, type Step as GeneratorStep, type GeneratorContext, DEFAULT_CONTEXT } from '../src/generators/appGenerator';
import { initCommandIndex, getCommandIndex } from '../mcp-server/src/core/commandIndex';

interface GoldenCase {
  testId: string;
  prompt: string;
  source?: string;
  timestamp?: string;
  steps: StepLike[];
  notes?: string;
}

interface EvalScore {
  hasCorrectStructure: boolean;
  allQueryHaveSaveAs: boolean;
  noUnresolvedTemplates: boolean;
  commandsVerified: number;
  commandsTotal: number;
  verifiedPercent: number;
  executionPassed: boolean;
  exitCode: number;
  hasErrorInOutput: boolean;
  hasRequiredStepTypes: boolean;
  hasRequiredCommands: boolean;
  stepCount: number;
  totalScore: number;
}

interface ExecutionResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

interface PromptCase {
  testId: string;
  prompt: string;
  requiredStepTypes: string[];
  requiredCommands: string[];
}

interface EvalRow {
  testId: string;
  prompt: string;
  gpt?: EvalScore;
  mcp: EvalScore;
  winner: 'GPT' | 'MCP' | 'Tie' | 'MCP-only';
  keyDifference: string;
  notes: string[];
}

const ROOT = resolve(__dirname, '..');
const GOLDEN_DIR = join(ROOT, 'e2e', 'gpt-golden');
const OUTPUT_DIR = join(ROOT, 'e2e-output', 'eval');
const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const EXECUTOR_URL = process.env.EXECUTOR_URL || 'http://192.168.1.105:8765';
const SCOPE_HOST = process.env.SCOPE_HOST || '192.168.1.105';
const PROVIDER = (process.env.EVAL_PROVIDER || 'openai').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
const API_KEY = PROVIDER === 'anthropic'
  ? (process.env.ANTHROPIC_API_KEY || '')
  : (process.env.OPENAI_API_KEY || '');
const MODEL = process.env.EVAL_MODEL || (PROVIDER === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4o');
const RUN_EXECUTION = process.env.EVAL_RUN_EXECUTION !== 'false';

const QUICK_PROMPTS: PromptCase[] = [
  {
    testId: 'QW1',
    prompt:
      'Add FastFrame for 50 frames, measure frequency and amplitude on CH1 and CH2, take a screenshot',
    requiredStepTypes: ['write', 'query', 'save_screenshot'],
    requiredCommands: ['FASTframe:STATE', 'FASTframe:COUNt', 'MEASUrement:ADDMEAS'],
  },
  {
    testId: 'QW2',
    prompt: 'Set up CAN FD bus decode on B1 at 500kbps, data source CH2',
    requiredStepTypes: ['write'],
    requiredCommands: ['BUS', 'CAN'],
  },
  {
    testId: 'QW3',
    prompt: 'Save CH1 CH2 CH3 CH4 waveforms as .wfm files, save setup, screenshot, zip to session.tss',
    requiredStepTypes: ['write', 'save_waveform', 'save_screenshot', 'python'],
    requiredCommands: ['SAVe:WAVEform', 'SAVe:SETUp'],
  },
];

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function flattenSteps(steps: StepLike[]): StepLike[] {
  const out: StepLike[] = [];
  const walk = (arr: StepLike[]) => {
    for (const s of arr) {
      out.push(s);
      if (Array.isArray(s.children) && s.children.length) walk(s.children);
    }
  };
  walk(steps);
  return out;
}

function extractCommands(steps: StepLike[]): string[] {
  const flat = flattenSteps(steps);
  const cmds: string[] = [];
  for (const s of flat) {
    if (!s.params || typeof s.params !== 'object') continue;
    if (s.type === 'write' || s.type === 'query' || s.type === 'set_and_query') {
      const cmd = s.params.command;
      if (typeof cmd === 'string' && cmd.trim()) cmds.push(cmd.trim());
    }
  }
  return cmds;
}

function hasTemplateLeak(steps: StepLike[]): boolean {
  const cmds = extractCommands(steps);
  return cmds.some((cmd) => /\$\{[^}]+\}/.test(cmd) || /<[^>]+>/.test(cmd));
}

async function verifyCommands(steps: StepLike[]): Promise<{ verified: number; total: number }> {
  const idx = await getCommandIndex();
  const cmds = extractCommands(steps);
  let verified = 0;
  for (const cmd of cmds) {
    const header = cmd.trim().split(/\s+/)[0];
    if (idx.getByHeader(header)) verified += 1;
  }
  return { verified, total: cmds.length };
}

function checkCorrectStructure(steps: StepLike[]): boolean {
  if (!steps.length) return false;
  const first = steps[0]?.type;
  const last = steps[steps.length - 1]?.type;
  return first === 'connect' && last === 'disconnect';
}

function allQueriesHaveSaveAs(steps: StepLike[]): boolean {
  return flattenSteps(steps)
    .filter((s) => s.type === 'query')
    .every((q) => typeof q.params?.saveAs === 'string' && q.params.saveAs.trim().length > 0);
}

function matchesRequiredStepTypes(steps: StepLike[], required: string[]): boolean {
  const types = new Set(flattenSteps(steps).map((s) => s.type));
  return required.every((r) => types.has(r));
}

function matchesRequiredCommands(steps: StepLike[], required: string[]): boolean {
  const cmds = extractCommands(steps).join('\n').toUpperCase();
  return required.every((r) => cmds.includes(r.toUpperCase()));
}

function scoreTotal(raw: Omit<EvalScore, 'totalScore'>): number {
  let score = 0;
  if (raw.hasCorrectStructure) score += 2;
  if (raw.allQueryHaveSaveAs) score += 1;
  if (raw.noUnresolvedTemplates) score += 1;
  if (raw.verifiedPercent > 80) score += 2;
  if (raw.executionPassed) score += 3;
  if (raw.hasRequiredCommands) score += 1;
  return score;
}

function buildPythonScript(steps: StepLike[]): string {
  const ctx: GeneratorContext = {
    ...DEFAULT_CONTEXT,
    enablePrintMessages: true,
  };
  const body = genStepsClassic(steps as unknown as GeneratorStep[], ctx, '    ');
  return `import pathlib\nimport time\nimport pyvisa\n\nrm = pyvisa.ResourceManager()\nscpi = rm.open_resource("TCPIP::${SCOPE_HOST}::INSTR")\nscpi.timeout = 30000\nscpi.write_termination = "\\n"\nscpi.read_termination = None\n\nprint(scpi.query("*IDN?").strip())\n\ndef log_cmd(cmd, resp):\n    pass\n\ntry:\n${body}\n    try:\n        print("ALLEV:", scpi.query("ALLEV?").strip())\n    except Exception:\n        pass\nfinally:\n    scpi.close()\n    rm.close()\n`;
}

async function runOnExecutor(steps: StepLike[]): Promise<ExecutionResult> {
  if (!RUN_EXECUTION) {
    return { ok: false, exitCode: -1, stdout: '', stderr: '', error: 'execution skipped' };
  }
  try {
    const code = buildPythonScript(steps);
    const res = await fetch(`${EXECUTOR_URL.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action: 'run_python',
        code,
        timeout_sec: 180,
      }),
    });
    if (!res.ok) {
      return { ok: false, exitCode: -1, stdout: '', stderr: '', error: `executor HTTP ${res.status}` };
    }
    const payload = (await res.json()) as Record<string, unknown>;
    const stdout = String(payload.stdout || '');
    const stderr = String(payload.stderr || '');
    const exitCode = Number(payload.exit_code ?? payload.exitCode ?? (payload.ok ? 0 : 1));
    return { ok: Boolean(payload.ok), exitCode, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseSseToText(sse: string): { text: string; error?: string } {
  const events = sse.split('\n\n');
  let text = '';
  let error: string | undefined;
  for (const ev of events) {
    const event = ev.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = ev
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.replace(/^data:\s?/, ''))
      .join('\n');
    if (!data) continue;
    if (event === 'chunk') text += data;
    if (event === 'error') error = data;
  }
  return { text, error };
}

function tryParseResult(text: string) {
  const extractFirstJsonObject = (input: string): string | null => {
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
  };

  const direct = parseAiActionResponse(text);
  if (direct) return direct;
  const tagged = text.match(/ACTIONS_JSON:\s*([\s\S]*?)$/i);
  if (tagged?.[1]) {
    const parsed = parseAiActionResponse(tagged[1].trim());
    if (parsed) return parsed;
    const extracted = extractFirstJsonObject(tagged[1]);
    if (extracted) {
      const parsedExtracted = parseAiActionResponse(extracted);
      if (parsedExtracted) return parsedExtracted;
    }
  }
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = parseAiActionResponse(fenced[1].trim());
    if (parsed) return parsed;
  }
  return null;
}

function actionsToSteps(actions: ReturnType<typeof parseAiActionResponse> extends infer T ? T extends { actions: infer A } ? A : never : never): StepLike[] {
  const replace = (actions as any[]).find((a) => a.action_type === 'replace_flow');
  const payloadSteps = replace?.payload?.steps;
  if (Array.isArray(payloadSteps) && payloadSteps.length) {
    return payloadSteps as StepLike[];
  }
  return applyAiActionsToSteps<StepLike>([], actions as any);
}

async function callMcp(prompt: string): Promise<{ steps: StepLike[]; rawText: string; error?: string }> {
  if (!API_KEY) {
    throw new Error(PROVIDER === 'anthropic' ? 'ANTHROPIC_API_KEY is required' : 'OPENAI_API_KEY is required');
  }
  const payload = {
    userMessage: prompt,
    outputMode: 'steps_json',
    provider: PROVIDER,
    apiKey: API_KEY,
    model: MODEL,
    flowContext: {
      backend: 'pyvisa',
      host: SCOPE_HOST,
      connectionType: 'lan',
      modelFamily: 'mso_5_series',
      steps: [],
      selectedStepId: null,
      executionSource: 'steps',
    },
    runContext: {
      runStatus: 'idle',
      logTail: '',
      auditOutput: '',
      exitCode: 0,
      duration: '',
    },
    instrumentEndpoint: {
      executorUrl: EXECUTOR_URL,
      visaResource: `TCPIP::${SCOPE_HOST}::INSTR`,
      backend: 'pyvisa',
    },
  };
  const res = await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const sse = await res.text();
  const parsed = parseSseToText(sse);
  const result = tryParseResult(parsed.text);
  const steps = result ? actionsToSteps(result.actions) : [];
  return { steps, rawText: parsed.text, error: parsed.error };
}

function loadGoldenCases(): GoldenCase[] {
  if (!existsSync(GOLDEN_DIR)) return [];
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.toLowerCase().endsWith('.json'));
  const out: GoldenCase[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf8')) as GoldenCase;
      if (data?.testId && data?.prompt && Array.isArray(data?.steps)) out.push(data);
    } catch {
      // ignore malformed
    }
  }
  return out.sort((a, b) => a.testId.localeCompare(b.testId));
}

async function evaluateOne(steps: StepLike[], requirements: PromptCase): Promise<{ score: EvalScore; exec: ExecutionResult }> {
  const { verified, total } = await verifyCommands(steps);
  const verifiedPercent = total ? (verified / total) * 100 : 100;
  const exec = await runOnExecutor(steps);
  const hasErrorInOutput = /Traceback|Invalid|UNCAUGHT|Exception/i.test(`${exec.stdout}\n${exec.stderr}`);

  const raw: Omit<EvalScore, 'totalScore'> = {
    hasCorrectStructure: checkCorrectStructure(steps),
    allQueryHaveSaveAs: allQueriesHaveSaveAs(steps),
    noUnresolvedTemplates: !hasTemplateLeak(steps),
    commandsVerified: verified,
    commandsTotal: total,
    verifiedPercent: Math.round(verifiedPercent * 100) / 100,
    executionPassed: exec.ok && exec.exitCode === 0 && !hasErrorInOutput,
    exitCode: exec.exitCode,
    hasErrorInOutput,
    hasRequiredStepTypes: matchesRequiredStepTypes(steps, requirements.requiredStepTypes),
    hasRequiredCommands: matchesRequiredCommands(steps, requirements.requiredCommands),
    stepCount: steps.length,
  };
  return { score: { ...raw, totalScore: scoreTotal(raw) }, exec };
}

function requirementFor(testId: string, prompt: string): PromptCase {
  const byId = QUICK_PROMPTS.find((x) => x.testId === testId);
  if (byId) return byId;
  return { testId, prompt, requiredStepTypes: ['connect', 'disconnect'], requiredCommands: [] };
}

async function main() {
  await initCommandIndex();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = nowStamp();
  const golden = loadGoldenCases();
  const cases: PromptCase[] = golden.length
    ? golden.map((g) => ({ ...requirementFor(g.testId, g.prompt), testId: g.testId, prompt: g.prompt }))
    : QUICK_PROMPTS;

  const rows: EvalRow[] = [];
  const logs: string[] = [];

  for (const tc of cases) {
    console.log(`Running ${tc.testId}: ${tc.prompt}`);
    const mcp = await callMcp(tc.prompt);
    const mcpEval = await evaluateOne(mcp.steps, tc);
    const row: EvalRow = {
      testId: tc.testId,
      prompt: tc.prompt,
      mcp: mcpEval.score,
      winner: 'MCP-only',
      keyDifference: mcp.error ? `MCP error: ${mcp.error}` : 'No golden baseline loaded',
      notes: [],
    };

    if (mcp.error) row.notes.push(`MCP error: ${mcp.error}`);
    if (!mcp.steps.length) row.notes.push('No apply-ready steps parsed from MCP response');

    const g = golden.find((x) => x.testId === tc.testId);
    if (g) {
      const gEval = await evaluateOne(g.steps, tc);
      row.gpt = gEval.score;
      if (gEval.score.totalScore > mcpEval.score.totalScore) row.winner = 'GPT';
      else if (gEval.score.totalScore < mcpEval.score.totalScore) row.winner = 'MCP';
      else row.winner = 'Tie';
      row.keyDifference = `GPT ${gEval.score.totalScore}/10 vs MCP ${mcpEval.score.totalScore}/10`;
      if (!mcpEval.score.executionPassed && gEval.score.executionPassed) {
        row.notes.push('Execution failed on MCP but passed on GPT');
      }
      if (!gEval.score.executionPassed && mcpEval.score.executionPassed) {
        row.notes.push('Execution failed on GPT but passed on MCP');
      }
    }
    rows.push(row);

    logs.push(
      `## ${tc.testId}`,
      `Prompt: ${tc.prompt}`,
      `MCP score: ${mcpEval.score.totalScore}/10`,
      `MCP execution: ok=${mcpEval.exec.ok} exit=${mcpEval.exec.exitCode}`,
      mcp.error ? `MCP error: ${mcp.error}` : '',
      ''
    );
  }

  const tableHeader = `| Test | Prompt Summary | GPT | MCP | Winner | Key Difference |\n|------|----------------|-----|-----|--------|----------------|`;
  const tableRows = rows.map((r) => {
    const shortPrompt = r.prompt.length > 40 ? `${r.prompt.slice(0, 37)}...` : r.prompt;
    const g = r.gpt ? `${r.gpt.totalScore}/10` : 'N/A';
    const m = `${r.mcp.totalScore}/10`;
    return `| ${r.testId} | ${shortPrompt} | ${g} | ${m} | ${r.winner} | ${r.keyDifference} |`;
  });

  const report = [
    '# TekAutomate AI Comparison Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `MCP: ${MCP_HOST}`,
    `Executor: ${EXECUTOR_URL}`,
    `Scope: ${SCOPE_HOST}`,
    `Provider: ${PROVIDER}`,
    `Model: ${MODEL}`,
    golden.length ? `Golden cases loaded: ${golden.length}` : 'Golden cases loaded: 0 (quick-win mode)',
    '',
    '## Comparison Table',
    tableHeader,
    ...tableRows,
    '',
    '## Notes',
    ...rows.flatMap((r) => (r.notes.length ? [`- ${r.testId}: ${r.notes.join(' | ')}`] : [])),
    '',
    '## Per-case Log',
    ...logs,
  ].join('\n');

  const mdPath = join(OUTPUT_DIR, `comparison_${stamp}.md`);
  const jsonPath = join(OUTPUT_DIR, `comparison_${stamp}.json`);
  writeFileSync(mdPath, report, 'utf8');
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Report written: ${mdPath}`);
  console.log(`Data written: ${jsonPath}`);
}

main().catch((err) => {
  console.error('evalComparison failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
