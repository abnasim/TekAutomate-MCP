import { performance } from 'perf_hooks';
import { mkdir, readFile, writeFile } from 'fs/promises';
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
const BENCH_CASES_FILE = process.env.BENCH_CASES_FILE || '';
const BENCH_MODE = (process.env.BENCH_MODE || (OPENAI_API_KEY ? 'hosted_multi' : 'mcp_only')).toLowerCase();

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MAX_CASES = parseEnvNumber(process.env.MAX_CASES, 0);
const BENCH_SAMPLE_SIZE = parseEnvNumber(process.env.BENCH_SAMPLE_SIZE, 0);
const BENCH_SEED = parseEnvNumber(process.env.BENCH_SEED, Date.now());

if (BENCH_MODE !== 'mcp_only' && !OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY to run hosted benchmark mode, or use BENCH_MODE=mcp_only.');
  process.exit(1);
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

function benchmarkGroupKey(test: BenchmarkCase): string {
  const match = test.id.match(/^(L\d+)_/i);
  if (match) return match[1].toUpperCase();
  const alpha = test.id.match(/^[A-Z]+/i);
  return (alpha?.[0] || test.id).toUpperCase();
}

function stratifiedSample(rows: BenchmarkCase[], sampleSize: number, seed: number): BenchmarkCase[] {
  if (sampleSize <= 0 || sampleSize >= rows.length) return rows;

  const rand = createSeededRandom(seed);
  const groups = new Map<string, BenchmarkCase[]>();
  rows.forEach((row) => {
    const key = benchmarkGroupKey(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  });

  const orderedKeys = Array.from(groups.keys()).sort();
  orderedKeys.forEach((key) => {
    shuffleInPlace(groups.get(key) || [], rand);
  });

  const picked: BenchmarkCase[] = [];
  const pickedIds = new Set<string>();
  const canCoverAllGroups = sampleSize >= orderedKeys.length;

  if (canCoverAllGroups) {
    orderedKeys.forEach((key) => {
      const first = groups.get(key)?.shift();
      if (!first) return;
      picked.push(first);
      pickedIds.add(first.id);
    });
  }

  let remainingSlots = sampleSize - picked.length;
  if (remainingSlots <= 0) {
    return picked.slice(0, sampleSize);
  }

  const remainingCounts = orderedKeys.map((key) => ({
    key,
    available: (groups.get(key) || []).length,
  }));
  const totalRemaining = remainingCounts.reduce((sum, entry) => sum + entry.available, 0);

  if (totalRemaining > 0) {
    const allocations = remainingCounts.map((entry) => {
      const exact = (entry.available / totalRemaining) * remainingSlots;
      const base = Math.min(entry.available, Math.floor(exact));
      return {
        key: entry.key,
        available: entry.available,
        base,
        remainder: exact - Math.floor(exact),
      };
    });

    let assigned = allocations.reduce((sum, entry) => sum + entry.base, 0);
    const byRemainder = [...allocations].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.key.localeCompare(b.key);
    });

    while (assigned < remainingSlots) {
      let progressed = false;
      for (const entry of byRemainder) {
        const target = allocations.find((item) => item.key === entry.key);
        if (!target) continue;
        if (target.base >= target.available) continue;
        target.base += 1;
        assigned += 1;
        progressed = true;
        if (assigned >= remainingSlots) break;
      }
      if (!progressed) break;
    }

    allocations.forEach((entry) => {
      const bucket = groups.get(entry.key) || [];
      picked.push(...bucket.splice(0, entry.base));
    });
  }

  remainingSlots = sampleSize - picked.length;
  if (remainingSlots > 0) {
    const leftovers = shuffleInPlace(
      orderedKeys.flatMap((key) => groups.get(key) || []).filter((row) => !pickedIds.has(row.id)),
      rand
    );
    picked.push(...leftovers.slice(0, remainingSlots));
  }

  return picked.slice(0, sampleSize);
}

function selectedCases(allCases: BenchmarkCase[]): { rows: BenchmarkCase[]; sampleSeed: number | null; sourceCount: number } {
  const caseSet = new Set(
    CASE_FILTER.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => CASE_ALIASES[id] || id)
  );
  const levelSet = new Set(LEVEL_FILTER.split(',').map((s) => s.trim()).filter(Boolean));
  let rows = allCases.filter((test) => {
    if (caseSet.size && !caseSet.has(test.id)) return false;
    if (levelSet.size && !levelSet.has(test.level)) return false;
    return true;
  });
  const sourceCount = rows.length;
  if (BENCH_SAMPLE_SIZE > 0) {
    rows = stratifiedSample(rows, BENCH_SAMPLE_SIZE, BENCH_SEED);
    return { rows, sampleSeed: BENCH_SEED, sourceCount };
  }
  if (MAX_CASES > 0) rows = rows.slice(0, MAX_CASES);
  return { rows, sampleSeed: null, sourceCount };
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
    prompts?: {
      resolutionPath?: string;
    };
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
  resolutionPath: string;
  tools: string[];
  errors: string[];
  warnings: string[];
  preview?: string;
  quality: QualityResult;
};

type QualityBucket =
  | 'WRONG_COMMANDS'
  | 'MISSING_COMMANDS'
  | 'WRONG_ORDER'
  | 'WRONG_STEP_TYPE'
  | 'DISAGREEMENT'
  | 'HARD_FEATURE'
  | 'CORRECT';

type QualityResult = {
  score: 0 | 1 | 2 | 3;
  bucket: QualityBucket;
  notes: string;
};

type QualityExpectation = {
  requiredCommands?: string[];
  requiredStepTypes?: string[];
  orderedCommands?: string[];
  hardFeature?: boolean;
};

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
      if (Array.isArray(item.children)) walk(item.children as Array<Record<string, unknown>>);
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

const QUALITY_EXPECTATIONS: Record<string, QualityExpectation> = {
  L1_BAS_01: { requiredCommands: ['*IDN?'], requiredStepTypes: ['query'] },
  L1_BAS_02: { requiredCommands: ['*RST', '*OPC?', '*CLS'] },
  L1_BAS_03: { requiredStepTypes: ['save_screenshot'] },
  L1_BAS_04: { requiredStepTypes: ['save_waveform'] },
  L1_BAS_05: { requiredCommands: ['*ESR?'] },
  L2_MEA_01: { requiredCommands: ['MEASUrement:ADDMEAS FREQUENCY', 'MEASUrement:ADDMEAS AMPLITUDE'] },
  L2_MEA_02: { requiredCommands: ['MEASUrement:ADDMEAS RISETIME', 'MEASUrement:ADDMEAS FALLTIME', 'MEASUrement:ADDMEAS PK2PK', 'MEASUrement:ADDMEAS MEAN'] },
  L2_MEA_03: { requiredCommands: ['MEASUrement:ADDMEAS POVERSHOOT', 'MEASUrement:ADDMEAS NOVERSHOOT', 'MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?', 'MEASUrement:MEAS2:RESUlts:CURRentacq:MEAN?'] },
  L3_CHT_01: { requiredCommands: ['CH1:SCAle 0.5', 'CH1:COUPling DC', 'CH1:TERmination 50'] },
  L3_CHT_02: { requiredCommands: ['CH1:SCAle 1', 'CH1:COUPling DC', 'CH2:SCAle 0.5', 'CH2:COUPling AC'] },
  L3_CHT_03: { requiredCommands: ['TRIGger:A:EDGE:SOUrce CH1', 'TRIGger:A:EDGE:SLOpe RISe', 'TRIGger:A:LEVel 1', 'TRIGger:A:MODe NORMal'] },
  L3_CHT_04: { requiredCommands: ['TRIGger:A:HOLDoff:TIMe 0.05', 'TRIGger:A:MODe AUTO'] },
  L4_BUS_01: { requiredCommands: ['BUS:B1:TYPe I2C', 'BUS:B1:I2C:CLOCk:SOUrce CH1', 'BUS:B1:I2C:DATa:SOUrce CH2'] },
  L4_BUS_02: { requiredCommands: ['BUS:B1:TYPe CAN', 'BUS:B1:CAN:SOUrce CH2', 'BUS:B1:CAN:BITRate 500000'] },
  L4_BUS_03: { requiredCommands: ['BUS:B1:TYPe RS232C', 'BUS:B1:RS232C:SOUrce CH1'] },
  L4_BUS_04: { requiredCommands: ['BUS:B1:TYPe CAN', 'SEARCH:SEARCH1:TYPe BUS'] },
  L5_SAV_01: { requiredCommands: ['RECAll:SETUp "C:/tests/baseline.tss"', 'MEASUrement:ADDMEAS FREQUENCY'] },
  L5_SAV_02: { requiredCommands: ['SAVe:SETUp "C:/setups/test.set"'], requiredStepTypes: ['save_screenshot'] },
  L5_SAV_03: { requiredCommands: ['HORizontal:FASTframe:STATE ON', 'HORizontal:FASTframe:COUNt 100'], requiredStepTypes: ['save_waveform'] },
  L6_TMD_01: { requiredStepTypes: ['tm_device_command'] },
  L6_TMD_02: { requiredStepTypes: ['tm_device_command'] },
  L7_CPX_01: { requiredCommands: ['CH1:SCAle 1', 'TRIGger:A:EDGE:SOUrce CH1', 'ACQuire:STOPAfter SEQuence'], orderedCommands: ['TRIGger:A:EDGE:SOUrce CH1', 'ACQuire:STOPAfter SEQuence'] },
  L7_CPX_02: { requiredCommands: ['*RST', '*OPC?', '*CLS', 'save_screenshot'], orderedCommands: ['*RST', '*OPC?', '*CLS'] },
  L7_CPX_03: { requiredCommands: ['RECAll:SETUp "C:/tests/baseline.tss"', 'MEASUrement:ADDMEAS AMPLITUDE'], requiredStepTypes: ['save_waveform', 'save_screenshot'] },
  L7_CPX_04: { requiredCommands: ['BUS:B1:TYPe CAN', 'TRIGger:A:EDGE:SOUrce CH2'], requiredStepTypes: ['save_screenshot'] },
  L8_ENG_01: { requiredCommands: ['CH1:SCAle 0.05', 'MEASUrement:ADDMEAS MEAN', 'MEASUrement:ADDMEAS RMS', 'MEASUrement:ADDMEAS PK2PK'] },
  L8_ENG_02: { requiredCommands: ['MEASUrement:ADDMEAS POVERSHOOT', 'MEASUrement:ADDMEAS FREQUENCY'], requiredStepTypes: ['save_waveform'] },
  L8_ENG_03: { requiredCommands: ['BUS:B1:TYPe CAN', 'BUS:B1:CAN:BITRate 500000'] },
  L8_ENG_04: { requiredCommands: ['SEARCH:SEARCH1:TYPe BUS'], hardFeature: true },
  L8_ENG_05: { requiredCommands: ['CH1:SCAle 3.3', 'CH2:SCAle 3.3', 'BUS:B1:TYPe I2C'] },
  L8_ENG_06: { requiredCommands: ['MEASUrement:ADDMEAS SETUP'] },
  L8_ENG_07: { requiredCommands: ['MEASUrement:ADDMEAS HOLD'] },
  L8_ENG_08: { requiredCommands: ['HORizontal:MODE:SCAle 5e-10', 'HORizontal:MODE:RECOrdlength 10000000'] },
  L8_ENG_09: { requiredCommands: ['ACQuire:MODe FASTAcq'], requiredStepTypes: ['save_screenshot'], hardFeature: true },
  L8_ENG_10: { requiredCommands: ['CH4:SCAle 2', 'TRIGger:A:EDGE:SOUrce CH4', 'ACQuire:STOPAfter SEQuence'] },
  L8_ENG_11: { requiredCommands: ['MEASUrement:ADDMEAS DELAY', 'MEASUrement:MEAS1:SOUrce1 CH4', 'MEASUrement:MEAS1:SOUrce2 CH1'] },
  L8_ENG_12: { requiredCommands: ['MEASUrement:ADDMEAS DELAY', 'MEASUrement:MEAS1:SOUrce1 CH4'], hardFeature: true },
  L8_ENG_13: { requiredStepTypes: ['save_waveform', 'save_screenshot'] },
  AFG01: { requiredCommands: ['SOURce1:FUNCtion SIN', 'SOURce1:FREQuency 1000', 'OUTPut1:STATe ON'] },
  SMU01: { requiredCommands: ['SOURce:FUNCtion VOLTage', 'SOURce:VOLTage 3.3'], hardFeature: true },
};

function includesPattern(haystack: string[], pattern: string): boolean {
  const needle = pattern.toLowerCase();
  return haystack.some((item) => String(item || '').toLowerCase().includes(needle));
}

function scoreQuality(
  test: BenchmarkCase,
  responseText: string,
  applyability: {
    parsed: boolean;
    actions: number;
    chatUiApplicable: boolean;
    materializableActions: number;
    appliedSteps: number;
  }
): QualityResult {
  const actionsJson = extractActionsJsonObject(responseText);
  const steps = flattenSteps(collectStepsFromActions(actionsJson));
  const stepTypes = steps.map((step) => String(step.type || '').toLowerCase());
  const scpiCommands = steps
    .filter((step) => ['write', 'query', 'set_and_query'].includes(String(step.type || '').toLowerCase()))
    .map((step) => String((step.params || {}).command || ''))
    .filter(Boolean);
  const tmCodes = steps
    .filter((step) => String(step.type || '').toLowerCase() === 'tm_device_command')
    .map((step) => String((step.params || {}).code || ''))
    .filter(Boolean);
  const commandCorpus = [...scpiCommands, ...tmCodes];
  const expectation = QUALITY_EXPECTATIONS[test.id];

  if (!applyability.parsed || commandCorpus.length === 0 && stepTypes.length === 0) {
    return {
      score: 0,
      bucket: expectation?.hardFeature ? 'HARD_FEATURE' : 'WRONG_COMMANDS',
      notes: expectation?.hardFeature ? 'No usable output for a hard-feature case.' : 'Empty or non-parseable output.',
    };
  }

  if (!expectation) {
    return {
      score: applyability.chatUiApplicable ? 2 : 1,
      bucket: 'DISAGREEMENT',
      notes: 'No explicit expectation map for this case yet.',
    };
  }

  const missingCommands = (expectation.requiredCommands || []).filter((pattern) => !includesPattern(commandCorpus, pattern));
  const missingTypes = (expectation.requiredStepTypes || []).filter((pattern) => !stepTypes.includes(pattern.toLowerCase()));
  const ordered = expectation.orderedCommands || [];
  const wrongOrder = ordered.length > 1
    ? ordered.some((pattern, index) => {
        if (index === ordered.length - 1) return false;
        const currentIndex = commandCorpus.findIndex((item) => item.toLowerCase().includes(pattern.toLowerCase()));
        const nextIndex = commandCorpus.findIndex((item) => item.toLowerCase().includes(ordered[index + 1].toLowerCase()));
        return currentIndex >= 0 && nextIndex >= 0 && currentIndex > nextIndex;
      })
    : false;

  if (!missingCommands.length && !missingTypes.length && !wrongOrder) {
    return { score: 3, bucket: 'CORRECT', notes: 'All expected command and step patterns are present.' };
  }

  if (wrongOrder) {
    return { score: 2, bucket: 'WRONG_ORDER', notes: `Commands present but sequencing is wrong for ${ordered.join(' -> ')}.` };
  }

  if (missingTypes.length && !missingCommands.length) {
    return { score: 2, bucket: 'WRONG_STEP_TYPE', notes: `Missing required step types: ${missingTypes.join(', ')}.` };
  }

  const missingCount = missingCommands.length + missingTypes.length;
  if (missingCount <= 2 && applyability.chatUiApplicable) {
    return { score: 2, bucket: expectation.hardFeature ? 'HARD_FEATURE' : 'MISSING_COMMANDS', notes: `Mostly correct but missing: ${[...missingCommands, ...missingTypes].join(', ')}.` };
  }

  if (missingCount > 0 && commandCorpus.length > 0) {
    return { score: 1, bucket: expectation.hardFeature ? 'HARD_FEATURE' : 'MISSING_COMMANDS', notes: `Partial output; missing key pieces: ${[...missingCommands, ...missingTypes].join(', ')}.` };
  }

  return { score: 0, bucket: expectation.hardFeature ? 'HARD_FEATURE' : 'WRONG_COMMANDS', notes: 'Output exists but does not match expected command family.' };
}

type ExternalCaseRow = {
  id: string;
  level: string;
  userMessage: string;
  expectedBackend?: string;
  expectedDeviceType?: string;
};

function normalizeBackend(value: string | undefined): string {
  return String(value || 'pyvisa').trim().toLowerCase() === 'tm_devices' ? 'tm_devices' : 'pyvisa';
}

function normalizeDeviceType(value: string | undefined): string {
  const raw = String(value || 'SCOPE').trim().toUpperCase();
  if (['SCOPE', 'AFG', 'SMU', 'AWG', 'RSA'].includes(raw)) return raw;
  return 'SCOPE';
}

function buildFlowContextFromCase(row: ExternalCaseRow): BenchmarkCase['flowContext'] {
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

async function loadBenchCases(): Promise<BenchmarkCase[]> {
  if (!BENCH_CASES_FILE) return CASES;
  const text = await readFile(BENCH_CASES_FILE, 'utf8');
  const parsed = JSON.parse(text) as ExternalCaseRow[];
  return parsed.map((row) => ({
    id: row.id,
    level: row.level,
    userMessage: row.userMessage,
    flowContext: buildFlowContextFromCase(row),
  }));
}

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
  const requestBody: Record<string, unknown> = {
    userMessage: test.userMessage,
    outputMode: 'steps_json',
    flowContext: test.flowContext,
    runContext: { runStatus: 'idle', logTail: '', auditOutput: '', exitCode: null },
    history: [],
  };

  if (BENCH_MODE === 'mcp_only') {
    requestBody.mode = 'mcp_only';
    requestBody.routerEnabled = true;
    requestBody.routerPreferred = true;
    requestBody.routerOnly = false;
    requestBody.provider = 'openai';
    requestBody.apiKey = '__mcp_only__';
    requestBody.model = MODEL;
  } else {
    requestBody.mode = 'mcp_ai';
    requestBody.provider = 'openai';
    requestBody.apiKey = OPENAI_API_KEY;
    requestBody.model = MODEL;
    requestBody.openaiAssistantId = '__SERVER_DEFAULT_ASSISTANT__';
  }

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
    const totalMs = Math.round(performance.now() - startedAt);
    const debug = (await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/debug/last`).then((res) => res.json())) as DebugEnvelope;
    const toolsUsed = Array.from(new Set((debug.debug?.tools?.trace || []).map((entry) => String(entry.name || '')).filter(Boolean)));
    const resolutionPath = String(debug.debug?.prompts?.resolutionPath || 'unknown');
    const tokenUsage = extractTokenUsage(debug.debug);
    const responseText = String(payload.text || payload.displayText || '');
    const applyability = uiApplyability(responseText);
    const quality = scoreQuality(test, responseText, applyability);
    const status =
      payload.ok && applyability.chatUiApplicable
        ? 'PASS'
        : payload.ok && applyability.parsed
          ? 'WARN'
          : payload.ok
            ? 'FAIL_CLOSED'
            : 'FAIL';
    const preview = !applyability.chatUiApplicable
      ? responseText.slice(0, 220).replace(/\s+/g, ' ').trim()
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
        `path:${resolutionPath}`,
        `quality:${quality.score}`,
        `bucket:${quality.bucket}`,
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
    console.log(`  qualityNotes: ${quality.notes}`);
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
      resolutionPath,
      tools: toolsUsed,
      errors: Array.isArray(payload.errors) ? payload.errors : [],
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      preview,
      quality,
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
      resolutionPath: 'error',
      tools: [],
      errors: [String(error)],
      warnings: [],
      quality: {
        score: 0,
        bucket: 'WRONG_COMMANDS',
        notes: String(error),
      },
    };
  }
}

async function writeLatestResults(
  results: BenchmarkResult[],
  meta: { sourceCount: number; sampleSeed: number | null; sampledCaseIds: string[] }
): Promise<void> {
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
    sourceCount: meta.sourceCount,
    sampleSeed: meta.sampleSeed,
    sampledCaseIds: meta.sampledCaseIds,
    counts,
    results,
  };
  await writeFile(new URL('latest.json', outDir), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const caseBank = await loadBenchCases();
  const selection = selectedCases(caseBank);
  const tests = selection.rows;
  if (!tests.length) {
    console.log('No benchmark cases selected.');
    return;
  }
  if (selection.sampleSeed !== null) {
    console.log(`Running ${tests.length}/${selection.sourceCount} cases (seed: ${selection.sampleSeed}) against ${MCP_HOST} with mode ${BENCH_MODE}`);
    console.log(`Sampled: ${tests.map((test) => test.id).join(', ')}`);
  } else {
    console.log(`Running ${tests.length} live benchmark case(s) against ${MCP_HOST} with mode ${BENCH_MODE}`);
  }
  const results: BenchmarkResult[] = [];
  for (const test of tests) {
    results.push(await runCase(test));
  }
  await writeLatestResults(results, {
    sourceCount: selection.sourceCount,
    sampleSeed: selection.sampleSeed,
    sampledCaseIds: tests.map((test) => test.id),
  });
  const bucketOrder: QualityBucket[] = [
    'CORRECT',
    'MISSING_COMMANDS',
    'WRONG_COMMANDS',
    'WRONG_ORDER',
    'WRONG_STEP_TYPE',
    'DISAGREEMENT',
    'HARD_FEATURE',
  ];
  console.log('\nBUCKET SUMMARY:');
  for (const bucket of bucketOrder) {
    const rows = results.filter((row) => row.quality.bucket === bucket);
    const label = bucket === 'CORRECT' ? 'CORRECT (3)' : bucket;
    console.log(`  ${label}: ${rows.length}${rows.length ? `  ← ${rows.map((row) => row.caseId).join(', ')}` : ''}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
