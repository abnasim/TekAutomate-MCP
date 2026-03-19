import { loadPromptFile } from './promptLoader';
import type { McpChatRequest } from './schemas';
import { postCheckResponse } from './postCheck';
import { buildContext } from './contextBuilder';
import { getToolDefinitions, runTool } from '../tools';
import { getCommandIndex } from './commandIndex';
import { buildCommandGroupSeedQuery, suggestCommandGroups } from './commandGroups';
import { planIntent, type PlannerOutput } from './intentPlanner';
import { probeCommandProxy } from './instrumentProxy';
import { decodeCommandStatus, decodeStatusFromText } from './statusDecoder';

interface ToolLoopResult {
  text: string;
  displayText?: string;
  errors: string[];
  assistantThreadId?: string;
  warnings?: string[];
  metrics?: {
    totalMs: number;
    usedShortcut: boolean;
    provider?: 'openai' | 'anthropic';
    iterations?: number;
    toolCalls?: number;
    toolMs?: number;
    modelMs?: number;
    promptChars?: {
      system: number;
      user: number;
    };
  };
  debug?: {
    promptFileText?: string;
    systemPrompt?: string;
    developerPrompt?: string;
    userPrompt?: string;
    toolDefinitions?: Array<{ name: string; description: string }>;
    toolTrace?: Array<{
      name: string;
      args: Record<string, unknown>;
      startedAt: string;
      durationMs?: number;
      resultSummary?: {
        ok?: boolean;
        count?: number;
        warnings?: string[];
      };
      rawResult?: unknown;
    }>;
    rawOutput?: unknown;
    providerRequest?: unknown;
    shortcutResponse?: string;
  };
}

type HostedResponseInputItem = Record<string, unknown>;
type HostedToolDefinition = Record<string, unknown>;
type HostedToolPhase = 'initial' | 'finalize';

interface HostedResponsesRequestOptions {
  inputOverride?: HostedResponseInputItem[];
  previousResponseId?: string;
  tools?: HostedToolDefinition[];
  toolChoice?: string | Record<string, unknown>;
  developerMessage?: string;
}

interface HostedPreloadContext {
  contextText: string;
  restrictSearchTools: boolean;
  batchMaterializeOnly: boolean;
  candidateCount: number;
  groupCount: number;
  usedBm25: boolean;
}

interface HostedFunctionCall {
  name: string;
  callId: string;
  argumentsText: string;
}

function buildHostedFinalAnswerInput(toolOutputs: HostedResponseInputItem[]): HostedResponseInputItem[] {
  return [
    ...toolOutputs,
    {
      role: 'user',
      content:
        'Tool retrieval is complete for this turn. Use only the retrieved results already in conversation state and return the final answer now. Do not call more tools. If exact source-of-truth verification is still insufficient, say so briefly and do not emit applyable JSON.',
    },
  ];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function escapeJsonString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const STANDARD_MEASUREMENT_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'FREQUENCY', pattern: /\bfrequency\b|\bfreq\b/i },
  { type: 'AMPLITUDE', pattern: /\bamplitude\b|\bamp\b/i },
  { type: 'EYEHIGH', pattern: /\beye\s*height\b|\beyehigh\b/i },
  { type: 'WIDTHBER', pattern: /\beye\s*width\b|\bwidthber\b/i },
  { type: 'TIE', pattern: /\bjitter\b|\btie\b/i },
  { type: 'POVERSHOOT', pattern: /\bpositive overshoot\b|\bpos(?:itive)?\s*overshoot\b|\bpovershoot\b/i },
  { type: 'NOVERSHOOT', pattern: /\bnegative overshoot\b|\bneg(?:ative)?\s*overshoot\b|\bnovershoot\b/i },
  { type: 'RISETIME', pattern: /\brise\s*time\b|\brisetime\b/i },
  { type: 'FALLTIME', pattern: /\bfall\s*time\b|\bfalltime\b/i },
  { type: 'PERIOD', pattern: /\bperiod\b/i },
  { type: 'PK2PK', pattern: /\bpk2pk\b|\bpeak[-\s]*to[-\s]*peak\b|\bpeak to peak\b/i },
  { type: 'MEAN', pattern: /\bmean\b|\baverage\b/i },
  { type: 'RMS', pattern: /\brms\b/i },
  { type: 'HIGH', pattern: /(?<!eye\s)\bhigh\b(?!\s*speed)/i },
  { type: 'LOW', pattern: /(?<!eye\s)\blow\b/i },
  { type: 'MAXIMUM', pattern: /\bmaximum\b|\bmax\b/i },
  { type: 'MINIMUM', pattern: /\bminimum\b|\bmin\b/i },
];

const DEFAULT_MEASUREMENT_SET = [
  'FREQUENCY',
  'AMPLITUDE',
  'PERIOD',
  'PK2PK',
  'MEAN',
  'RMS',
];

function isGenericMeasurementWorkflowRequest(req: McpChatRequest): boolean {
  return /\bsmart measurement workflow\b|\bmeasurement workflow\b|\bcurrent scope context\b/i.test(
    req.userMessage
  );
}

function detectMeasurementRequest(req: McpChatRequest): string[] {
  const text = req.userMessage.toLowerCase();
  const found = STANDARD_MEASUREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ type }) => type);

  if (found.length > 0) {
    return Array.from(new Set(found));
  }

  if (isGenericMeasurementWorkflowRequest(req)) {
    return [...DEFAULT_MEASUREMENT_SET];
  }

  if (!/\bmeas(?:urement)?s?\b/i.test(text)) {
    return [];
  }

  const countMatch =
    text.match(/\b([4-6])\s+meas(?:urement)?s?\b/i) ||
    text.match(/\b(four|five|six)\s+meas(?:urement)?s?\b/i);
  if (!countMatch) {
    return [];
  }

  const countToken = countMatch[1].toLowerCase();
  const requestedCount =
    countToken === 'four'
      ? 4
      : countToken === 'five'
        ? 5
        : countToken === 'six'
          ? 6
          : Number(countToken);

  return DEFAULT_MEASUREMENT_SET.slice(0, Math.max(1, requestedCount));
}

function detectMeasurementChannel(req: McpChatRequest): string | null {
  const text = req.userMessage.toUpperCase();
  const match = text.match(/\bCH([1-8])\b/) || text.match(/\bCHANNEL\s*([1-8])\b/);
  return match ? `CH${match[1]}` : null;
}

function inferMeasurementChannelFromFlow(steps: unknown[]): string | null {
  const flatSteps = flattenSteps(Array.isArray(steps) ? steps : []);
  for (const item of flatSteps) {
    if (!item || typeof item !== 'object') continue;
    const step = item as Record<string, unknown>;
    const params =
      step.params && typeof step.params === 'object' ? (step.params as Record<string, unknown>) : {};
    if (String(step.type || '').toLowerCase() === 'save_waveform') {
      const source = String(params.source || '').toUpperCase();
      if (/^CH[1-8]$/.test(source)) {
        return source;
      }
    }
    const command = String(params.command || '').toUpperCase();
    const match = command.match(/\bCH([1-8])\b/);
    if (match) {
      return `CH${match[1]}`;
    }
  }
  return null;
}

interface ScopedMeasurementRequest {
  measurement: string;
  channel: string;
}

interface DelayMeasurementRequest {
  fromChannel: string;
  toChannel: string;
  fromEdge: 'RISe' | 'FALL';
  toEdge: 'RISe' | 'FALL';
  thresholdVolts?: number;
}

interface SetupHoldMeasurementRequest {
  measurement: 'SETUP' | 'HOLD';
  source1: string;
  source2: string;
}

interface CanSearchConfig {
  bus: string;
  condition: 'ERRor' | 'FRAMEtype' | 'FDBITS' | 'DATA';
  frameType?: string;
  errType?: string;
  brsBit?: 'ONE' | 'ZERo' | 'NOCARE';
  esiBit?: 'ONE' | 'ZERo' | 'NOCARE';
  dataOffset?: number;
}

function normalizeMeasurementSaveAs(channel: string, measurement: string): string {
  const normalizedMeasurement = measurement.toLowerCase();
  if (measurement === 'POVERSHOOT') return `${channel.toLowerCase()}_positive_overshoot`;
  if (measurement === 'NOVERSHOOT') return `${channel.toLowerCase()}_negative_overshoot`;
  if (measurement === 'WIDTHBER') return `${channel.toLowerCase()}_eye_width`;
  if (measurement === 'EYEHIGH') return `${channel.toLowerCase()}_eye_height`;
  if (measurement === 'TIE') return `${channel.toLowerCase()}_jitter`;
  return `${channel.toLowerCase()}_${normalizedMeasurement}`;
}

function normalizeSetupHoldSaveAs(item: SetupHoldMeasurementRequest): string {
  return `${item.source1.toLowerCase()}_${item.source2.toLowerCase()}_${item.measurement.toLowerCase()}`;
}

function detectMeasurementTypesInText(text: string): string[] {
  return STANDARD_MEASUREMENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ type }) => type);
}

function extractScopedMeasurementRequests(message: string, fallbackChannel = 'CH1'): ScopedMeasurementRequest[] {
  const segments = String(message || '')
    .split(/[.;]\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const out: ScopedMeasurementRequest[] = [];

  segments.forEach((segment) => {
    const types = detectMeasurementTypesInText(segment);
    if (!types.length) return;
    const channels = Array.from(segment.toUpperCase().matchAll(/\bCH([1-8])\b/g)).map((match) => `CH${match[1]}`);
    const scopedChannels = channels.length ? Array.from(new Set(channels)) : [fallbackChannel];
    scopedChannels.forEach((channel) => {
      types.forEach((measurement) => out.push({ measurement, channel }));
    });
  });

  if (out.length) {
    return out.filter(
      (item, index, arr) =>
        arr.findIndex((other) => other.channel === item.channel && other.measurement === item.measurement) === index
    );
  }

  const fallbackTypes = detectMeasurementTypesInText(message);
  return fallbackTypes.map((measurement) => ({ measurement, channel: fallbackChannel }));
}

function buildDefaultMeasurementRequests(measurements: string[], fallbackChannel = 'CH1'): ScopedMeasurementRequest[] {
  return Array.from(new Set(measurements)).map((measurement) => ({
    measurement,
    channel: fallbackChannel,
  }));
}

function extractDelayMeasurements(message: string): DelayMeasurementRequest[] {
  const out: DelayMeasurementRequest[] = [];
  const normalized = String(message || '');
  const explicitPattern =
    /\bdelay(?:\s+measurement)?\s+(?:between\s+(CH[1-8])\s+and\s+(CH[1-8])\s+(rising|falling)\s+edges?|from\s+(CH[1-8])\s+(rising|falling)\s+to\s+(CH[1-8])\s+(crossing|rising|falling)(?:\s+edges?)?(?:\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V))?)/gi;

  for (const match of normalized.matchAll(explicitPattern)) {
    if (match[1] && match[2] && match[3]) {
      out.push({
        fromChannel: match[1].toUpperCase(),
        toChannel: match[2].toUpperCase(),
        fromEdge: match[3].toLowerCase() === 'falling' ? 'FALL' : 'RISe',
        toEdge: match[3].toLowerCase() === 'falling' ? 'FALL' : 'RISe',
      });
      continue;
    }

    if (match[4] && match[5] && match[6]) {
      const thresholdVolts = match[8] ? parseVoltageToVolts(`${match[8]}${match[9] || ''}`) : null;
      const rawToEdge = String(match[7] || '').toLowerCase();
      out.push({
        fromChannel: match[4].toUpperCase(),
        toChannel: match[6].toUpperCase(),
        fromEdge: match[5].toLowerCase() === 'falling' ? 'FALL' : 'RISe',
        toEdge: rawToEdge === 'falling' ? 'FALL' : 'RISe',
        thresholdVolts: thresholdVolts === null ? undefined : thresholdVolts,
      });
    }
  }

  return out;
}

function extractSetupHoldMeasurements(
  message: string,
  i2cDecode?: { clockSource: string; dataSource: string } | null
): SetupHoldMeasurementRequest[] {
  const text = String(message || '');
  const wantsSetup = /\bsetup time\b|\bsetup\b/i.test(text);
  const wantsHold = /\bhold time\b|\bhold\b/i.test(text);
  if (!wantsSetup && !wantsHold) return [];

  let source1 = i2cDecode?.clockSource?.toUpperCase() || '';
  let source2 = i2cDecode?.dataSource?.toUpperCase() || '';
  if (!source1 || !source2) {
    const channels = Array.from(text.toUpperCase().matchAll(/\bCH([1-8])\b/g)).map((match) => `CH${match[1]}`);
    const unique = Array.from(new Set(channels));
    if (!source1) source1 = unique[0] || '';
    if (!source2) source2 = unique[1] || source1;
  }

  if (!/^CH[1-8]$/.test(source1) || !/^CH[1-8]$/.test(source2)) return [];

  const out: SetupHoldMeasurementRequest[] = [];
  if (wantsSetup) out.push({ measurement: 'SETUP', source1, source2 });
  if (wantsHold) out.push({ measurement: 'HOLD', source1, source2 });
  return out;
}

function extractCanSearchConfig(message: string, bus: string): CanSearchConfig | null {
  const text = String(message || '');
  if (!/\bsearch\b/i.test(text) || !/\bcan(?:\s+fd)?\b/i.test(text)) return null;

  if (/\berror frames?\b/i.test(text)) {
    return {
      bus,
      condition: 'FRAMEtype',
      frameType: 'ERRor',
    };
  }

  const brsMatch = text.match(/\bbrs\s*bit\s*(1|one|0|zero|nocare|no\s*care)\b/i);
  const esiMatch = text.match(/\besi\s*bit\s*(1|one|0|zero|nocare|no\s*care)\b/i);
  const offsetMatch = text.match(/\bdata\s*offset\s+(\d+)\s*bytes?\b/i);
  if (brsMatch || esiMatch || offsetMatch) {
    const normalizeBit = (raw: string): 'ONE' | 'ZERo' | 'NOCARE' =>
      /^(1|one)$/i.test(raw) ? 'ONE' : /^(0|zero)$/i.test(raw) ? 'ZERo' : 'NOCARE';
    return {
      bus,
      condition: brsMatch || esiMatch ? 'FDBITS' : 'DATA',
      brsBit: brsMatch ? normalizeBit(brsMatch[1]) : undefined,
      esiBit: esiMatch ? normalizeBit(esiMatch[1]) : undefined,
      dataOffset: offsetMatch ? Number(offsetMatch[1]) : undefined,
    };
  }

  const errTypeMatch =
    text.match(/\b(any error|ack(?:\s*miss|\s*missing)?|bit\s*stuff(?:ing)?|form\s*error|crc)\b/i);
  if (errTypeMatch) {
    const token = errTypeMatch[1].toLowerCase().replace(/\s+/g, '');
    const errType =
      token.startsWith('ack') ? 'ACKMISS'
      : token.startsWith('bitstuff') ? 'BITSTUFFing'
      : token.startsWith('form') ? 'FORMERRor'
      : token.startsWith('crc') ? 'CRC'
      : 'ANYERRor';
    return {
      bus,
      condition: 'ERRor',
      errType,
    };
  }

  return null;
}

function shouldQueryMeasurementResults(req: McpChatRequest): boolean {
  return /\b(query|read|result|results|save result|save results|mean\?|value|values)\b/i.test(
    req.userMessage
  );
}

function isMeasurementAppendRequest(req: McpChatRequest): boolean {
  return /\bappend\b|\bkeep existing\b|\bpreserve existing\b|\bwithout overwrit(?:e|ing)\b|\bdo not overwrite\b|\bdon't overwrite\b/i.test(
    req.userMessage
  );
}

function isImdaTrendRequest(req: McpChatRequest): boolean {
  const text = req.userMessage.toLowerCase();
  return /\bimda\b/.test(text) && /\b(acq\s*trend|acqtrend|trend\s*plot|time\s*trend)\b/.test(text);
}

function detectImdaMeasurements(req: McpChatRequest): string[] {
  const text = req.userMessage.toLowerCase();
  const out: string[] = [];
  if (/\btorque\b/.test(text)) out.push('IMDATORQUE');
  if (/\bspeed\b/.test(text)) out.push('IMDASPEED');
  if (/\bpower\s*quality\b|\bpwr[_\s-]*quality\b/.test(text)) out.push('PWR_QUALity');
  return out.length ? Array.from(new Set(out)) : ['IMDATORQUE', 'IMDASPEED'];
}

function flattenSteps(steps: unknown[]): Array<Record<string, unknown>> {
  const flat: Array<Record<string, unknown>> = [];
  const walk = (items: unknown[]) => {
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const step = item as Record<string, unknown>;
      flat.push(step);
      if (Array.isArray(step.children)) {
        walk(step.children);
      }
    });
  };
  walk(steps);
  return flat;
}

function splitCommandSegments(command: string): string[] {
  return String(command || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeHeaderForMatch(command: string): string {
  if (!command) return '';
  return command
    .split('?')[0]
    .trim()
    .split(/\s/)[0]
    .replace(/TRIGger:(A|B)\b/gi, 'TRIGger:{A|B}')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bPLOT\d+\b/gi, 'PLOT<x>')
    .replace(/\bB\d+\b/gi, 'B<x>')
    .replace(/\bSEARCH\d+\b/gi, 'SEARCH<x>')
    .replace(/\bREF\d+\b/gi, 'REF<x>')
    .replace(/\bWAVEVIEW\d+\b/gi, 'WAVEView<x>')
    .replace(/SOUrce\d+/gi, 'SOUrce<x>')
    .toLowerCase();
}

function isNumericLike(value: string): boolean {
  return /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim());
}

async function detectFlowCommandIssues(req: McpChatRequest): Promise<string[]> {
  const out: string[] = [];
  const steps = flattenSteps(Array.isArray(req.flowContext.steps) ? req.flowContext.steps : []);
  if (!steps.length) return out;
  const index = await getCommandIndex();

  for (const step of steps) {
    const type = String(step.type || '').toLowerCase();
    if (!['write', 'query', 'set_and_query'].includes(type)) continue;
    const params = (step.params || {}) as Record<string, unknown>;
    const rawCommand = String(params.command || '').trim();
    if (!rawCommand) continue;
    if (type === 'query' && !rawCommand.includes('?')) {
      out.push(`[${String(step.id || '?')}] query step command should usually end with '?': ${rawCommand}`);
    }

    const segments = splitCommandSegments(rawCommand);
    for (const segment of segments) {
      const [headerRaw, ...argParts] = segment.split(/\s+/);
      const header = String(headerRaw || '').trim();
      const args = argParts.join(' ').trim();
      const entry =
        index.getByHeader(header, req.flowContext.modelFamily) ||
        index.getByHeader(header.toUpperCase(), req.flowContext.modelFamily) ||
        index.getByHeaderPrefix(header, req.flowContext.modelFamily);
      if (!entry) {
        out.push(`[${String(step.id || '?')}] command header not verified: ${header}`);
        continue;
      }
      const entryHeader = String((entry as Record<string, unknown>).header || (entry as Record<string, unknown>).command || '');
      if (normalizeHeaderForMatch(entryHeader) !== normalizeHeaderForMatch(header)) {
        out.push(`[${String(step.id || '?')}] command header not verified: ${header}`);
        continue;
      }
      const requiredArgs = (entry.arguments || []).filter((a) => a.required);
      const firstArg = args.split(',').map((x) => x.trim()).filter(Boolean)[0] || '';
      if (requiredArgs.length > 0 && !firstArg && type !== 'query') {
        const hasSetAndQueryValue =
          type === 'set_and_query' &&
          ((params.paramValues && typeof params.paramValues === 'object' && (
            Object.prototype.hasOwnProperty.call(params.paramValues as Record<string, unknown>, 'value') ||
            Object.prototype.hasOwnProperty.call(params.paramValues as Record<string, unknown>, 'Value')
          )) || false);
        if (!hasSetAndQueryValue) {
          out.push(`[${String(step.id || '?')}] missing required argument for ${header}`);
        }
      }
      const numericArg = requiredArgs.find((a) => /number|numeric|float|nr\d*/i.test(String(a.type || '')));
      if (numericArg && firstArg) {
        const looksToken = /^[A-Za-z_]/.test(firstArg) && !/^(MIN|MAX|DEF|AUTO|ON|OFF)$/i.test(firstArg);
        if (!isNumericLike(firstArg) && looksToken) {
          out.push(
            `[${String(step.id || '?')}] possible invalid numeric value "${firstArg}" for ${header} (${numericArg.name})`
          );
        }
      }
    }
  }
  return out.slice(0, 20);
}

function isFastFrameRequest(req: McpChatRequest): boolean {
  return /\bfast\s*frames?\b|\bfastframes?\b/i.test(req.userMessage);
}

function detectFastFrameCount(req: McpChatRequest): number {
  const match =
    req.userMessage.match(/\b(\d+)\s+fast\s*frames?\b/i) ||
    req.userMessage.match(/\b(\d+)\s+fastframes?\b/i) ||
    req.userMessage.match(/\b(\d+)\s+frames?\b/i) ||
    req.userMessage.match(/\bcount\s+(\d+)\b/i);
  return match ? Math.max(1, Number(match[1])) : 10;
}

function isValidationRequest(req: McpChatRequest): boolean {
  return /\b(validate|validation|verify|verification|review|check flow|is this flow good|is this good|does this look right|does this look good|looks good|briefly)\b/i.test(
    req.userMessage
  );
}

function isFlowValidationRequest(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  if (!isValidationRequest(req)) return false;
  // If the user explicitly asks for log/runtime review, this is not flow-only validation.
  if (/\b(check logs|run logs?|audit|runtime|executor|stderr|stdout|exit code)\b/.test(msg)) {
    return false;
  }
  return true;
}

function isLogReviewRequest(req: McpChatRequest): boolean {
  return /\b(check logs|run logs?|audit|runtime|executor)\b/i.test(req.userMessage);
}

function runLooksSuccessful(runContext: McpChatRequest['runContext']): boolean {
  const audit = String(runContext.auditOutput || '');
  const log = String(runContext.logTail || '');
  if (/\bAudit:\s*pass\b/i.test(audit) || /\bexecutionPassed["']?\s*:\s*true\b/i.test(audit)) return true;
  if (/\[OK\]\s+Complete/i.test(log) || /\bConnected:\b/i.test(log) && /\bScreenshot saved\b/i.test(log)) return true;
  return false;
}

async function buildPyvisaMeasurementShortcut(req: McpChatRequest): Promise<string | null> {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null; // handled by other shortcut
  const deviceType = (req.flowContext.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return null;
  const isLegacyDpoFamily = /\b(DPO|5K|7K|70K)\b/i.test(String(req.flowContext.modelFamily || ''));

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const flatSteps = flattenSteps(existingSteps);
  const measurements = detectMeasurementRequest(req);
  const genericWorkflow = isGenericMeasurementWorkflowRequest(req);
  const channel =
    detectMeasurementChannel(req) ||
    inferMeasurementChannelFromFlow(existingSteps) ||
    'CH1';
  const imdaTrend = isImdaTrendRequest(req);
  const imdaMeasurements = imdaTrend ? detectImdaMeasurements(req) : [];
  if (!imdaTrend) return null;

  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const wantsQueries = shouldQueryMeasurementResults(req) || genericWorkflow;
  const appendMode = isMeasurementAppendRequest(req);
  const isBuildNew = existingSteps.length === 0;
  const defaultChannel = channel || 'CH1';

  if (imdaTrend) {
    const addGroup: Record<string, unknown>[] = imdaMeasurements.flatMap((measurement, index) => {
      const slot = index + 1;
      return [
        {
          id: `imda_${slot}_add`,
          type: 'write',
          label: `Add ${measurement} measurement`,
          params: { command: `MEASUrement:ADDMEAS ${measurement}` },
        },
        {
          id: `imda_${slot}_src`,
          type: 'write',
          label: `Set source for MEAS${slot}`,
          params: { command: `MEASUrement:MEAS${slot}:SOUrce1 ${defaultChannel}` },
        },
      ];
    });

    const plotGroup: Record<string, unknown>[] = [
      {
        id: 'imda_plot_1',
        type: 'write',
        label: 'Create IMDA acquisition trend plot',
        params: { command: 'PLOT:PLOT1:TYPe IMDAACQTREND' },
      },
      {
        id: 'imda_plot_bind_1',
        type: 'write',
        label: `Bind plot to MEAS1`,
        params: { command: 'PLOT:PLOT1:SOUrce1 MEAS1' },
      },
    ];
    if (imdaMeasurements.length > 1) {
      plotGroup.push(
        {
          id: 'imda_plot_2',
          type: 'write',
          label: 'Create second IMDA acquisition trend plot',
          params: { command: 'PLOT:PLOT2:TYPe IMDAACQTREND' },
        },
        {
          id: 'imda_plot_bind_2',
          type: 'write',
          label: `Bind second plot to MEAS2`,
          params: { command: 'PLOT:PLOT2:SOUrce1 MEAS2' },
        }
      );
    }

    const addGroupStep: Record<string, unknown> = {
      id: 'g_imda_add',
      type: 'group',
      label: 'Add Measurements',
      params: {},
      collapsed: false,
      children: addGroup,
    };
    const plotGroupStep: Record<string, unknown> = {
      id: 'g_imda_plot',
      type: 'group',
      label: 'Create IMDA Acq Trend Plot',
      params: {},
      collapsed: false,
      children: plotGroup,
    };

    if (isBuildNew) {
      const flow = {
        name: 'IMDA Measurements with Acq Trend',
        description: 'Add IMDA measurements and create acquisition trend plots',
        backend: backend || 'pyvisa',
        deviceType: req.flowContext.deviceType || 'SCOPE',
        steps: [
          { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
          addGroupStep,
          plotGroupStep,
          ...(hasScreenshot ? [{ id: 'ss1', type: 'save_screenshot', label: 'Save Screenshot', params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' } }] : []),
          { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
      };
      const actions = [{ type: 'replace_flow', flow }];
      return `ACTIONS_JSON: ${JSON.stringify({ summary: 'Added IMDA measurements with verified PLOT-based acquisition trend setup.', findings: [], suggestedFixes: [], actions })}`;
    }

    const flat = flattenSteps(existingSteps);
    const insertAfterId =
      (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
      (flat.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
      null;
    // Insert in reverse at same anchor so final order is Add group -> Plot group -> Screenshot.
    const actions = [
      ...(hasScreenshot
        ? [{
            type: 'insert_step_after',
            targetStepId: insertAfterId,
            newStep: { id: 'ss1', type: 'save_screenshot', label: 'Save Screenshot', params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' } },
          }]
        : []),
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: plotGroupStep },
      { type: 'insert_step_after', targetStepId: insertAfterId, newStep: addGroupStep },
    ];
    return `ACTIONS_JSON: ${JSON.stringify({
      summary: 'Added IMDA torque/speed measurements and IMDAACQTREND plot using verified PLOT commands.',
      findings: ['Avoided unverified DISPlay:ACQTREND and MEAS:ACQTREND command patterns.'],
      suggestedFixes: [],
      actions,
    })}`;
  }

  if (appendMode) {
    return null;
  }

  const measurementSlots = measurements.map((measurement, index) => ({
    measurement,
    slot: index + 1,
    saveAsName: normalizeMeasurementSaveAs(defaultChannel, measurement),
  }));

  const resetCommands = await finalizeShortcutCommands(req, [{
    header: 'MEASUrement:DELETEALL',
    concreteHeader: 'MEASUrement:DELETEALL',
  }]);
  if (!resetCommands || !resetCommands.length) return null;

  const addGroup: Record<string, unknown>[] = [
    buildWriteStep('meas_reset', 'Clear existing measurements', resetCommands),
  ];
  const queryGroup: Record<string, unknown>[] = [];

  for (const { measurement, slot, saveAsName } of measurementSlots) {
    const addCommands = await finalizeShortcutCommands(req, [
      ...(isLegacyDpoFamily
        ? ([
            {
              header: 'MEASUrement:MEAS<x>:TYPe',
              concreteHeader: `MEASUrement:MEAS${slot}:TYPe`,
              value: measurement,
            },
            {
              header: 'MEASUrement:MEAS<x>:SOURCE',
              concreteHeader: `MEASUrement:MEAS${slot}:SOURCE`,
              value: defaultChannel,
            },
          ] satisfies ShortcutFinalizeItem[])
        : ([
            {
              header: 'MEASUrement:ADDMEAS',
              concreteHeader: 'MEASUrement:ADDMEAS',
              value: measurement,
            },
            {
              header: 'MEASUrement:MEAS<x>:SOUrce<x>',
              concreteHeader: `MEASUrement:MEAS${slot}:SOUrce1`,
              value: defaultChannel,
            },
          ] satisfies ShortcutFinalizeItem[])),
    ]);
    if (!addCommands) return null;

    addGroup.push(
      buildWriteStep(
        `meas_${slot}`,
        `Configure ${measurement.toLowerCase()} on ${defaultChannel}`,
        addCommands
      )
    );

    if (wantsQueries) {
      const queryCommands = await finalizeShortcutCommands(req, [{
        header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
        concreteHeader: `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN`,
        commandType: 'query',
      }]);
      if (!queryCommands || !queryCommands[0]) return null;
      queryGroup.push({
        id: `meas_q${slot}`,
        type: 'query',
        label: `Query ${measurement.toLowerCase()} result`,
        params: {
          command: queryCommands[0],
          saveAs: saveAsName,
        },
      });
    }
  }

  const screenshotStep = hasScreenshot ? [{
    id: 'ss1',
    type: 'save_screenshot',
    label: 'Save Screenshot',
    params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' },
  }] : [];

  if (isBuildNew) {
    const flow = {
      name: `${defaultChannel} Measurements`,
      description: `Deterministic measurement workflow for ${defaultChannel}`,
      backend: backend || 'pyvisa',
      deviceType: req.flowContext.deviceType || 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
        {
          id: 'g1', type: 'group', label: `Configure ${defaultChannel} measurements`, params: {}, collapsed: false,
          children: addGroup,
        },
        ...(queryGroup.length
          ? [{
              id: 'g2', type: 'group', label: 'Read measurement results', params: {}, collapsed: false,
              children: queryGroup,
            }]
          : []),
        ...screenshotStep,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    const summaryParts = [`Built a deterministic ${defaultChannel} measurement workflow using explicit MEAS slots.`];
    summaryParts.push('The flow clears the existing measurement table before programming MEAS1 and onward.');
    if (hasScreenshot) summaryParts.push('Screenshot step included.');
    const actions = [{ type: 'replace_flow', flow }];
    return `ACTIONS_JSON: ${JSON.stringify({ summary: summaryParts.join(' '), findings: [], suggestedFixes: [], actions })}`;
  }

  // Existing flow — insert steps just after connect or the selected step.
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (flatSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;
  const measurementGroupStep = {
    id: 'g_meas_add',
    type: 'group',
    label: genericWorkflow ? 'Smart measurement workflow' : `Configure ${defaultChannel} measurements`,
    params: {},
    collapsed: false,
    children: addGroup,
  };
  const resultGroupStep = queryGroup.length
    ? {
        id: 'g_meas_query',
        type: 'group',
        label: 'Read measurement results',
        params: {},
        collapsed: false,
        children: queryGroup,
      }
    : null;
  const actions: Array<Record<string, unknown>> = [
    { type: 'insert_step_after', targetStepId: insertAfterId, newStep: measurementGroupStep },
  ];
  if (resultGroupStep) {
    actions.push({ type: 'insert_step_after', targetStepId: measurementGroupStep.id, newStep: resultGroupStep });
  }
  if (screenshotStep.length) {
    actions.push({
      type: 'insert_step_after',
      targetStepId: resultGroupStep ? resultGroupStep.id : measurementGroupStep.id,
      newStep: screenshotStep[0],
    });
  }
  const findings = [
    `Clears the scope measurement table with ${resetCommands[0]} before programming explicit MEAS slots.`,
  ];
  if (!detectMeasurementChannel(req) && inferMeasurementChannelFromFlow(existingSteps)) {
    findings.push(`Inferred ${defaultChannel} from the current scope context.`);
  }
  return `ACTIONS_JSON: ${JSON.stringify({
    summary: `Added a deterministic ${defaultChannel} measurement workflow using explicit MEAS1-${measurementSlots.length} slots.`,
    findings,
    suggestedFixes: [],
    actions,
  })}`;
}

function buildPyvisaFastFrameShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend === 'tm_devices') return null;
  if (!isFastFrameRequest(req)) return null;

  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const flatSteps = flattenSteps(existingSteps);
  const count = detectFastFrameCount(req);
  const connectStep = flatSteps.find((step) => String(step.type || '') === 'connect') as Record<string, unknown> | undefined;
  const screenshotStep = flatSteps.find((step) => String(step.type || '') === 'save_screenshot') as Record<string, unknown> | undefined;
  const insertAfterId = (connectStep?.id as string | undefined) || (req.flowContext.selectedStepId ? String(req.flowContext.selectedStepId) : null);
  const fastFrameSteps = [
    {
      id: 'ff1',
      type: 'write',
      label: 'Enable FastFrame',
      params: { command: 'HORizontal:FASTframe:STATE ON' },
    },
    {
      id: 'ff2',
      type: 'write',
      label: `Set FastFrame Count to ${count}`,
      params: { command: `HORizontal:FASTframe:COUNt ${count}` },
    },
    {
      id: 'ff3',
      type: 'query',
      label: 'Query FastFrame frames acquired',
      params: { command: 'ACQuire:NUMFRAMESACQuired?', saveAs: 'fastframe_frames_acquired' },
    },
  ];

  if (!existingSteps.length) {
    const flow = {
      name: 'FastFrame Workflow',
      description: `Enable FastFrame with frame count ${count}`,
      backend: backend || 'pyvisa',
      deviceType: req.flowContext.deviceType || 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect to scope', params: { instrumentIds: ['scope1'], printIdn: true } },
        ...fastFrameSteps,
        { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    };
    return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count}.`, findings: [], suggestedFixes: [], actions: [{ type: 'replace_flow', flow }] })}`;
  }

  const actions: Record<string, unknown>[] = [];
  if (insertAfterId) {
    // Insert in reverse order at the same anchor so final order is ff1 then ff2 then ff3.
    // This avoids depending on generated IDs from newly inserted steps.
    for (let i = fastFrameSteps.length - 1; i >= 0; i -= 1) {
      actions.push({ type: 'insert_step_after', targetStepId: insertAfterId, newStep: fastFrameSteps[i] });
    }
  } else {
    actions.push(...fastFrameSteps.map((step) => ({ type: 'insert_step_after', targetStepId: null, newStep: step })));
  }

  if (screenshotStep) {
    return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count} before the screenshot.`, findings: [], suggestedFixes: [], actions })}`;
  }
  return `ACTIONS_JSON: ${JSON.stringify({ summary: `Added FastFrame enable and frame count ${count}.`, findings: [], suggestedFixes: [], actions })}`;
}

type ShortcutFinalizeItem = {
  header: string;
  concreteHeader?: string;
  commandType?: 'set' | 'query';
  value?: string | number | boolean;
  arguments?: Array<string | number | boolean>;
};

function parseVoltageToVolts(raw: string): number | null {
  const match = String(raw || '').trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(mv|v)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  return match[2].toLowerCase() === 'mv' ? magnitude / 1000 : magnitude;
}

function parseTimeToSeconds(raw: string): number | null {
  const match = String(raw || '').trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'ps') return magnitude / 1e12;
  if (unit === 'ns') return magnitude / 1e9;
  if (unit === 'us') return magnitude / 1e6;
  if (unit === 'ms') return magnitude / 1e3;
  return magnitude;
}

function parseScaledInteger(raw: string, scaleWord?: string | null): number | null {
  const magnitude = Number(String(raw || '').trim());
  if (!Number.isFinite(magnitude)) return null;
  const word = String(scaleWord || '').trim().toLowerCase();
  if (!word) return magnitude;
  if (word.startsWith('million')) return Math.round(magnitude * 1_000_000);
  if (word.startsWith('thousand') || word === 'k') return Math.round(magnitude * 1_000);
  return Math.round(magnitude);
}

function detectBusSlot(message: string, fallback = 'B1'): string {
  const match = String(message || '').match(/\bB(\d{1,2})\b/i);
  return match ? `B${match[1]}` : fallback;
}

function channelToBusSourceValue(channel: string): number | null {
  const match = String(channel || '').toUpperCase().match(/^CH([1-8])$/);
  return match ? Number(match[1]) : null;
}

function parseCanRateEnum(raw: string): string | null {
  const match = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*(k|m)(?:bit\/s|bps)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const unit = match[2].toLowerCase();
  if (unit === 'k') {
    const rounded = Math.round(magnitude);
    const allowed = new Set([10, 20, 25, 31, 33, 50, 62, 68, 83, 92, 100, 125, 153, 250, 400, 500, 800]);
    return allowed.has(rounded) ? `RATE${rounded}K` : null;
  }
  const rounded = Math.round(magnitude);
  return rounded >= 1 && rounded <= 16 ? `RATE${rounded}M` : null;
}

function parseRs232RateEnum(raw: string): string | null {
  const match = String(raw || '').trim().match(/^(\d+(?:\.\d+)?)\s*(?:baud|bps)$/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  if (magnitude >= 900_000) return 'RATE921K';
  if (magnitude >= 110_000) return 'RATE115K';
  if (magnitude >= 38_000) return 'RATE38K';
  if (magnitude >= 19_000) return 'RATE19K';
  if (magnitude >= 9_000) return 'RATE9K';
  if (magnitude >= 2_000) return 'RATE2K';
  if (magnitude >= 1_000) return 'RATE1K';
  return 'RATE300';
}

function parseTerminationOhms(raw: string): number | null {
  const text = String(raw || '').replace(/\s+/g, '').toLowerCase();
  if (!text) return null;
  if (text === '50ohm' || text === '50ohms' || text === '50') return 50;
  if (text === '1mohm' || text === '1megohm' || text === '1000000ohm' || text === '1000000') return 1000000;
  return null;
}

function detectWaveformFormat(message: string): 'bin' | 'csv' | 'wfm' | 'mat' {
  const text = message.toLowerCase();
  if (/\bcsv\b/.test(text)) return 'csv';
  if (/\bmat\b/.test(text)) return 'mat';
  if (/\bwfm\b/.test(text)) return 'wfm';
  return 'bin';
}

function detectSaveSetupPath(message: string): string | null {
  const match = message.match(/\bsave setup to\s+([^\s,]+\.set)\b/i);
  return match ? match[1] : null;
}

function detectRecallSessionPath(message: string): string | null {
  const match = message.match(/\brecall session from\s+([^\s,]+\.tss)\b/i);
  return match ? match[1] : null;
}

function detectWaveformSources(message: string): string[] {
  const text = message.toUpperCase();
  if (/\bsave all 4 channels\b/i.test(text)) {
    return ['CH1', 'CH2', 'CH3', 'CH4'];
  }
  if (/\bsave both channels\b/i.test(text)) {
    return ['CH1', 'CH2'];
  }
  const contextualMatches = Array.from(
    text.matchAll(/\bsave\b[^.]*?\b(CH[1-8])\b[^.]*?\bwaveform\b|\bwaveform\b[^.]*?\b(CH[1-8])\b/gi)
  )
    .map((m) => m[1] || m[2])
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toUpperCase());
  if (contextualMatches.length) {
    return Array.from(new Set(contextualMatches));
  }
  const matches = Array.from(text.matchAll(/\bCH([1-8])\b/g)).map((m) => `CH${m[1]}`);
  if (/\bwaveform\b/i.test(text) && /\bsave\b/i.test(text) && matches.length) {
    return Array.from(new Set(matches));
  }
  return [];
}

function extractChannelConfigs(message: string): Array<{
  channel: string;
  scaleVolts: number;
  coupling?: 'AC' | 'DC' | 'DCR';
  terminationOhms?: number;
}> {
  const results: Array<{
    channel: string;
    scaleVolts: number;
    coupling?: 'AC' | 'DC' | 'DCR';
    terminationOhms?: number;
  }> = [];
  const regex = /\b(CH([1-8]))\b(?:\s+to)?\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V)\b(?:\s+(AC|DC|DCR))?(?:\s+(50\s*ohm|1\s*M(?:ohm)?|1Mohm))?/gi;
  for (const match of message.matchAll(regex)) {
    const scaleVolts = parseVoltageToVolts(`${match[3]}${match[4]}`);
    if (scaleVolts === null) continue;
    const terminationOhms = parseTerminationOhms(match[6] || '');
    results.push({
      channel: String(match[1]).toUpperCase(),
      scaleVolts,
      coupling: match[5] ? (String(match[5]).toUpperCase() as 'AC' | 'DC' | 'DCR') : undefined,
      terminationOhms: terminationOhms === null ? undefined : terminationOhms,
    });
  }
  return results;
}

function extractEdgeTrigger(message: string): {
  source?: string;
  slope?: 'RISe' | 'FALL';
  levelVolts?: number;
  mode?: 'NORMal' | 'AUTO';
  holdoffSeconds?: number;
} {
  const text = String(message || '');
  const out: {
    source?: string;
    slope?: 'RISe' | 'FALL';
    levelVolts?: number;
    mode?: 'NORMal' | 'AUTO';
    holdoffSeconds?: number;
  } = {};
  const triggerSourceMatch = text.match(/\b(?:edge\s+)?trigger(?:\s+on)?\s+(CH[1-8])\b/i);
  if (triggerSourceMatch) out.source = triggerSourceMatch[1].toUpperCase();
  if (/\brising\b/i.test(text)) out.slope = 'RISe';
  if (/\bfalling\b/i.test(text)) out.slope = 'FALL';
  const levelMatch = text.match(/\bat\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V)\b/i);
  if (levelMatch) {
    const volts = parseVoltageToVolts(`${levelMatch[1]}${levelMatch[2]}`);
    if (volts !== null) out.levelVolts = volts;
  }
  if (/\bnormal mode\b|\bmode to normal\b/i.test(text)) out.mode = 'NORMal';
  if (/\bauto mode\b|\bmode to auto\b/i.test(text)) out.mode = 'AUTO';
  const holdoffMatch = text.match(/\bholdoff(?:\s+to)?\s+([-+]?\d+(?:\.\d+)?)\s*(ns|us|ms|s)\b/i);
  if (holdoffMatch) {
    const seconds = parseTimeToSeconds(`${holdoffMatch[1]}${holdoffMatch[2]}`);
    if (seconds !== null) out.holdoffSeconds = seconds;
  }
  return out;
}

function extractHorizontalConfig(message: string): {
  scaleSeconds?: number;
  recordLength?: number;
  fastFrameCount?: number;
  fastAcqPalette?: 'NORMal' | 'TEMPerature' | 'SPECtral' | 'INVErted';
  continuousSeconds?: number;
} {
  const text = String(message || '');
  const out: {
    scaleSeconds?: number;
    recordLength?: number;
    fastFrameCount?: number;
    fastAcqPalette?: 'NORMal' | 'TEMPerature' | 'SPECtral' | 'INVErted';
    continuousSeconds?: number;
  } = {};

  const scaleMatch = text.match(/\b([-+]?\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)\s+per\s+div\b/i);
  if (scaleMatch) {
    const seconds = parseTimeToSeconds(`${scaleMatch[1]}${scaleMatch[2]}`);
    if (seconds !== null) out.scaleSeconds = seconds;
  }

  const recordMatch =
    text.match(/\brecord length\s+(\d+(?:\.\d+)?)\s*(million|thousand)?(?:\s+samples?)?\b/i) ||
    text.match(/\brecord length\s+(\d+)\b/i);
  if (recordMatch) {
    const recordLength = parseScaledInteger(recordMatch[1], recordMatch[2] || '');
    if (recordLength !== null) out.recordLength = recordLength;
  }

  const fastFrameMatch =
    text.match(/\bfast\s*frame\s+(\d+)\s+frames?\b/i) ||
    text.match(/\bfastframes?\s+(\d+)\b/i) ||
    text.match(/\b(\d+)\s+fast\s*frames?\b/i) ||
    text.match(/\b(\d+)\s+fastframes?\b/i);
  if (fastFrameMatch) {
    out.fastFrameCount = Number(fastFrameMatch[1]);
  }

  if (/\btemperature palette\b/i.test(text)) out.fastAcqPalette = 'TEMPerature';
  else if (/\bspectral palette\b/i.test(text)) out.fastAcqPalette = 'SPECtral';
  else if (/\binverted palette\b/i.test(text)) out.fastAcqPalette = 'INVErted';
  else if (/\bfast acquisition\b|\bfastacq\b/i.test(text)) out.fastAcqPalette = 'NORMal';

  const continuousMatch = text.match(/\brun continuous(?:ly)? for\s+([-+]?\d+(?:\.\d+)?)\s*(ns|us|ms|s|seconds?)\b/i);
  if (continuousMatch) {
    const unit = /^s/i.test(continuousMatch[2]) ? 's' : continuousMatch[2];
    const seconds = parseTimeToSeconds(`${continuousMatch[1]}${unit}`);
    if (seconds !== null) out.continuousSeconds = seconds;
  }

  return out;
}

function extractI2cDecodeConfig(message: string): {
  bus: string;
  clockSource: string;
  dataSource: string;
  clockThresholdVolts?: number;
  dataThresholdVolts?: number;
} | null {
  const text = String(message || '');
  if (!/\bi2c\b/i.test(text)) return null;
  const clockMatch = text.match(/\bclock\s+(CH[1-8])(?:\s+threshold\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V))?/i);
  const dataMatch = text.match(/\bdata\s+(CH[1-8])(?:\s+threshold\s+([-+]?\d+(?:\.\d+)?)\s*(mV|V))?/i);
  if (!clockMatch || !dataMatch) return null;
  const clockThreshold = clockMatch[2] ? parseVoltageToVolts(`${clockMatch[2]}${clockMatch[3]}`) : null;
  const dataThreshold = dataMatch[2] ? parseVoltageToVolts(`${dataMatch[2]}${dataMatch[3]}`) : null;
  return {
    bus: detectBusSlot(text, 'B1'),
    clockSource: clockMatch[1].toUpperCase(),
    dataSource: dataMatch[1].toUpperCase(),
    clockThresholdVolts: clockThreshold === null ? undefined : clockThreshold,
    dataThresholdVolts: dataThreshold === null ? undefined : dataThreshold,
  };
}

function extractCanDecodeConfig(message: string): {
  bus: string;
  sourceChannel: string;
  nominalRate?: string;
  dataRate?: string;
  standard?: 'FDISO' | 'FDNONISO' | 'CAN2X';
} | null {
  const text = String(message || '');
  if (!/\bcan\b/i.test(text)) return null;
  const sourceMatch = text.match(/\bsource\s+(CH[1-8])\b/i);
  if (!sourceMatch) return null;
  const nominalMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(k|m)bps\s+nominal\b/i);
  const dataMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(k|m)bps\s+data(?:\s+phase)?\b/i);
  const nominalRate = nominalMatch ? parseCanRateEnum(`${nominalMatch[1]}${nominalMatch[2]}bps`) : null;
  const dataRate = dataMatch ? parseCanRateEnum(`${dataMatch[1]}${dataMatch[2]}bps`) : null;
  let standard: 'FDISO' | 'FDNONISO' | 'CAN2X' | undefined;
  if (/\bnon[-\s]?iso\b/i.test(text)) standard = 'FDNONISO';
  else if (/\biso standard\b|\bfdiso\b/i.test(text)) standard = 'FDISO';
  else if (/\bcan 2\.?0\b|\bcan2x\b/i.test(text)) standard = 'CAN2X';
  return {
    bus: detectBusSlot(text, 'B1'),
    sourceChannel: sourceMatch[1].toUpperCase(),
    nominalRate: nominalRate || undefined,
    dataRate: dataRate || undefined,
    standard,
  };
}

function extractRs232DecodeConfig(message: string): {
  bus: string;
  sourceChannel: string;
  bitRate?: string;
  dataBits?: 7 | 8 | 9;
  parity?: 'NONe' | 'EVEN' | 'ODD';
} | null {
  const text = String(message || '');
  if (!/\buart\b|\brs-?232\b/i.test(text)) return null;
  const sourceMatch = text.match(/\b(?:uart|rs-?232(?:c)?)\b.*?\b(CH[1-8])\b/i) || text.match(/\bsource\s+(CH[1-8])\b/i);
  if (!sourceMatch) return null;
  const bitRateMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:baud|bps)\b/i);
  const dataBitsMatch = text.match(/\b([789])N1\b/i) || text.match(/\b([789])\s*(?:data bits|data-bits)\b/i);
  const parityMatch =
    text.match(/\b([789])([NEO])1\b/i) ||
    text.match(/\bparity\s+(none|even|odd)\b/i);
  let parity: 'NONe' | 'EVEN' | 'ODD' | undefined;
  if (parityMatch) {
    const token = String(parityMatch[2] || parityMatch[1] || '').toLowerCase();
    parity = token.startsWith('e') ? 'EVEN' : token.startsWith('o') ? 'ODD' : 'NONe';
  }
  return {
    bus: detectBusSlot(text, 'B1'),
    sourceChannel: sourceMatch[1].toUpperCase(),
    bitRate: bitRateMatch ? (parseRs232RateEnum(`${bitRateMatch[1]} baud`) || undefined) : undefined,
    dataBits: dataBitsMatch ? (Number(dataBitsMatch[1]) as 7 | 8 | 9) : undefined,
    parity,
  };
}

function extractI2cBusTrigger(message: string): {
  bus: string;
  addressValue?: string;
  addressMode?: 'ADDR7' | 'ADDR10';
  direction?: 'READ' | 'WRITE' | 'NOCARE';
} | null {
  const text = String(message || '');
  if (!/\btrigger\b.*\bi2c\b|\bi2c\b.*\btrigger\b/i.test(text)) return null;
  const addressMatch = text.match(/\baddress\s+0x([0-9a-f]+)\b/i);
  const directionMatch = text.match(/\bdirection\s+(read|write)\b/i);
  if (!addressMatch && !directionMatch) return null;
  return {
    bus: detectBusSlot(text, 'B1'),
    addressValue: addressMatch ? addressMatch[1].toUpperCase() : undefined,
    addressMode: addressMatch && addressMatch[1].length > 2 ? 'ADDR10' : 'ADDR7',
    direction: directionMatch ? (directionMatch[1].toUpperCase() as 'READ' | 'WRITE') : undefined,
  };
}

function wantsFastFrameTimestampQuery(message: string): boolean {
  return /\bfastframe\b.*\btimestamp\b|\btimestamp\b.*\bfastframe\b/i.test(message);
}

function wantsCanErrorSearch(message: string): boolean {
  return /\bsearch\b.*\bcan(?:\s+fd)?\b.*\berror frames?\b|\berror frames?\b.*\bcan(?:\s+fd)?\b/i.test(message);
}

async function finalizeShortcutCommands(
  req: McpChatRequest,
  items: ShortcutFinalizeItem[]
): Promise<string[] | null> {
  if (!items.length) return [];
  const result = await runTool('finalize_scpi_commands', {
    items: items.map((item) => ({
      ...item,
      family: req.flowContext.modelFamily,
    })),
  }) as Record<string, unknown>;
  const data = result.data && typeof result.data === 'object'
    ? (result.data as Record<string, unknown>)
    : {};
  const rows = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
  if (!rows.length || result.ok !== true) {
    return null;
  }
  const commands = rows
    .map((row) => (typeof row.command === 'string' ? row.command : ''))
    .filter(Boolean);
  return commands.length === rows.length ? commands : null;
}

function buildWriteStep(id: string, label: string, commands: string[]): Record<string, unknown> {
  if (commands.some(isAcquireStateRunCommand) && commands.length > 1) {
    return {
      id,
      type: 'group',
      label,
      params: {},
      collapsed: false,
      children: commands.map((command, index) => ({
        id: `${id}_${index + 1}`,
        type: 'write',
        label: `${label} (${index + 1}/${commands.length})`,
        params: { command },
      })),
    };
  }

  const maxConcatCommands = PLANNER_MAX_CONCAT_COMMANDS;
  if (commands.length > maxConcatCommands) {
    const chunks = chunkCommands(commands, maxConcatCommands);
    return {
      id,
      type: 'group',
      label,
      params: {},
      collapsed: false,
      children: chunks.map((chunk, index) => ({
        id: `${id}_${index + 1}`,
        type: 'write',
        label,
        params: { command: chunk.join(';') },
      })),
    };
  }
  return {
    id,
    type: 'write',
    label,
    params: { command: commands.join(';') },
  };
}

function buildQueryStep(
  id: string,
  label: string,
  command: string,
  saveAs?: string
): Record<string, unknown> {
  const variableName = saveAs || `result_${id}`;
  return {
    id,
    type: 'query',
    label,
    params: { command, saveAs: variableName },
  };
}

function buildShortcutResponse(opts: {
  summary: string;
  steps: Array<Record<string, unknown>>;
  req: McpChatRequest;
  startedAt: number;
}): ToolLoopResult {
  const payload = `ACTIONS_JSON: ${JSON.stringify({
    summary: opts.summary,
    findings: [],
    suggestedFixes: [],
    actions: [
      {
        type: 'replace_flow',
        flow: {
          name: 'Direct Command Flow',
          description: opts.summary,
          backend: opts.req.flowContext.backend,
          deviceType: opts.req.flowContext.deviceType || 'SCOPE',
          deviceDriver: opts.req.flowContext.deviceDriver,
          visaBackend: opts.req.flowContext.visaBackend,
          steps: opts.steps,
        },
      },
    ],
  })}`;

  return {
    text: payload,
    displayText: payload,
    assistantThreadId: resolveOpenAiResponseCursor(opts.req) || undefined,
    errors: [],
    warnings: [],
    metrics: {
      totalMs: Date.now() - opts.startedAt,
      usedShortcut: true,
      provider: opts.req.provider,
      iterations: 0,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: { system: 0, user: 0 },
    },
    debug: {
      shortcutResponse: payload,
      toolTrace: [],
    },
  };
}

function detectDirectExecution(
  req: McpChatRequest
): { type: 'query' | 'write' | 'error_check'; command: string } | null {
  const msg = String(req.userMessage || '').toLowerCase().trim();

  if (
    /^(query\s+)?(\*idn\??|what is the idn|print idn|get idn|identify scope)$/i.test(msg) ||
    /\bconnect\b.*\b(print|get|query)\b.*\bidn\b/i.test(msg)
  ) {
    return { type: 'query', command: '*IDN?' };
  }
  if (/^(check errors?|query allev|error queue|any errors?|query esr|\*esr\??|event status)$/i.test(msg)) {
    return { type: 'query', command: '*ESR?' };
  }
  if (/^(wait for opc|\*opc\??|opc query)$/i.test(msg)) {
    return { type: 'query', command: '*OPC?' };
  }
  if (/^(busy\??|query busy|instrument busy)$/i.test(msg)) {
    return { type: 'query', command: 'BUSY?' };
  }
  if (/^(event\??|query event)$/i.test(msg)) {
    return { type: 'query', command: 'EVENT?' };
  }
  if (/^(evmsg\??|query evmsg|event message)$/i.test(msg)) {
    return { type: 'query', command: 'EVMsg?' };
  }
  if (/^(query esr|\*esr\??|event status)$/i.test(msg)) {
    return { type: 'query', command: '*ESR?' };
  }
  if (/^(reset scope|\*rst|factory reset|reset to factory)$/i.test(msg)) {
    return { type: 'write', command: '*RST' };
  }

  return null;
}

async function buildMcpOnlyExplainApplyResponse(req: McpChatRequest): Promise<string | null> {
  const userMessage = String(req.userMessage || '').trim();
  if (!userMessage) return null;

  const commandIndex = await getCommandIndex();
  const candidates = commandIndex.searchByQuery(userMessage, req.flowContext.modelFamily, 5);
  if (!candidates.length) return null;

  const best = candidates[0];
  const lower = userMessage.toLowerCase();
  const prefersQuery =
    /\b(query|read|status|value|what is|what's|current)\b/.test(lower) &&
    !/\b(set|write|force|enable|disable|run|start|stop|trigger)\b/.test(lower);

  const command =
    (prefersQuery ? best.syntax.query : best.syntax.set) ||
    best.syntax.query ||
    best.syntax.set ||
    best.header;
  if (!command) return null;

  const isQuery = /\?$/.test(command.trim());
  const safeSaveAs = best.header
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'result';

  const newStep = isQuery
    ? {
        type: 'query',
        label: best.shortDescription || `Query ${best.header}`,
        params: { command, saveAs: safeSaveAs },
      }
    : {
        type: 'write',
        label: best.shortDescription || `Set ${best.header}`,
        params: { command },
      };

  const summaryText =
    `Verified command: ${best.header}${best.syntax.set ? ` (set: ${best.syntax.set})` : ''}` +
    `${best.syntax.query ? ` (query: ${best.syntax.query})` : ''}.`;

  return `${summaryText}\n\nACTIONS_JSON: ${JSON.stringify({
    summary: `Verified ${best.header} from source command index.`,
    findings: [
      best.shortDescription || `Matched ${best.header}.`,
      'Apply will append one step to your flow (it does not auto-run).',
    ],
    suggestedFixes: [],
    actions: [
      {
        type: 'insert_step_after',
        targetStepId: null,
        newStep,
      },
    ],
  })}`;
}

function normalizeScopeModelFamily(req: McpChatRequest): string {
  const current = String(req.flowContext?.modelFamily || '').trim();
  if (current && !/^(unknown|scope|oscilloscope)$/i.test(current)) {
    return current;
  }
  const aliasHint = String(req.flowContext?.alias || '').trim();
  if (/(MSO|DPO|TDS|AFG|AWG|SMU|RSA|70K|7K|5K)/i.test(aliasHint)) {
    return aliasHint;
  }
  return current || '';
}

function shouldAskScopePlatform(req: McpChatRequest): boolean {
  const deviceType = String(req.flowContext?.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return false;
  const modelFamily = normalizeScopeModelFamily(req);
  if (modelFamily && !/^(unknown|scope|oscilloscope)$/i.test(modelFamily)) return false;
  const message = String(req.userMessage || '');
  if (/\b(MSO|DPO|70K|7K|5K)\b/i.test(message)) return false;
  return /\b(set|configure|trigger|measurement|measure|decode|search|fastframe|save waveform|scpi|flow)\b/i.test(
    message
  );
}

function derivePlannerInstrumentId(req: McpChatRequest): string {
  const mappedAlias =
    Array.isArray(req.flowContext.instrumentMap) &&
    req.flowContext.instrumentMap.length > 0 &&
    typeof req.flowContext.instrumentMap[0]?.alias === 'string'
      ? String(req.flowContext.instrumentMap[0]?.alias)
      : '';
  if (mappedAlias) return mappedAlias;
  if (req.flowContext.alias) return String(req.flowContext.alias);
  const deviceType = String(req.flowContext.deviceType || 'scope').toLowerCase();
  return `${deviceType}1`;
}

function buildPlannerStepLabel(command: string): string {
  const header = command.trim().split(/\s+/)[0] || command;
  if (/\?$/.test(header)) return `Read ${header.replace(/\?$/, '')}`;
  return header;
}

function normalizePlannerCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function isAcquireStateRunCommand(command: string): boolean {
  const normalized = normalizePlannerCommand(command);
  return /^ACQUIRE:STATE\s+(RUN|ON|1)\b/.test(normalized);
}

function isOpcCapableWriteCommand(command: string): boolean {
  const normalized = normalizePlannerCommand(command);
  return (
    isAcquireStateRunCommand(normalized) ||
    /^AUTOSET(\s|:).*EXECUTE\b/.test(normalized) ||
    /^CALIBRATE:INTERNAL(:START)?\b/.test(normalized) ||
    /^CALIBRATE:FACTORY\s+(START|CONTINUE|PREVIOUS)\b/.test(normalized) ||
    /^CH[1-8]:PROBE:(AUTOZERO|DEGAUSS)\s+EXECUTE\b/.test(normalized) ||
    /^DIAG:STATE\s+EXECUTE\b/.test(normalized) ||
    /^FACTORY\b/.test(normalized) ||
    /^RECALL:SETUP\b/.test(normalized) ||
    /^RECALL:WAVEFORM\b/.test(normalized) ||
    /^\*RST\b/.test(normalized) ||
    /^SAVE:IMAGE\b/.test(normalized) ||
    /^SAVE:SETUP\b/.test(normalized) ||
    /^SAVE:WAVEFORM\b/.test(normalized) ||
    /^TEKSECURE\b/.test(normalized) ||
    /^TRIGGER:A\s+SETLEVEL\b/.test(normalized)
  );
}

const PLANNER_MAX_CONCAT_COMMANDS = 3;

const COMMAND_GROUPS = {
  TRIGGER: (cmd: string) => cmd.startsWith('TRIGGER:'),
  BUS_CONFIG: (cmd: string) => cmd.startsWith('BUS:'),
  DISPLAY: (cmd: string) => cmd.startsWith('DISPLAY:'),
  ACQUIRE: (cmd: string) => cmd.startsWith('ACQUIRE:'),
  MEASURE: (cmd: string) => cmd.startsWith('MEASUREMENT:'),
  HORIZONTAL: (cmd: string) => cmd.startsWith('HORIZONTAL:'),
  CHANNEL: (cmd: string) => /^CH\d:/.test(cmd),
};

function plannerWriteBucket(command: string): string {
  const normalized = normalizePlannerCommand(command);
  if (!normalized) return 'UNKNOWN';

  if (COMMAND_GROUPS.BUS_CONFIG(normalized) && /^BUS:B\d+:/.test(normalized)) {
    const bus = normalized.match(/^BUS:(B\d+)/)?.[1] || 'B?';
    return `BUS:${bus}`;
  }
  if (COMMAND_GROUPS.DISPLAY(normalized) && /^DISPLAY:WAVEVIEW\d+:BUS:B\d+:/.test(normalized)) {
    const bus = normalized.match(/:BUS:(B\d+):/)?.[1] || 'B?';
    return `DISPLAY_BUS:${bus}`;
  }
  if (COMMAND_GROUPS.TRIGGER(normalized) && /^TRIGGER:A:BUS:B\d+:/.test(normalized)) {
    const bus = normalized.match(/^TRIGGER:A:BUS:(B\d+):/)?.[1] || 'B?';
    return `TRIGGER_BUS:${bus}`;
  }
  if (COMMAND_GROUPS.TRIGGER(normalized) && /^TRIGGER:A:BUS:SOURCE\s+B\d+\b/.test(normalized)) {
    const bus = normalized.match(/\b(B\d+)\b/)?.[1] || 'B?';
    return `TRIGGER_BUS:${bus}`;
  }
  if (COMMAND_GROUPS.TRIGGER(normalized)) return 'TRIGGER_GENERIC';
  if (COMMAND_GROUPS.ACQUIRE(normalized)) return 'ACQUIRE';
  if (COMMAND_GROUPS.MEASURE(normalized) && /^MEASUREMENT:ADDMEAS\b/.test(normalized)) return 'MEAS_ADD';
  if (COMMAND_GROUPS.MEASURE(normalized) && /^MEASUREMENT:MEAS\d+:SOURCE1\b/.test(normalized)) return 'MEAS_SOURCE';
  if (COMMAND_GROUPS.MEASURE(normalized)) return 'MEAS_OTHER';
  if (COMMAND_GROUPS.DISPLAY(normalized)) return 'DISPLAY_OTHER';
  return normalized.split(':')[0] || 'UNKNOWN';
}

function plannerCommandHeader(command: string): string {
  return normalizePlannerCommand(command).split(/\s+/)[0] || '';
}

function plannerCommandPriority(
  command: PlannerOutput['resolvedCommands'][number]
): number {
  if (command.header.startsWith('STEP:')) {
    if (command.stepType === 'save_waveform' || command.stepType === 'save_screenshot') return 80;
    return 75;
  }
  if (command.group === 'ERROR_CHECK') return 75;

  const normalized = normalizePlannerCommand(command.concreteCommand);
  const header = plannerCommandHeader(command.concreteCommand);

  if (command.commandType === 'query' && header !== '*OPC?') return 70;
  if (/^CH\d:/.test(header)) return 20;
  if (header.startsWith('BUS:')) return 30;
  if (header.startsWith('TRIGGER:')) return 40;
  if (header.startsWith('DISPLAY:')) return 50;
  if (
    header.startsWith('ACQUIRE:') ||
    header.startsWith('HORIZONTAL:FASTFRAME') ||
    header === '*OPC?'
  ) {
    return 60;
  }
  if (header.startsWith('MEASUREMENT:')) return command.commandType === 'query' ? 70 : 65;
  if (normalized.startsWith('SAVE:')) return 80;
  return 65;
}

function sortPlannerResolvedCommands(
  commands: PlannerOutput['resolvedCommands']
): PlannerOutput['resolvedCommands'] {
  return commands
    .map((command, index) => ({ command, index }))
    .sort((a, b) => {
      const priorityDelta = plannerCommandPriority(a.command) - plannerCommandPriority(b.command);
      if (priorityDelta !== 0) return priorityDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.command);
}

function plannerMergeFamily(command: string): string {
  const normalized = normalizePlannerCommand(command);
  const header = plannerCommandHeader(normalized);

  const busMatch = header.match(/^BUS:(B\d+):(RS232C|I2C|SPI|CAN|LIN)\b/);
  if (busMatch) return `BUS:${busMatch[1]}:${busMatch[2]}`;

  const triggerBusMatch = header.match(/^TRIGGER:A:BUS:(B\d+):(RS232C|I2C|SPI|CAN|LIN)\b/);
  if (triggerBusMatch) return `TRIGGER:${triggerBusMatch[1]}:${triggerBusMatch[2]}`;

  const triggerSourceBusMatch = normalized.match(/^TRIGGER:A:BUS:SOURCE\s+(B\d+)\b/);
  if (triggerSourceBusMatch) return `TRIGGER:${triggerSourceBusMatch[1]}`;

  const measurementSlotMatch = header.match(/^MEASUREMENT:MEAS(\d+):/);
  if (measurementSlotMatch) return `MEAS:${measurementSlotMatch[1]}`;

  if (header.startsWith('MEASUREMENT:ADDMEAS')) return 'MEAS:ADD';

  return header;
}

function canMergePlannerCommands(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (isAcquireStateRunCommand(left) || isAcquireStateRunCommand(right)) return false;
  if (plannerWriteBucket(left) !== plannerWriteBucket(right)) return false;
  const leftHeader = plannerCommandHeader(left);
  const rightHeader = plannerCommandHeader(right);
  if (leftHeader === rightHeader) return true;
  return plannerMergeFamily(left) === plannerMergeFamily(right);
}

function chunkCommands(commands: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < commands.length; i += size) {
    chunks.push(commands.slice(i, i + size));
  }
  return chunks;
}

function chunkPlannerWriteCommands(commands: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];

  const flushCurrent = () => {
    if (!current.length) return;
    chunks.push(current);
    current = [];
  };

  for (const command of commands) {
    if (!current.length) {
      current.push(command);
      continue;
    }
    const last = current[current.length - 1];
    const canMerge =
      current.length < PLANNER_MAX_CONCAT_COMMANDS &&
      canMergePlannerCommands(last, command);
    if (!canMerge) {
      flushCurrent();
      current.push(command);
      continue;
    }
    current.push(command);
  }

  flushCurrent();
  return chunks;
}

function buildActionsFromPlanner(
  plannerOutput: PlannerOutput,
  req: McpChatRequest
): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  if (!plannerOutput.resolvedCommands.length) return null;

  const existingSteps = Array.isArray(req.flowContext.steps)
    ? (req.flowContext.steps as Array<Record<string, unknown>>)
    : [];
  const hasExistingSteps = existingSteps.length > 0;
  const forceReplaceFlow =
    /\breplace(?:\s+the)?\s+(?:current\s+)?flow\b/i.test(String(req.userMessage || '')) ||
    /\bfrom scratch\b|\bnew flow\b|\bwipe\b/i.test(String(req.userMessage || ''));

  const instrumentId = derivePlannerInstrumentId(req);
  const flowSteps: Array<Record<string, unknown>> = hasExistingSteps
    ? []
    : [
        {
          id: '1',
          type: 'connect',
          label: 'Connect',
          params: { instrumentIds: [instrumentId], printIdn: true },
        },
      ];

  let nextId = hasExistingSteps ? 1 : 2;
  const nextStepId = () => String(nextId++);
  const pendingWrites: string[] = [];
  let pendingWriteGroup: string | null = null;
  const plannedNewSteps: Array<Record<string, unknown>> = [];
  const collectStep = (step: Record<string, unknown>) => {
    if (hasExistingSteps) {
      plannedNewSteps.push(step);
    } else {
      flowSteps.push(step);
    }
  };

  const flushPendingWrites = () => {
    if (!pendingWrites.length) return;
    const writeChunks = chunkPlannerWriteCommands(
      pendingWrites.splice(0, pendingWrites.length)
    );
    pendingWriteGroup = null;
    for (const [index, chunk] of writeChunks.entries()) {
      const baseLabel = buildPlannerStepLabel(chunk[0]);
      const label = baseLabel;
      collectStep(buildWriteStep(nextStepId(), label, chunk));
    }
  };

  const sortedResolvedCommands = sortPlannerResolvedCommands(plannerOutput.resolvedCommands);
  for (const command of sortedResolvedCommands) {
    if (command.header.startsWith('STEP:') && command.stepType) {
      flushPendingWrites();
      collectStep({
        id: nextStepId(),
        type: command.stepType,
        label: command.concreteCommand.replace(/^save_/, '').replace(/_/g, ' '),
        params: command.stepParams || {},
      });
      continue;
    }

    if (command.group === 'ERROR_CHECK') {
      flushPendingWrites();
      collectStep({
        id: nextStepId(),
        type: 'query',
        label: 'Read event status',
        params: { command: command.concreteCommand, saveAs: command.saveAs || 'error_status' },
      });
      continue;
    }

    if (command.commandType === 'query' || /\?$/.test(command.concreteCommand.trim())) {
      flushPendingWrites();
      collectStep(
        buildQueryStep(
          nextStepId(),
          buildPlannerStepLabel(command.concreteCommand),
          command.concreteCommand,
          command.saveAs
        )
      );
      continue;
    }

    if (isAcquireStateRunCommand(command.concreteCommand)) {
      flushPendingWrites();
      collectStep(
        buildWriteStep(
          nextStepId(),
          buildPlannerStepLabel(command.concreteCommand),
          [command.concreteCommand]
        )
      );
      collectStep(
        buildQueryStep(nextStepId(), 'Wait for acquisition complete', '*OPC?', 'acq_complete')
      );
      continue;
    }

    if (isOpcCapableWriteCommand(command.concreteCommand)) {
      flushPendingWrites();
      collectStep(
        buildWriteStep(
          nextStepId(),
          buildPlannerStepLabel(command.concreteCommand),
          [command.concreteCommand]
        )
      );
      collectStep(buildQueryStep(nextStepId(), 'Read operation complete', '*OPC?', 'opc'));
      continue;
    }

    const currentWriteBucket = plannerWriteBucket(command.concreteCommand);
    if (pendingWriteGroup && pendingWriteGroup !== currentWriteBucket) {
      flushPendingWrites();
    }
    pendingWriteGroup = currentWriteBucket;
    pendingWrites.push(command.concreteCommand);
  }

  flushPendingWrites();

  if (!hasExistingSteps) {
    flowSteps.push({
      id: nextStepId(),
      type: 'disconnect',
      label: 'Disconnect',
      params: {},
    });
  }

  const actions: Array<Record<string, unknown>> = [];

  if (!hasExistingSteps || forceReplaceFlow) {
    actions.push({
      type: 'replace_flow',
      flow: {
        name: `${String(req.flowContext.deviceType || 'Instrument')} Planner Flow`,
        description: String(req.userMessage || '').trim().slice(0, 160),
        backend: req.flowContext.backend,
        deviceType: req.flowContext.deviceType || 'SCOPE',
        deviceDriver: req.flowContext.deviceDriver,
        visaBackend: req.flowContext.visaBackend,
        steps: flowSteps,
      },
    });
  } else {
    const selectedStepId =
      req.flowContext.selectedStepId && String(req.flowContext.selectedStepId).trim()
        ? String(req.flowContext.selectedStepId).trim()
        : null;
    const disconnectStep = existingSteps.find((step) => String(step.type || '').toLowerCase() === 'disconnect');
    const fallbackTarget =
      selectedStepId ||
      (disconnectStep ? String(disconnectStep.id || '') : '') ||
      String(existingSteps[existingSteps.length - 1]?.id || '') ||
      '1';
    let targetStepId = fallbackTarget;
    const plannerInsertTs = Date.now();

    plannedNewSteps.forEach((step, idx) => {
      const plannerStepId = `planner_${plannerInsertTs}_${idx + 1}`;
      actions.push({
        type: 'insert_step_after',
        targetStepId,
        newStep: {
          ...step,
          id: plannerStepId,
        },
      });
      targetStepId = plannerStepId;
    });
  }

  const conflictFindings = (plannerOutput.conflicts || []).map((conflict) => {
    const scope = conflict.affectedResources.length
      ? ` [${conflict.affectedResources.join(', ')}]`
      : '';
    const suggestion = conflict.suggestion ? ` Suggestion: ${conflict.suggestion}` : '';
    return `${conflict.severity}: ${conflict.type}${scope} - ${conflict.message}${suggestion}`;
  });

  return `ACTIONS_JSON: ${JSON.stringify({
    summary: `Built ${plannerOutput.resolvedCommands.length} verified planner steps without a model call.`,
    findings: conflictFindings,
    suggestedFixes: [],
    actions,
  })}`;
}

async function buildPyvisaCommonServerShortcut(req: McpChatRequest): Promise<string | null> {
  if ((req.outputMode || '') !== 'steps_json') return null;
  const backend = (req.flowContext.backend || 'pyvisa').toLowerCase();
  if (backend !== 'pyvisa') return null;
  const deviceType = (req.flowContext.deviceType || 'SCOPE').toUpperCase();
  if (deviceType !== 'SCOPE') return null;

  const message = String(req.userMessage || '');
  const text = message.toLowerCase();
  if (/\b(spi|lin)\b/i.test(message)) {
    return null;
  }

  const existingSteps = Array.isArray(req.flowContext.steps) ? (req.flowContext.steps as Array<Record<string, unknown>>) : [];
  const hasExistingSteps = existingSteps.length > 0;
  const isLegacyDpoFamily = /\b(DPO|5K|7K|70K)\b/i.test(String(req.flowContext.modelFamily || ''));
  const forceReplaceFlow =
    /\bdisconnect\b/i.test(message) ||
    /\breplace(?:\s+the)?\s+(?:current\s+)?flow\b/i.test(message) ||
    /\bfrom scratch\b|\bfull workflow\b|\bfull flow\b/i.test(message);
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (existingSteps.find((step) => String(step.type || '').toLowerCase() === 'connect')?.id as string | undefined) ||
    (existingSteps[existingSteps.length - 1]?.id as string | undefined) ||
    null;

  const steps: Array<Record<string, unknown>> = hasExistingSteps
    ? []
    : [{ id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: ['scope1'], printIdn: true } }];
  let nextId = hasExistingSteps ? 1 : 2;
  const nextStepId = () => String(nextId++);
  const channelConfigs = extractChannelConfigs(message);
  const measurementChannel = detectMeasurementChannel(req) || channelConfigs[0]?.channel || 'CH1';
  const requestedMeasurements = detectMeasurementRequest(req);
  const genericMeasurementWorkflow = isGenericMeasurementWorkflowRequest(req);
  const appendMeasurements = isMeasurementAppendRequest(req);
  const busSlot = detectBusSlot(message, 'B1');
  const horizontal = extractHorizontalConfig(message);
  const i2cDecode = extractI2cDecodeConfig(message);
  const canDecode = extractCanDecodeConfig(message);
  const rs232Decode = extractRs232DecodeConfig(message);
  const i2cBusTrigger = extractI2cBusTrigger(message);
  const canSearch = extractCanSearchConfig(message, canDecode?.bus || busSlot);
  const delayMeasurements = extractDelayMeasurements(message);
  const setupHoldMeasurements = extractSetupHoldMeasurements(message, i2cDecode);
  const scopedMeasurements = extractScopedMeasurementRequests(message, measurementChannel);
  const normalizedScopedMeasurements =
    scopedMeasurements.length
      ? scopedMeasurements
      : requestedMeasurements.length
        ? buildDefaultMeasurementRequests(requestedMeasurements, measurementChannel)
        : [];

  const recallSessionPath = detectRecallSessionPath(message);
  if (/\bfactory defaults\b|\breset scope\b|\bfactory default\b/i.test(message)) {
    steps.push({
      id: nextStepId(),
      type: 'recall',
      label: 'Recall factory defaults',
      params: { recallType: 'FACTORY' },
    });
  } else if (recallSessionPath) {
    steps.push({
      id: nextStepId(),
      type: 'recall',
      label: 'Recall session',
      params: { recallType: 'SESSION', filePath: recallSessionPath },
    });
  }

  const wantsIdn = /\b(idn|identify)\b|\*idn\?/i.test(message);
  const wantsOptions = /\boptions?\b|\*opt\?/i.test(message);
  const wantsEsr = /\b(esr|event status)\b|\*esr\?/i.test(message);
  const wantsOpc = /\b(opc|operation complete)\b|\*opc\?/i.test(message);
  const wantsErrorQueue =
    /\b(error queue|allev|any errors?|check errors?|esr)\b/i.test(message);
  if (wantsIdn || wantsOptions || wantsEsr || wantsOpc || wantsErrorQueue) {
    if (wantsIdn) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read instrument ID',
        params: { command: '*IDN?', saveAs: 'idn' },
      });
    }
    if (wantsOptions) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read installed options',
        params: { command: '*OPT?', saveAs: 'options' },
      });
    }
    if (wantsEsr) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read event status',
        params: { command: '*ESR?', saveAs: 'esr' },
      });
    }
    if (wantsOpc) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read operation complete',
        params: { command: '*OPC?', saveAs: 'opc' },
      });
    }
    if (wantsErrorQueue) {
      steps.push({
        id: nextStepId(),
        type: 'query',
        label: 'Read event status for errors',
        params: { command: '*ESR?', saveAs: 'error_status' },
      });
    }
  }

  for (const config of channelConfigs) {
    const channelCommands = await finalizeShortcutCommands(req, [
      {
        header: 'CH<x>:SCAle',
        concreteHeader: `${config.channel}:SCAle`,
        value: config.scaleVolts,
      },
      ...(config.coupling ? [{
        header: 'CH<x>:COUPling',
        concreteHeader: `${config.channel}:COUPling`,
        value: config.coupling,
      } satisfies ShortcutFinalizeItem] : []),
      ...(typeof config.terminationOhms === 'number' ? [{
        header: 'CH<x>:TERmination',
        concreteHeader: `${config.channel}:TERmination`,
        value: config.terminationOhms,
      } satisfies ShortcutFinalizeItem] : []),
    ]);
    if (!channelCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${config.channel}`, channelCommands));
  }

  if (i2cDecode) {
    const busCommands = await finalizeShortcutCommands(req, [
      {
        header: 'BUS:ADDNew',
        concreteHeader: 'BUS:ADDNew',
        value: '"I2C"',
      },
      {
        header: 'BUS:B<x>:I2C:CLOCk:SOUrce',
        concreteHeader: `BUS:${i2cDecode.bus}:I2C:CLOCk:SOUrce`,
        value: i2cDecode.clockSource,
      },
      {
        header: 'BUS:B<x>:I2C:DATa:SOUrce',
        concreteHeader: `BUS:${i2cDecode.bus}:I2C:DATa:SOUrce`,
        value: i2cDecode.dataSource,
      },
      ...(typeof i2cDecode.clockThresholdVolts === 'number'
        ? [{
            header: 'BUS:B<x>:I2C:CLOCk:THReshold',
            concreteHeader: `BUS:${i2cDecode.bus}:I2C:CLOCk:THReshold`,
            value: i2cDecode.clockThresholdVolts,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(typeof i2cDecode.dataThresholdVolts === 'number'
        ? [{
            header: 'BUS:B<x>:I2C:DATa:THReshold',
            concreteHeader: `BUS:${i2cDecode.bus}:I2C:DATa:THReshold`,
            value: i2cDecode.dataThresholdVolts,
          } satisfies ShortcutFinalizeItem]
        : []),
      {
        header: 'DISplay:WAVEView<x>:BUS:B<x>:STATE',
        concreteHeader: `DISplay:WAVEView1:BUS:${i2cDecode.bus}:STATE`,
        value: 'ON',
      },
    ]);
    if (!busCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${i2cDecode.bus} I2C decode`, busCommands));
  }

  if (canDecode) {
    const canSource = channelToBusSourceValue(canDecode.sourceChannel);
    if (canSource === null) return null;
    const busCommands = await finalizeShortcutCommands(req, [
      {
        header: 'BUS:ADDNew',
        concreteHeader: 'BUS:ADDNew',
        value: '"CAN"',
      },
      {
        header: 'BUS:B<x>:CAN:SOUrce',
        concreteHeader: `BUS:${canDecode.bus}:CAN:SOUrce`,
        value: canSource,
      },
      ...(canDecode.nominalRate
        ? [{
            header: 'BUS:B<x>:CAN:BITRate',
            concreteHeader: `BUS:${canDecode.bus}:CAN:BITRate`,
            value: canDecode.nominalRate,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canDecode.dataRate
        ? [{
            header: 'BUS:B<x>:CAN:FD:BITRate',
            concreteHeader: `BUS:${canDecode.bus}:CAN:FD:BITRate`,
            value: canDecode.dataRate,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canDecode.standard
        ? [{
            header: 'BUS:B<x>:CAN:STANDard',
            concreteHeader: `BUS:${canDecode.bus}:CAN:STANDard`,
            value: canDecode.standard,
          } satisfies ShortcutFinalizeItem]
        : []),
      {
        header: 'DISplay:WAVEView<x>:BUS:B<x>:STATE',
        concreteHeader: `DISplay:WAVEView1:BUS:${canDecode.bus}:STATE`,
        value: 'ON',
      },
    ]);
    if (!busCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${canDecode.bus} CAN decode`, busCommands));
  }

  if (rs232Decode) {
    const rs232Commands = await finalizeShortcutCommands(req, [
      {
        header: 'BUS:ADDNew',
        concreteHeader: 'BUS:ADDNew',
        value: '"RS232C"',
      },
      {
        header: 'BUS:B<x>:RS232C:SOUrce',
        concreteHeader: `BUS:${rs232Decode.bus}:RS232C:SOUrce`,
        value: rs232Decode.sourceChannel,
      },
      ...(rs232Decode.bitRate
        ? [{
            header: 'BUS:B<x>:RS232C:BITRate',
            concreteHeader: `BUS:${rs232Decode.bus}:RS232C:BITRate`,
            value: rs232Decode.bitRate,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(typeof rs232Decode.dataBits === 'number'
        ? [{
            header: 'BUS:B<x>:RS232C:DATABits',
            concreteHeader: `BUS:${rs232Decode.bus}:RS232C:DATABits`,
            value: rs232Decode.dataBits,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(rs232Decode.parity
        ? [{
            header: 'BUS:B<x>:RS232C:PARity',
            concreteHeader: `BUS:${rs232Decode.bus}:RS232C:PARity`,
            value: rs232Decode.parity,
          } satisfies ShortcutFinalizeItem]
        : []),
      {
        header: 'DISplay:WAVEView<x>:BUS:B<x>:STATE',
        concreteHeader: `DISplay:WAVEView1:BUS:${rs232Decode.bus}:STATE`,
        value: 'ON',
      },
    ]);
    if (!rs232Commands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${rs232Decode.bus} RS232 decode`, rs232Commands));
  }

  const trigger = extractEdgeTrigger(message);
  if (trigger.source || trigger.mode || typeof trigger.holdoffSeconds === 'number') {
    const triggerItems: ShortcutFinalizeItem[] = [];
    if (trigger.source) {
      triggerItems.push({
        header: 'TRIGger:{A|B}:EDGE:SOUrce',
        concreteHeader: 'TRIGger:A:EDGE:SOUrce',
        value: trigger.source,
      });
    }
    if (trigger.slope) {
      triggerItems.push({
        header: 'TRIGger:{A|B}:EDGE:SLOpe',
        concreteHeader: 'TRIGger:A:EDGE:SLOpe',
        value: trigger.slope,
      });
    }
    if (trigger.source && typeof trigger.levelVolts === 'number') {
      triggerItems.push({
        header: 'TRIGger:A:LEVel:CH<x>',
        concreteHeader: `TRIGger:A:LEVel:${trigger.source}`,
        value: trigger.levelVolts,
      });
    }
    if (trigger.mode) {
      triggerItems.push({
        header: 'TRIGger:A:MODe',
        concreteHeader: 'TRIGger:A:MODe',
        value: trigger.mode,
      });
    }
    const triggerCommands = await finalizeShortcutCommands(req, triggerItems);
    if (triggerItems.length && !triggerCommands) return null;
    if (triggerCommands && triggerCommands.length) {
      steps.push(buildWriteStep(nextStepId(), 'Configure trigger', triggerCommands));
    }
    if (typeof trigger.holdoffSeconds === 'number') {
      const holdoffCommands = await finalizeShortcutCommands(req, [{
        header: 'TRIGger:A:HOLDoff:TIMe',
        concreteHeader: 'TRIGger:A:HOLDoff:TIMe',
        value: trigger.holdoffSeconds,
      }]);
      if (!holdoffCommands) return null;
      steps.push(buildWriteStep(nextStepId(), 'Set trigger holdoff', holdoffCommands));
    }
  }

  if (i2cBusTrigger) {
    const triggerCommands = await finalizeShortcutCommands(req, [
      {
        header: 'TRIGger:{A|B}:TYPe',
        concreteHeader: 'TRIGger:A:TYPe',
        value: 'BUS',
      },
      {
        header: 'TRIGger:{A|B}:BUS:B<x>:I2C:CONDition',
        concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:CONDition`,
        value: 'ADDRess',
      },
      ...(i2cBusTrigger.direction
        ? [{
            header: 'TRIGger:{A|B}:BUS:B<x>:I2C:DATa:DIRection',
            concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:DATa:DIRection`,
            value: i2cBusTrigger.direction,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(i2cBusTrigger.addressMode
        ? [{
            header: 'TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:MODe',
            concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:ADDRess:MODe`,
            value: i2cBusTrigger.addressMode,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(i2cBusTrigger.addressValue
        ? [{
            header: 'TRIGger:{A|B}:BUS:B<x>:I2C:ADDRess:VALue',
            concreteHeader: `TRIGger:A:BUS:${i2cBusTrigger.bus}:I2C:ADDRess:VALue`,
            value: `"${i2cBusTrigger.addressValue}"`,
          } satisfies ShortcutFinalizeItem]
        : []),
    ]);
    if (!triggerCommands) return null;
    steps.push(buildWriteStep(nextStepId(), `Configure ${i2cBusTrigger.bus} I2C trigger`, triggerCommands));
  }

  const acquisitionItems: ShortcutFinalizeItem[] = [];
  if (/\bsingle (?:acquisition|sequence)\b/i.test(message)) {
    acquisitionItems.push({
      header: 'ACQuire:STOPAfter',
      concreteHeader: 'ACQuire:STOPAfter',
      value: 'SEQuence',
    });
    acquisitionItems.push({
      header: 'ACQuire:STATE',
      concreteHeader: 'ACQuire:STATE',
      value: 'ON',
    });
  }
  const averageMatch = message.match(/\baverage(?: acquisition)?\s+(\d+)\b/i) || message.match(/\baverage\s+(\d+)\s+waveforms?\b/i);
  if (averageMatch) {
    acquisitionItems.push({
      header: 'ACQuire:MODe',
      concreteHeader: 'ACQuire:MODe',
      value: 'AVErage',
    });
    acquisitionItems.push({
      header: 'ACQuire:NUMAVg',
      concreteHeader: 'ACQuire:NUMAVg',
      value: Number(averageMatch[1]),
    });
  }
  if (/\bcontinuous\b|\brun continuous(?:ly)?\b/i.test(message)) {
    acquisitionItems.push({
      header: 'ACQuire:STOPAfter',
      concreteHeader: 'ACQuire:STOPAfter',
      value: 'RUNSTop',
    });
    acquisitionItems.push({
      header: 'ACQuire:STATE',
      concreteHeader: 'ACQuire:STATE',
      value: 'RUN',
    });
  }
  if (horizontal.fastAcqPalette) {
    acquisitionItems.push({
      header: 'ACQuire:FASTAcq:STATE',
      concreteHeader: 'ACQuire:FASTAcq:STATE',
      value: 'ON',
    });
    acquisitionItems.push({
      header: 'ACQuire:FASTAcq:PALEtte',
      concreteHeader: 'ACQuire:FASTAcq:PALEtte',
      value: horizontal.fastAcqPalette,
    });
  }
  const saveSetupPath = detectSaveSetupPath(message);
  if (saveSetupPath) {
    acquisitionItems.push({
      header: 'SAVe:SETUp',
      concreteHeader: 'SAVe:SETUp',
      value: `"${saveSetupPath}"`,
    });
  }
  if (acquisitionItems.length) {
    const acquisitionCommands = await finalizeShortcutCommands(req, acquisitionItems);
    if (!acquisitionCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Configure acquisition/save', acquisitionCommands));
  }

  const horizontalItems: ShortcutFinalizeItem[] = [];
  if (typeof horizontal.scaleSeconds === 'number') {
    horizontalItems.push({
      header: 'HORizontal:SCAle',
      concreteHeader: 'HORizontal:SCAle',
      value: horizontal.scaleSeconds,
    });
  }
  if (typeof horizontal.recordLength === 'number') {
    horizontalItems.push({
      header: 'HORizontal:MODe',
      concreteHeader: 'HORizontal:MODe',
      value: 'MANual',
    });
    horizontalItems.push({
      header: 'HORizontal:RECOrdlength',
      concreteHeader: 'HORizontal:RECOrdlength',
      value: horizontal.recordLength,
    });
  }
  if (typeof horizontal.fastFrameCount === 'number') {
    horizontalItems.push({
      header: 'HORizontal:FASTframe:STATE',
      concreteHeader: 'HORizontal:FASTframe:STATE',
      value: 'ON',
    });
    horizontalItems.push({
      header: 'HORizontal:FASTframe:COUNt',
      concreteHeader: 'HORizontal:FASTframe:COUNt',
      value: horizontal.fastFrameCount,
    });
  }
  if (horizontalItems.length) {
    const horizontalCommands = await finalizeShortcutCommands(req, horizontalItems);
    if (!horizontalCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Configure horizontal', horizontalCommands));
  }

  if (canSearch && canDecode && canSearch.condition !== 'DATA') {
    const searchCommands = await finalizeShortcutCommands(req, [
      {
        header: 'SEARCH:SEARCH<x>:TRIGger:A:TYPe',
        concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:TYPe',
        value: 'Bus',
      },
      {
        header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:SOUrce',
        concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:SOUrce',
        value: canSearch.bus,
      },
      {
        header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition',
        concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition',
        value: canSearch.condition,
      },
      ...(canSearch.frameType
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FRAMEtype',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype',
            value: canSearch.frameType,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canSearch.errType
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:ERRType',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:ERRType',
            value: canSearch.errType,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canSearch.brsBit
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FD:BRSBit',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FD:BRSBit',
            value: canSearch.brsBit,
          } satisfies ShortcutFinalizeItem]
        : []),
      ...(canSearch.esiBit
        ? [{
            header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FD:ESIBit',
            concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FD:ESIBit',
            value: canSearch.esiBit,
          } satisfies ShortcutFinalizeItem]
        : []),
    ]);
    if (!searchCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Configure CAN search', searchCommands));
  }

  const wantsQueries = shouldQueryMeasurementResults(req) || genericMeasurementWorkflow;
  let measurementSlot = 1;
  if (appendMeasurements && (normalizedScopedMeasurements.length || delayMeasurements.length || setupHoldMeasurements.length)) {
    return null;
  }
  if (normalizedScopedMeasurements.length || delayMeasurements.length || setupHoldMeasurements.length) {
    const resetCommands = await finalizeShortcutCommands(req, [{
      header: 'MEASUrement:DELETEALL',
      concreteHeader: 'MEASUrement:DELETEALL',
    }]);
    if (!resetCommands) return null;
    steps.push(buildWriteStep(nextStepId(), 'Clear existing measurements', resetCommands));
  }
  if (normalizedScopedMeasurements.length) {
    const addChildren: Array<Record<string, unknown>> = [];
    const queryChildren: Array<Record<string, unknown>> = [];
    for (const { measurement, channel } of normalizedScopedMeasurements) {
      const addCommands = await finalizeShortcutCommands(req, [
        ...(isLegacyDpoFamily
          ? ([
              {
                header: 'MEASUrement:MEAS<x>:TYPe',
                concreteHeader: `MEASUrement:MEAS${measurementSlot}:TYPe`,
                value: measurement,
              },
              {
                header: 'MEASUrement:MEAS<x>:SOURCE',
                concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOURCE`,
                value: channel,
              },
            ] satisfies ShortcutFinalizeItem[])
          : ([
              {
                header: 'MEASUrement:ADDMEAS',
                concreteHeader: 'MEASUrement:ADDMEAS',
                value: measurement,
              },
              {
                header: 'MEASUrement:MEAS<x>:SOUrce<x>',
                concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce1`,
                value: channel,
              },
            ] satisfies ShortcutFinalizeItem[])),
      ]);
      if (!addCommands) return null;
      addChildren.push(buildWriteStep(`m${measurementSlot}`, `Add ${measurement.toLowerCase()} measurement on ${channel}`, addCommands));
      if (wantsQueries) {
        const queryCommands = await finalizeShortcutCommands(req, [{
          header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:RESUlts:CURRentacq:MEAN`,
          commandType: 'query',
        }]);
        if (!queryCommands || !queryCommands[0]) return null;
        queryChildren.push({
          id: `q${measurementSlot}`,
          type: 'query',
          label: `Query ${measurement.toLowerCase()} result for ${channel}`,
          params: {
            command: queryCommands[0],
            saveAs: normalizeMeasurementSaveAs(channel, measurement),
          },
        });
      }
      measurementSlot += 1;
    }
    steps.push({
      id: nextStepId(),
      type: 'group',
      label: 'Add measurements',
      params: {},
      collapsed: false,
      children: addChildren,
    });
    if (queryChildren.length) {
      steps.push({
        id: nextStepId(),
        type: 'group',
        label: 'Read measurement results',
        params: {},
        collapsed: false,
        children: queryChildren,
      });
    }
  }

  if (delayMeasurements.length) {
    const addChildren: Array<Record<string, unknown>> = [];
    const queryChildren: Array<Record<string, unknown>> = [];

    for (const delay of delayMeasurements) {
      const thresholdItems: ShortcutFinalizeItem[] = [];
      if (typeof delay.thresholdVolts === 'number') {
        thresholdItems.push({
          header: 'MEASUrement:MEAS<x>:REFLevels<x>:METHod',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:REFLevels2:METHod`,
          value: 'ABSolute',
        });
        const suffixes =
          delay.toEdge === 'FALL'
            ? ['FALLLow', 'FALLMid', 'FALLHigh']
            : ['RISELow', 'RISEMid', 'RISEHigh'];
        suffixes.forEach((suffix) => {
          thresholdItems.push({
            header: `MEASUrement:MEAS<x>:REFLevels<x>:ABSolute:${suffix}`,
            concreteHeader: `MEASUrement:MEAS${measurementSlot}:REFLevels2:ABSolute:${suffix}`,
            value: delay.thresholdVolts as number,
          });
        });
      }

      const addCommands = await finalizeShortcutCommands(req, [
        {
          header: 'MEASUrement:ADDMEAS',
          concreteHeader: 'MEASUrement:ADDMEAS',
          value: 'DELAY',
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce1`,
          value: delay.fromChannel,
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce2`,
          value: delay.toChannel,
        },
        {
          header: 'MEASUrement:MEAS<x>:DELay:EDGE<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:DELay:EDGE1`,
          value: delay.fromEdge,
        },
        {
          header: 'MEASUrement:MEAS<x>:DELay:EDGE<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:DELay:EDGE2`,
          value: delay.toEdge,
        },
        ...thresholdItems,
      ]);
      if (!addCommands) return null;

      addChildren.push(
        buildWriteStep(
          `d${measurementSlot}`,
          `Add delay measurement ${delay.fromChannel} to ${delay.toChannel}`,
          addCommands
        )
      );

      if (wantsQueries) {
        const queryCommands = await finalizeShortcutCommands(req, [{
          header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:RESUlts:CURRentacq:MEAN`,
          commandType: 'query',
        }]);
        if (!queryCommands || !queryCommands[0]) return null;
        queryChildren.push({
          id: `dq${measurementSlot}`,
          type: 'query',
          label: `Query delay ${delay.fromChannel} to ${delay.toChannel}`,
          params: {
            command: queryCommands[0],
            saveAs: `delay_${delay.fromChannel.toLowerCase()}_to_${delay.toChannel.toLowerCase()}`,
          },
        });
      }

      measurementSlot += 1;
    }

    steps.push({
      id: nextStepId(),
      type: 'group',
      label: 'Add delay measurements',
      params: {},
      collapsed: false,
      children: addChildren,
    });
    if (queryChildren.length) {
      steps.push({
        id: nextStepId(),
        type: 'group',
        label: 'Read delay results',
        params: {},
        collapsed: false,
        children: queryChildren,
      });
    }
  }

  if (setupHoldMeasurements.length) {
    const addChildren: Array<Record<string, unknown>> = [];
    const queryChildren: Array<Record<string, unknown>> = [];

    for (const measurementRequest of setupHoldMeasurements) {
      const addCommands = await finalizeShortcutCommands(req, [
        ...(isLegacyDpoFamily
          ? ([{
              header: 'MEASUrement:MEAS<x>:TYPe',
              concreteHeader: `MEASUrement:MEAS${measurementSlot}:TYPe`,
              value: measurementRequest.measurement,
            }] satisfies ShortcutFinalizeItem[])
          : ([{
              header: 'MEASUrement:ADDMEAS',
              concreteHeader: 'MEASUrement:ADDMEAS',
              value: measurementRequest.measurement,
            }] satisfies ShortcutFinalizeItem[])),
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce1`,
          value: measurementRequest.source1,
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:SOUrce2`,
          value: measurementRequest.source2,
        },
      ]);
      if (!addCommands) return null;

      addChildren.push(
        buildWriteStep(
          `sh${measurementSlot}`,
          `Add ${measurementRequest.measurement.toLowerCase()} measurement ${measurementRequest.source1} to ${measurementRequest.source2}`,
          addCommands
        )
      );

      if (wantsQueries) {
        const queryCommands = await finalizeShortcutCommands(req, [{
          header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
          concreteHeader: `MEASUrement:MEAS${measurementSlot}:RESUlts:CURRentacq:MEAN`,
          commandType: 'query',
        }]);
        if (!queryCommands || !queryCommands[0]) return null;
        queryChildren.push({
          id: `shq${measurementSlot}`,
          type: 'query',
          label: `Query ${measurementRequest.measurement.toLowerCase()} result`,
          params: {
            command: queryCommands[0],
            saveAs: normalizeSetupHoldSaveAs(measurementRequest),
          },
        });
      }

      measurementSlot += 1;
    }

    steps.push({
      id: nextStepId(),
      type: 'group',
      label: 'Add setup/hold measurements',
      params: {},
      collapsed: false,
      children: addChildren,
    });
    if (queryChildren.length) {
      steps.push({
        id: nextStepId(),
        type: 'group',
        label: 'Read setup/hold results',
        params: {},
        collapsed: false,
        children: queryChildren,
      });
    }
  }

  if (/\berror queue\b|\bprint any errors\b|\bcheck.*errors?\b/i.test(message)) {
    steps.push({
      id: nextStepId(),
      type: 'query',
      label: 'Read event status for errors',
      params: { command: '*ESR?', saveAs: 'error_status' },
    });
  }

  if (wantsFastFrameTimestampQuery(message)) {
    const timestampCommands = await finalizeShortcutCommands(req, [{
      header: 'HORizontal:FASTframe:TIMEStamp:ALL',
      concreteHeader: 'HORizontal:FASTframe:TIMEStamp:ALL',
      commandType: 'query',
    }]);
    if (!timestampCommands || !timestampCommands[0]) return null;
    steps.push({
      id: nextStepId(),
      type: 'query',
      label: 'Query FastFrame timestamps',
      params: {
        command: timestampCommands[0],
        saveAs: 'fastframe_timestamps',
      },
    });
  }

  const waveformSources = detectWaveformSources(message);
  if (waveformSources.length) {
    const format = detectWaveformFormat(message);
    waveformSources.forEach((source) => {
      steps.push({
        id: nextStepId(),
        type: 'save_waveform',
        label: `Save ${source} waveform`,
        params: {
          source,
          filename: `${source.toLowerCase()}.${format}`,
          format,
        },
      });
    });
  }

  if (typeof horizontal.continuousSeconds === 'number' && horizontal.continuousSeconds > 0) {
    steps.push({
      id: nextStepId(),
      type: 'sleep',
      label: 'Run continuous acquisition',
      params: { duration: horizontal.continuousSeconds },
    });
  }

  if (/\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/i.test(message)) {
    steps.push({
      id: nextStepId(),
      type: 'save_screenshot',
      label: 'Save screenshot',
      params: { filename: 'capture.png', scopeType: 'modern', method: 'pc_transfer' },
    });
  }

  if (steps.length === 0) return null;

  if (!hasExistingSteps) {
    if (steps.length <= 1) return null;
    steps.push({ id: nextStepId(), type: 'disconnect', label: 'Disconnect', params: {} });
  }

  const actions =
    hasExistingSteps && insertAfterId && !forceReplaceFlow
      ? (() => {
          const inserts: Array<Record<string, unknown>> = [];
          let currentTarget = insertAfterId;
          steps.forEach((step) => {
            inserts.push({
              type: 'insert_step_after',
              targetStepId: currentTarget,
              newStep: step,
            });
            currentTarget = String(step.id || currentTarget);
          });
          return inserts;
        })()
      : [{
          type: 'replace_flow',
          flow: {
            name: 'Generated Flow',
            description: 'Common TekAutomate scope flow built server-side.',
            backend,
            deviceType: req.flowContext.deviceType || 'SCOPE',
            steps,
          },
        }];

  if (hasExistingSteps && !Array.isArray(actions)) {
    return null;
  }

  return `ACTIONS_JSON: ${JSON.stringify({
    summary: 'Built a server-side common TekAutomate flow.',
    findings: [],
    suggestedFixes: [],
    actions,
  })}`;
}

function buildTmDevicesMeasurementShortcut(req: McpChatRequest): string | null {
  if ((req.outputMode || '') !== 'steps_json') return null;
  if ((req.flowContext.backend || '').toLowerCase() !== 'tm_devices') return null;
  if ((req.flowContext.deviceType || '').toUpperCase() !== 'SCOPE') return null;

  const measurements = detectMeasurementRequest(req);
  const channel = detectMeasurementChannel(req);
  if (!measurements.length || !channel) return null;

  const model = req.flowContext.modelFamily || 'MSO6B';
  const existingSteps = Array.isArray(req.flowContext.steps) ? req.flowContext.steps : [];
  const hasScreenshot = /\bscreenshot\b|\bscreen shot\b|\bcapture screen\b/.test(req.userMessage.toLowerCase());
  const insertAfterId =
    (req.flowContext.selectedStepId && String(req.flowContext.selectedStepId)) ||
    (existingSteps.find((step) => String(step.type || '') === 'connect')?.id as string | undefined) ||
    null;

  const measurementSteps = measurements.flatMap((measurement, index) => {
    const slot = index + 1;
    const baseId = `m${slot}`;
    const sourceField = 'source1';
    const resultVar =
      measurement === 'FREQUENCY'
        ? 'frequency_ch1'
        : measurement === 'AMPLITUDE'
          ? 'amplitude_ch1'
          : 'positive_overshoot_ch1';
    return [
      {
        id: `${baseId}a`,
        type: 'tm_device_command',
        label: `Add ${measurement} measurement`,
        params: {
          code: `scope.commands.measurement.addmeas.write("${measurement}")`,
          model,
          description: `Add ${measurement} measurement`,
        },
      },
      {
        id: `${baseId}b`,
        type: 'tm_device_command',
        label: `Set ${measurement} source to ${channel}`,
        params: {
          code: `scope.commands.measurement.meas[${slot}].${sourceField}.write("${channel}")`,
          model,
          description: `Set ${measurement} source to ${channel}`,
        },
      },
      {
        id: `${baseId}c`,
        type: 'tm_device_command',
        label: `Read ${measurement} value`,
        params: {
          code: `${resultVar} = scope.commands.measurement.meas[${slot}].results.currentacq.mean.query()`,
          model,
          description: `Read ${measurement} value`,
        },
      },
    ];
  });

  const extraSteps = hasScreenshot
    ? [
        {
          id: 'ss1',
          type: 'comment',
          label: 'Screenshot requested',
          params: {
            text: 'tm_devices backend does not support save_screenshot step directly; add a Python or platform-specific capture step if needed.',
          },
        },
      ]
    : [];

  const actions =
    existingSteps.length && insertAfterId
      ? [...measurementSteps, ...extraSteps].map((step) => ({
          type: 'insert_step_after',
          targetStepId: insertAfterId,
          newStep: step,
        }))
      : [
          {
            type: 'replace_flow',
            flow: {
              name: 'Measurement Flow',
              description: `Add ${measurements.join(', ')} measurements on ${channel}`,
              backend: 'tm_devices',
              deviceType: req.flowContext.deviceType || 'SCOPE',
              steps: [
                { id: '1', type: 'connect', label: 'Connect to Scope', params: { printIdn: true } },
                ...measurementSteps,
                ...extraSteps,
                { id: '99', type: 'disconnect', label: 'Disconnect', params: {} },
              ],
            },
          },
        ];

  const findings =
    hasScreenshot
      ? ['Added measurement steps. Screenshot on tm_devices backend may require a Python or backend-specific capture step.']
      : [];

  return `ACTIONS_JSON: {"summary":"Added ${escapeJsonString(measurements.join(', '))} measurements on ${escapeJsonString(channel)}.","findings":[${findings.map((f) => `"${escapeJsonString(f)}"`).join(',')}],"suggestedFixes":[],"actions":${JSON.stringify(actions)}}`;
}

function clipString(value: unknown, max = 280): unknown {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function slimScpiEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const directExample =
    entry.example && typeof entry.example === 'object'
      ? (entry.example as Record<string, unknown>)
      : null;
  const examples = Array.isArray(entry.codeExamples)
    ? (entry.codeExamples as Array<Record<string, unknown>>)
    : [];
  const firstExample = examples[0] && typeof examples[0] === 'object'
    ? (examples[0] as Record<string, unknown>)
    : null;
  const resolvedExample = directExample || firstExample;
  const argumentsList = Array.isArray(entry.arguments)
    ? (entry.arguments as unknown[])
        .filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === 'object')
        .slice(0, 3)
        .map((arg) => ({
          name: arg.name,
          type: arg.type,
          description: clipString(arg.description || arg.shortDescription || arg.text, 180),
          required: arg.required,
        }))
    : [];
  const relatedCommands = Array.isArray(entry.relatedCommands)
    ? (entry.relatedCommands as unknown[])
        .filter((cmd): cmd is string => typeof cmd === 'string')
        .slice(0, 5)
    : [];
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: clipString(entry.shortDescription, 200),
    syntax: entry.syntax,
    codeExamples: resolvedExample
      ? {
          scpi: (resolvedExample.scpi as Record<string, unknown> | undefined)?.code || resolvedExample.scpi,
          python: (resolvedExample.python as Record<string, unknown> | undefined)?.code || resolvedExample.python,
          tm_devices:
            (resolvedExample.tm_devices as Record<string, unknown> | undefined)?.code ||
            resolvedExample.tm_devices,
        }
      : undefined,
    notes: Array.isArray(entry.notes) ? (entry.notes as unknown[]).slice(0, 2).map((n) => clipString(n, 180)) : [],
    arguments: argumentsList,
    validValues: entry.validValues,
    relatedCommands,
  };
}

function logToolCall(name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[MCP] tool call: ${name} ${JSON.stringify(args)}`);
}

function logToolResult(name: string, result: unknown) {
  const payload = (result || {}) as Record<string, unknown>;
  const ok = payload.ok === true;
  const dataRaw = payload.data;
  const data = Array.isArray(dataRaw)
    ? dataRaw
    : dataRaw && typeof dataRaw === 'object'
      ? [dataRaw]
      : [];
  const verifiedCount = data.filter((d) => {
    if (!d || typeof d !== 'object') return false;
    return (d as Record<string, unknown>).verified === true;
  }).length;
  // eslint-disable-next-line no-console
  if (name === 'verify_scpi_commands') {
    console.log(`[MCP] tool result: ${name} ok=${ok} count=${data.length} verified=${verifiedCount}`);
  } else {
    console.log(`[MCP] tool result: ${name} ok=${ok} count=${data.length}`);
  }
}

function buildSystemPrompt(modePrompt: string, outputMode: 'steps_json' | 'blockly_xml'): string {
  const modeLabel = outputMode === 'blockly_xml' ? 'Blockly XML' : 'Steps UI JSON';
  return [
    '# TekAutomate MCP Runtime',
    'You are the live TekAutomate assistant inside the app. Build, edit, validate, and explain the current workspace.',
    '',
    '## Runtime Contract',
    `- Current target mode: ${modeLabel}. Respect that mode exactly.`,
    '- The live workspace context is authoritative: backend, device map, editor mode, current steps, selected step, logs, and audit output outrank generic preferences.',
    '- Build directly when the request is clear. Do not stall in confirmation loops for normal edits.',
    '- Use MCP tools only when you need exact command syntax, tm_devices API paths, block schema details, runtime state, or known-failure context.',
    '- Prefer one focused tool call over serial tool chains. Zero tool calls is fine when the workspace and prompt already give enough context.',
    '- If the user asks to add, insert, update, fix, move, remove, replace, convert, apply, or "do it", return actionable changes in this response, not promises.',
    '- Never claim a change is already applied. You are proposing actions for the app to apply.',
    '- Never output Python unless the user explicitly asks for Python.',
    '- Prefer separate write/query steps over semicolon-chained multi-command strings unless the user explicitly asks for a single combined command.',
    '- Prefer grouped flow structure for readability: for multi-phase flows, organize steps into phase groups (setup/config/trigger/measure/save/cleanup) unless the user asks for flat steps.',
    '',
    '## MCP Tools',
    '- search_scpi / get_command_by_header: use when exact SCPI syntax is genuinely uncertain.',
    '- search_tm_devices: use only for tm_devices backend or explicit SCPI <-> tm_devices conversion.',
    '- retrieve_rag_chunks: use for TekAutomate app logic, backend behavior, templates, Blockly behavior, and known patterns.',
    '- list_valid_step_types / get_block_schema: use when you are unsure which step or block shape TekAutomate supports.',
    '- validate_action_payload: optional final sanity check for complex grouped edits; not required for every simple edit.',
    '- get_instrument_state / probe_command: use only when live executor context is available and runtime probing is necessary.',
    '',
    '## Validation Priority',
    '- User-visible truth comes first. If a flow already runs or logs prove success, do not invent blocker-level schema complaints.',
    '- A blocker must prevent apply, generation, or execution. Style cleanup, inferred defaults, and backend normalization are warnings at most.',
    '',
    '## Mode Builder Contract',
    modePrompt,
  ].join('\n');
}

function buildAttachmentContext(req: McpChatRequest): string {
  const attachments = Array.isArray(req.attachments) ? req.attachments : [];
  if (!attachments.length) return '';
  const lines: string[] = ['Attached files from user (treat as additional context):'];
  attachments.slice(0, 6).forEach((file, index) => {
    const name = String(file?.name || `file_${index + 1}`);
    const mimeType = String(file?.mimeType || 'application/octet-stream');
    const size = Number(file?.size || 0);
    lines.push(`${index + 1}. ${name} (${mimeType}, ${size} bytes)`);
    const excerpt = String(file?.textExcerpt || '').trim();
    if (excerpt) {
      const clipped = excerpt.length > 2000 ? `${excerpt.slice(0, 2000)}...[truncated]` : excerpt;
      lines.push(`   text excerpt:\n${clipped}`);
    } else if (mimeType.startsWith('image/')) {
      lines.push('   image attachment included.');
    } else if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      lines.push('   pdf attachment included (no inline text extracted).');
    }
  });
  return lines.join('\n');
}

function buildUserPrompt(req: McpChatRequest, flowCommandIssues: string[] = []): string {
  const fc = req.flowContext;
  const rc = req.runContext;
  const validateMode = isValidationRequest(req);
  const flowValidateMode = isFlowValidationRequest(req);
  const logReviewMode = isLogReviewRequest(req);
  const executionSucceeded = runLooksSuccessful(rc);
  const flatSteps = flattenSteps(Array.isArray(fc.steps) ? fc.steps : []);
  const stepsSummary = flatSteps.length
    ? flatSteps
        .slice(0, 18)
        .map((s) =>
          `  [${s.id}] ${s.type}${s.label ? ` "${s.label}"` : ''}${typeof (s.params as Record<string, unknown> | undefined)?.command === 'string' ? ` -> ${String((s.params as Record<string, unknown>).command)}` : ''}`
        )
        .join('\n')
    : '  (empty flow)';
  const compactStepsJson = JSON.stringify(fc.steps || []);
  const stepsJsonPreview = (logReviewMode || flowValidateMode)
    ? compactStepsJson
    : compactStepsJson.length > 1600
      ? `${compactStepsJson.slice(0, 1600)}...[truncated ${compactStepsJson.length - 1600} chars]`
      : compactStepsJson;

  const instrumentLine = `  - scope1: ${fc.deviceType || 'SCOPE'}, ${fc.backend || 'pyvisa'} @ ${fc.host || 'localhost'}`;
  const instrumentMapLines = Array.isArray(fc.instrumentMap) && fc.instrumentMap.length
    ? fc.instrumentMap
        .map((device) =>
          `  - ${String(device.alias || 'device')}: ${String(device.deviceType || 'SCOPE')}, ${String(device.backend || 'pyvisa')}${device.deviceDriver ? `, driver ${String(device.deviceDriver)}` : ''}${device.visaBackend ? `, visa ${String(device.visaBackend)}` : ''}${device.host ? ` @ ${String(device.host)}` : ''}`
        )
        .join('\n')
    : instrumentLine;
  const parts = [
    'Live workspace context:',
    `- editor: ${fc.executionSource === 'blockly' ? 'Blockly' : 'Steps'}`,
    `- backend: ${fc.backend || 'pyvisa'}`,
    `- modelFamily: ${fc.modelFamily || '(unknown)'}`,
    `- connection: ${fc.connectionType || 'tcpip'}`,
    `- deviceType: ${fc.deviceType || 'SCOPE'}`,
    `- deviceDriver: ${fc.deviceDriver || '(unknown)'}`,
    `- visaBackend: ${fc.visaBackend || '(unknown)'}`,
    `- alias: ${fc.alias || 'scope1'}`,
    '- instruments:',
    instrumentMapLines,
    '',
    `Current flow (${flatSteps.length} flattened steps):`,
    `${stepsSummary}${flatSteps.length > 18 ? '\n  ...more steps omitted' : ''}`,
    '',
    'Current steps JSON preview:',
    stepsJsonPreview || '[]',
    '',
    'User request:',
    req.userMessage,
  ];

  const attachmentContext = buildAttachmentContext(req);
  if (attachmentContext) {
    parts.push(attachmentContext);
  }

  if (fc.selectedStep) {
    parts.push(`## Selected Step (user is focused on this)\n${JSON.stringify(fc.selectedStep, null, 2)}`);
  } else if (fc.selectedStepId) {
    parts.push(`## Selected Step ID\n${fc.selectedStepId}`);
  }

  if (fc.validationErrors && (fc.validationErrors as string[]).length > 0) {
    parts.push(`Current flow validation errors:\n${(fc.validationErrors as string[]).map((e: string) => `- ${e}`).join('\n')}`);
  }

  if (rc.runStatus !== 'idle' && !flowValidateMode) {
    parts.push(`Run status: ${rc.runStatus}${rc.exitCode !== null ? ` (exit ${rc.exitCode})` : ''}`);
    if (rc.logTail) {
      const tail = logReviewMode
        ? rc.logTail
        : rc.logTail.length > 800
          ? `...${rc.logTail.slice(-800)}`
          : rc.logTail;
      parts.push(`Run log${logReviewMode ? ' (full)' : ' tail'}:\n${tail}`);
    }
    if (rc.auditOutput) {
      const audit = logReviewMode
        ? rc.auditOutput
        : rc.auditOutput.length > 600
          ? `...${rc.auditOutput.slice(-600)}`
          : rc.auditOutput;
      parts.push(`Audit output${logReviewMode ? ' (full)' : ''}:\n${audit}`);
    }
    const decodedStatus = decodeStatusFromText(`${rc.logTail || ''}\n${rc.auditOutput || ''}`);
    if (decodedStatus.length > 0) {
      parts.push(`Decoded status/error hints:\n${decodedStatus.map((line) => `- ${line}`).join('\n')}`);
    }
  }

  if (flowValidateMode) {
    parts.push(
      'Validation scope: FLOW/STEP STRUCTURE ONLY. Ignore runtime logs, audit output, executor/network/environment failures, and host machine issues.'
    );
    if (flowCommandIssues.length) {
      parts.push(`Precomputed flow command findings:\n${flowCommandIssues.map((x) => `- ${x}`).join('\n')}`);
    }
  }

  if (validateMode && executionSucceeded) {
    parts.push('Execution evidence indicates this flow already worked.');
  }

  if (req.instrumentEndpoint) {
    parts.push(`Live instrument:\n- executor: ${req.instrumentEndpoint.executorUrl}\n- visa: ${req.instrumentEndpoint.visaResource}`);
  }

  if (logReviewMode && !executionSucceeded) {
    parts.push(
      'Response style requirement: provide a detailed diagnostic explanation (around 200-400 words) grounded only in the supplied logs/audit. If no safe flow edit is possible, still return ACTIONS_JSON with actions: [] and keep the narrative detailed.'
    );
  }

  return parts.join('\n\n');
}

function shouldUseOpenAiAssistant(req: McpChatRequest): boolean {
  return req.provider === 'openai';
}

const SERVER_DEFAULT_ASSISTANT_TOKEN = '__SERVER_DEFAULT_ASSISTANT__';
const VALID_PROMPT_ID = /^pmpt_[a-zA-Z0-9_-]+$/;

function usesServerDefaultHostedPrompt(req: McpChatRequest): boolean {
  return String(req.openaiAssistantId || '').trim() === SERVER_DEFAULT_ASSISTANT_TOKEN;
}

function resolveOpenAiPromptId(req: McpChatRequest): string {
  const requested = String(req.openaiAssistantId || '').trim().replace(/\s+/g, '');
  if (VALID_PROMPT_ID.test(requested)) return requested;
  const serverPromptId = String(process.env.OPENAI_PROMPT_ID || '').trim().replace(/\s+/g, '');
  if (VALID_PROMPT_ID.test(serverPromptId)) return serverPromptId;
  const legacyAssistantEnv = String(process.env.OPENAI_ASSISTANT_ID || '').trim().replace(/\s+/g, '');
  if (VALID_PROMPT_ID.test(legacyAssistantEnv)) return legacyAssistantEnv;
  return '';
}

function resolveOpenAiPromptVersion(): string {
  const raw = String(process.env.OPENAI_PROMPT_VERSION || '').trim();
  return raw ? String(raw) : '';
}

function resolveOpenAiResponseCursor(req: McpChatRequest): string {
  const requested = String(req.openaiThreadId || '').trim();
  if (!requested || requested.startsWith('thread_')) return '';
  return requested;
}

function isFlowBuildIntentMessage(message: string): boolean {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) return false;
  const explicitBuild =
    /\b(set up|setup|set|configure|add|measure|capture|decode|trigger|single sequence|group each test|build (?:a )?flow|steps json|actions_json|scpi|enable|disable|output on|output off)\b/.test(
      text
    );
  const leadingImperative =
    /^(set|add|configure|build|create|save|recall|trigger|run|capture|enable|disable|insert|replace|remove)\b/.test(
      text.trim()
    );
  return explicitBuild || leadingImperative;
}

function isReasoningRequest(message: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  const buildIntent = isFlowBuildIntentMessage(text);
  const leadingQuestion = /^(why|how|what|which|when)\b/i.test(text);
  if (buildIntent && !leadingQuestion) return false;
  const directBuildIntent =
    /^(set|add|configure|build|create|save|recall|trigger|run|capture|enable|disable|insert|replace|remove)\b/i.test(
      text
    );
  const reasoningCue =
    /\b(best|recommend|suggest|how should|explain|why|difference|when to use|optimal|ideal|tradeoff|should i|compare|reliable|intermittent|glitch)\b/i.test(
      text
    );
  const interrogativeCue = /\?/.test(text) || /^(why|how|what|when|which)\b/i.test(text);
  return reasoningCue || (interrogativeCue && !directBuildIntent);
}

function resolveIntentRoutedModel(req: McpChatRequest): string {
  if (isReasoningRequest(req.userMessage)) {
    return String(process.env.OPENAI_REASONING_MODEL || 'gpt-5.4').trim();
  }
  return String(process.env.OPENAI_FLOW_MODEL || 'gpt-5.4-nano').trim();
}

function resolveHostedAssistantModel(req: McpChatRequest): string {
  const requested = String(req.model || '').trim();
  // Respect the UI-selected model when explicitly provided.
  if (requested) return requested;
  const envModel = String(process.env.OPENAI_ASSISTANT_MODEL || '').trim();
  if (envModel) return envModel;
  return resolveIntentRoutedModel(req);
}

function resolveOpenAiMaxOutputTokens(): number {
  const raw = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 12000);
  if (!Number.isFinite(raw)) return 12000;
  return Math.max(256, Math.floor(raw));
}

function buildOpenAiCompletionTokenOption(model: string): Record<string, number> {
  const max = resolveOpenAiMaxOutputTokens();
  return /^gpt-5/i.test(model) ? { max_completion_tokens: max } : { max_tokens: max };
}

function resolveHostedResponseTemperature(req: McpChatRequest): number {
  if (isExplainOnlyCommandAsk(req)) return 0.4;
  return req.outputMode === 'steps_json' ? 0.1 : 0.5;
}

function hostedModelSupportsTemperature(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  return !/^gpt-5([.-]|$)/.test(normalized);
}

function hostedModelSupportsReasoningEffort(model: string): boolean {
  const normalized = String(model || '').trim().toLowerCase();
  return /^gpt-5([.-]|$)/.test(normalized);
}

function resolveHostedReasoningEffort(req: McpChatRequest, model: string): 'low' | 'medium' | 'high' | '' {
  if (!hostedModelSupportsReasoningEffort(model)) return '';
  return isReasoningRequest(req.userMessage) ? 'high' : 'medium';
}

function isUnsupportedReasoningEffortError(status: number, errText: string): boolean {
  if (status !== 400) return false;
  const lower = String(errText || '').toLowerCase();
  return (
    lower.includes('reasoning.effort') &&
    (lower.includes('unsupported_parameter') || lower.includes('not supported'))
  );
}

function isHostedStructuredBuildRequest(req: McpChatRequest): boolean {
  return shouldUseOpenAiAssistant(req) && req.outputMode === 'steps_json' && !isExplainOnlyCommandAsk(req);
}

function resolveHostedVectorStoreId(): string {
  return String(process.env.COMMAND_VECTOR_STORE_ID || '').trim();
}

function buildHostedToolDefinitions(toolNames?: string[]): Array<{ name: string; description: string }> {
  const allow = Array.isArray(toolNames) && toolNames.length ? new Set(toolNames) : null;
  return getToolDefinitions()
    .filter((tool) => !allow || allow.has(tool.name))
    .map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

function isTmDevicesHostedRequest(req: McpChatRequest): boolean {
  return (
    (req.flowContext.backend || '').toLowerCase() === 'tm_devices' ||
    /\btm[_\s-]*devices\b|\bscope\.commands\./i.test(String(req.userMessage || ''))
  );
}

function buildHostedAllowedToolChoice(tools: HostedToolDefinition[]): Record<string, unknown> | undefined {
  const allowed = tools
    .filter((tool) => tool.type === 'function' && typeof tool.name === 'string')
    .map((tool) => ({
      type: 'function',
      name: String(tool.name),
    }));
  if (!allowed.length) return undefined;
  return {
    type: 'allowed_tools',
    mode: 'auto',
    tools: allowed,
  };
}

export function buildHostedResponsesTools(
  req?: McpChatRequest,
  phase: HostedToolPhase = 'initial',
  options?: { restrictSearchTools?: boolean; batchMaterializeOnly?: boolean }
): HostedToolDefinition[] {
  const hostedVectorStoreId = resolveHostedVectorStoreId();
  const wantsTmDevices = req ? isTmDevicesHostedRequest(req) : false;
  const toolNames = wantsTmDevices
    ? phase === 'initial'
      ? ['get_current_flow', 'search_tm_devices', 'materialize_tm_devices_call', 'validate_action_payload']
      : ['get_current_flow', 'materialize_tm_devices_call', 'validate_action_payload']
    : options?.batchMaterializeOnly
      ? phase === 'initial'
        ? ['finalize_scpi_commands']
        : []
    : phase === 'initial' && !options?.restrictSearchTools
      ? ['get_current_flow', 'get_command_group', 'search_scpi', 'get_command_by_header', 'get_commands_by_header_batch', 'materialize_scpi_command', 'materialize_scpi_commands', 'finalize_scpi_commands', 'verify_scpi_commands', 'validate_action_payload']
      : ['get_current_flow', 'get_command_by_header', 'get_commands_by_header_batch', 'materialize_scpi_command', 'materialize_scpi_commands', 'finalize_scpi_commands', 'verify_scpi_commands', 'validate_action_payload'];

  const allow = new Set(toolNames);
  const tools: HostedToolDefinition[] = [];
  getToolDefinitions().forEach((tool) => {
    if (!allow.has(tool.name)) return;
    tools.push({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  });
  if (phase === 'initial' && hostedVectorStoreId && !options?.batchMaterializeOnly) {
    tools.unshift({
      type: 'file_search',
      vector_store_ids: [hostedVectorStoreId],
      max_num_results: 6,
    });
  }
  return tools;
}

function buildToolResultSummary(rawResult: unknown): {
  ok?: boolean;
  count?: number;
  warnings?: string[];
} {
  const record = rawResult && typeof rawResult === 'object'
    ? (rawResult as Record<string, unknown>)
    : {};
  const data = record.data;
  return {
    ok: typeof record.ok === 'boolean' ? Boolean(record.ok) : undefined,
    count: Array.isArray(data) ? data.length : (data && typeof data === 'object' ? 1 : 0),
    warnings: Array.isArray(record.warnings)
      ? (record.warnings as unknown[]).slice(0, 3).map((item) => String(item))
      : undefined,
  };
}

function describeScpiPlaceholders(header: string, syntax: Record<string, unknown>, args: Array<Record<string, unknown>>): string[] {
  const source = [header, String(syntax.set || ''), String(syntax.query || '')].join(' ');
  const hints: string[] = [];
  if (/CH<x>/i.test(source)) hints.push('CH<x> => concrete analog channel such as CH1, CH2, CH3, CH4');
  if (/REF<x>/i.test(source)) hints.push('REF<x> => concrete reference waveform such as REF1');
  if (/MATH<x>/i.test(source)) hints.push('MATH<x> => concrete math waveform such as MATH1');
  if (/BUS<x>/i.test(source)) hints.push('BUS<x> => concrete bus slot such as BUS1');
  if (/MEAS<x>/i.test(source)) hints.push('MEAS<x> => concrete measurement slot such as MEAS1, MEAS2, ...');
  if (/SEARCH<x>/i.test(source)) hints.push('SEARCH<x> => concrete search slot such as SEARCH1');
  if (/ZOOM<x>/i.test(source)) hints.push('ZOOM<x> => concrete zoom slot such as ZOOM1');
  if (/PLOT<x>/i.test(source)) hints.push('PLOT<x> => concrete plot slot such as PLOT1');
  if (/SOURCE\b/i.test(source) && !/SOURCE<x>|SOURCE\d/i.test(source)) {
    hints.push('SOURCE is a literal SCPI token here; do not rename it to SOURCE1/SOURCE2 unless the retrieved syntax explicitly does so');
  }
  if (/EDGE\b/i.test(source) && !/EDGE<x>|EDGE\d/i.test(source)) {
    hints.push('EDGE is a literal SCPI token here; do not rename it to EDGE1/EDGE2 unless the retrieved syntax explicitly does so');
  }
  args.forEach((arg) => {
    const validValues = arg.validValues && typeof arg.validValues === 'object'
      ? (arg.validValues as Record<string, unknown>)
      : {};
    if (typeof validValues.pattern === 'string' && validValues.pattern.trim()) {
      hints.push(`${String(arg.name || 'arg')}: pattern ${String(validValues.pattern).trim()}`);
    }
  });
  return Array.from(new Set(hints)).slice(0, 4);
}

function summarizeScpiArguments(argsRaw: unknown): string[] {
  if (!Array.isArray(argsRaw)) return [];
  return (argsRaw as Array<Record<string, unknown>>)
    .slice(0, 4)
    .map((arg) => {
      const name = typeof arg.name === 'string' ? arg.name.trim() : 'arg';
      const type = typeof arg.type === 'string' ? arg.type.trim() : 'value';
      const validValues = arg.validValues && typeof arg.validValues === 'object'
        ? (arg.validValues as Record<string, unknown>)
        : {};
      if (typeof validValues.pattern === 'string' && validValues.pattern.trim()) {
        return `${name}: ${type}, pattern ${validValues.pattern.trim()}`;
      }
      if (Array.isArray(validValues.values) && validValues.values.length) {
        const preview = (validValues.values as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 4)
          .join(', ');
        if (preview) return `${name}: ${type}, values ${preview}`;
      }
      if (Array.isArray(validValues.examples) && validValues.examples.length) {
        const preview = (validValues.examples as unknown[])
          .slice(0, 4)
          .map((value) => String(value))
          .join(', ');
        if (preview) return `${name}: ${type}, examples ${preview}`;
      }
      if (typeof arg.defaultValue !== 'undefined') {
        return `${name}: ${type}, default ${String(arg.defaultValue)}`;
      }
      return `${name}: ${type}`;
    });
}

function formatPreloadedScpiContext(rawResult: unknown): string {
  const rows = rawResult && typeof rawResult === 'object' && Array.isArray((rawResult as Record<string, unknown>).data)
    ? ((rawResult as Record<string, unknown>).data as Array<Record<string, unknown>>)
    : [];
  if (!rows.length) {
    return [
      'Source-of-truth preload:',
      '- No SCPI command matches were preloaded for this request.',
      '- Before proposing any write/query steps, call search_scpi for the missing commands and use only exact verified syntax.',
    ].join('\n');
  }

  const lines = [
    'Source-of-truth preload (verified SCPI candidates from MCP search_scpi):',
  ];
  rows.slice(0, 6).forEach((row, index) => {
    const syntax = row.syntax && typeof row.syntax === 'object'
      ? (row.syntax as Record<string, unknown>)
      : {};
    const example = row.example && typeof row.example === 'object'
      ? (row.example as Record<string, unknown>)
      : {};
    const args = Array.isArray(row.arguments)
      ? (row.arguments as Array<Record<string, unknown>>)
      : [];
    lines.push(`${index + 1}. ${String(row.header || '').trim()}`);
    if (typeof syntax.set === 'string' && syntax.set.trim()) {
      lines.push(`   set: ${String(syntax.set).trim()}`);
    }
    if (typeof syntax.query === 'string' && syntax.query.trim()) {
      lines.push(`   query: ${String(syntax.query).trim()}`);
    }
    if (typeof example.scpi === 'string' && example.scpi.trim()) {
      lines.push(`   example: ${String(example.scpi).trim()}`);
    }
    summarizeScpiArguments(args).forEach((summary) => {
      lines.push(`   arg: ${summary}`);
    });
    describeScpiPlaceholders(String(row.header || ''), syntax, args).forEach((hint) => {
      lines.push(`   placeholder: ${hint}`);
    });
  });
  lines.push('Use only these verified forms or additional MCP tool results for SCPI-bearing steps.');
  return lines.join('\n');
}

function formatPreloadedCommandGroupsContext(rawResults: unknown[]): string {
  const groups = rawResults
    .map((rawResult) => {
      const data =
        rawResult && typeof rawResult === 'object'
          ? ((rawResult as Record<string, unknown>).data as Record<string, unknown> | undefined)
          : undefined;
      return data && typeof data === 'object' ? data : null;
    })
    .filter((value): value is Record<string, unknown> => Boolean(value));
  if (!groups.length) return '';
  const lines = ['Relevant TekAutomate command-browser groups narrowed by MCP:'];
  groups.slice(0, 4).forEach((group, index) => {
    const groupName = String(group.groupName || '').trim();
    const description = String(group.description || '').trim();
    const headers = Array.isArray(group.commandHeaders)
      ? (group.commandHeaders as unknown[]).map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    lines.push(`${index + 1}. ${groupName}`);
    if (description) lines.push(`   ${clipString(description, 180)}`);
    if (headers.length) {
      lines.push(`   sample headers: ${headers.slice(0, 6).join(', ')}`);
    }
  });
  lines.push('Use these group hints to pick likely headers before asking MCP for exact command details.');
  return lines.join('\n');
}

function detectRelevantScpiGroups(userMessage: string): string[] {
  const text = userMessage.toLowerCase();
  const groups: string[] = [];
  const push = (value: string) => {
    if (!groups.includes(value)) groups.push(value);
  };

  if (/\bch[1-8]\b|\bchannel\b|\b50\s*ohm\b|\b1mohm\b|\bac\b|\bdc\b|\bbandwidth\b|\bdeskew\b|\bscale\b|\boffset\b|\blabel\b/i.test(text)) {
    push('Vertical');
  }
  if (/\btrigger\b|\brising\b|\bfalling\b|\bnormal mode\b|\bauto mode\b|\blevel\b|\bholdoff\b/i.test(text)) {
    push('Trigger');
  }
  if (/\bsingle\b|\bsequence\b|\bacquisition\b|\baverage\b|\bnumavg\b|\bfast acquisition\b|\bcontinuous\b/i.test(text)) {
    push('Acquisition');
  }
  if (/\brecord length\b|\bhorizontal\b|\bfastframe\b|\bfast frame\b|\bps per div\b|\bper div\b|\bscale per div\b/i.test(text)) {
    push('Horizontal');
  }
  if (/\bmeasure|\bmeasurement|\bpk2pk\b|\bmean\b|\brms\b|\bfrequency\b|\bamplitude\b|\bovershoot\b|\bundershoot\b|\bdelay\b|\bsetup time\b|\bhold time\b|\bquery all results\b/i.test(text)) {
    push('Measurement');
  }
  if (/\bbus\b|\bdecode\b|\bi2c\b|\bcan\b|\buart\b|\bspi\b|\blin\b/i.test(text)) {
    push('Bus');
  }
  if (/\bsearch\b|\bmark\b|\berror frames?\b|\berrtype\b|\bfind\b/i.test(text)) {
    push('Search and Mark');
  }
  if (/\bsave\b|\bscreenshot\b|\bwaveform\b|\brecall\b|\bsession\b|\bsetup\b|\bimage\b/i.test(text)) {
    push('Save and Recall');
  }

  suggestCommandGroups(userMessage, 8).forEach(push);
  return groups.slice(0, 10);
}

function isCommonPreverifiedScpiRequest(userMessage: string, groups: string[]): boolean {
  if (!groups.length) return false;
  const text = userMessage.toLowerCase();
  if (/\bcan\b|\bi2c\b|\buart\b|\bspi\b|\bsearch\b|\bmark\b|\bdelay\b|\bsetup time\b|\bhold time\b|\beye\b|\bjitter\b|\bmask\b|\bglitch\b|\bpulse\s*width\b|\bpulsewidth\b|\brunt\b|\btimeout\b|\btransition\b|\bwindow\b|\blogic\b/i.test(text)) {
    return false;
  }
  return groups.every((group) => ['Vertical', 'Trigger', 'Acquisition', 'Horizontal', 'Measurement', 'Save and Recall'].includes(group));
}

function buildScpiBm25Queries(
  userMessage: string,
  relevantGroups: string[]
): Array<{ query: string; commandType?: 'set' | 'query' | 'both' }> {
  const queries: Array<{ query: string; commandType?: 'set' | 'query' | 'both' }> = [];
  const seen = new Set<string>();
  const push = (query: string, commandType: 'set' | 'query' | 'both' = 'both') => {
    const value = String(query || '').trim();
    if (!value) return;
    const key = `${commandType}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({ query: value, commandType });
  };

  push(userMessage, 'both');
  if (relevantGroups.includes('Vertical')) push('channel scale coupling termination label bandwidth deskew', 'set');
  if (relevantGroups.includes('Trigger')) {
    push('trigger edge source slope level mode holdoff', 'set');
    push('trigger pulsewidth source when lowlimit highlimit polarity width glitch runt timeout transition window logic', 'set');
  }
  if (relevantGroups.includes('Acquisition')) push('acquire stopafter state mode numavg sequence', 'set');
  if (relevantGroups.includes('Horizontal')) push('horizontal recordlength fastframe scale position', 'set');
  if (relevantGroups.includes('Measurement')) push('measurement add source results currentacq mean', 'both');
  if (relevantGroups.includes('Bus')) push('bus decode source threshold standard bitrate can i2c uart', 'set');
  if (relevantGroups.includes('Search and Mark')) push('search and mark bus error frame errtype', 'set');
  if (relevantGroups.includes('Save and Recall')) push('save recall waveform image screenshot session setup', 'both');

  relevantGroups
    .filter((group) => !['Vertical', 'Trigger', 'Acquisition', 'Horizontal', 'Measurement', 'Bus', 'Search and Mark', 'Save and Recall'].includes(group))
    .forEach((group) => {
    const seed = buildCommandGroupSeedQuery(group);
    if (!seed) return;
    const commandType =
      group === 'Measurement' || group === 'Save and Recall' || group === 'Waveform Transfer' || group === 'Status and Error'
        ? 'both'
        : 'set';
    push(seed, commandType);
    });
  return queries.slice(0, 6);
}

function buildScpiPreloadQueries(userMessage: string): Array<{
  query?: string;
  header?: string;
  commandType?: 'set' | 'query' | 'both';
}> {
  const queries: Array<{ query?: string; header?: string; commandType?: 'set' | 'query' | 'both' }> = [];
  const seen = new Set<string>();
  const push = (entry: { query?: string; header?: string; commandType?: 'set' | 'query' | 'both' }) => {
    if (!entry.query && !entry.header) return;
    const key = JSON.stringify(entry);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(entry);
  };

  if (/\bch[1-8]\b|\bchannel\b|\b50\s*ohm\b|\b1mohm\b|\bac\b|\bdc\b|\bvdd_|pgood/i.test(userMessage)) {
    push({ header: 'CH<x>:SCAle' });
    push({ header: 'CH<x>:COUPling' });
    push({ header: 'CH<x>:TERmination' });
    push({ header: 'CH<x>:LABel:NAMe' });
  }
  if (/\btrigger\b|\brising\b|\bfalling\b|\bnormal mode\b|\bauto mode\b|\blevel\b/i.test(userMessage)) {
    push({ header: 'TRIGger:{A|B}:EDGE:SOUrce' });
    push({ header: 'TRIGger:{A|B}:EDGE:SLOpe' });
    push({ header: 'TRIGger:A:MODe' });
    push({ header: 'TRIGger:{A|B}:TYPe' });
    if (/\bglitch\b|\bpulse\s*width\b|\bpulsewidth\b|\bintermittent\b|\b50\s*ns\b|\bns\b/i.test(userMessage)) {
      push({ header: 'TRIGger:{A|B}:PULSEWidth:SOUrce' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:WHEn' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:LOWLimit' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:HIGHLimit' });
      push({ header: 'TRIGger:{A|B}:PULSEWidth:POLarity' });
    }
    if (/\blevel\b/i.test(userMessage)) {
      push({ query: 'trigger edge level', commandType: 'set' });
    }
  }
  if (/\bsingle\b|\bsequence\b|\brecord length\b|\bacquisition\b/i.test(userMessage)) {
    push({ header: 'ACQuire:STOPAfter' });
    push({ header: 'HORizontal:RECOrdlength' });
  }
  if (/\bmeasure|\bmeasurement|\bpk2pk\b|\bmean\b|\bdelay\b|\bquery all results\b/i.test(userMessage)) {
    push({ header: 'MEASUrement:ADDMEAS' });
    push({ header: 'MEASUrement:MEAS<x>:SOUrce1' });
    push({ header: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN' });
    if (/\bdelay\b/i.test(userMessage)) {
      push({ query: 'measurement delay source threshold crossing', commandType: 'set' });
    }
  }
  if (/\bwaveform\b|\bscreenshot\b|\bsave\b/i.test(userMessage)) {
    push({ header: 'SAVe:WAVEform' });
    push({ header: 'SAVe:IMAGe' });
  }
  if (!queries.length) {
    push({ query: userMessage, commandType: 'both' });
  }
  return queries.slice(0, 8);
}

function buildTmDevicesPreloadQueries(userMessage: string): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (query: string) => {
    const value = String(query || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    queries.push(value);
  };

  if (/\btermination\b|\b50\s*ohm\b|\b1mohm\b/i.test(userMessage)) {
    push('ch[x].termination.write');
    push('channel termination write');
  }
  if (/\btrigger\b.*\bsource\b|\bsource\b.*\btrigger\b/i.test(userMessage)) {
    push('trigger.a.edge.source.write');
    push('trigger edge source write');
  }
  if (/\btrigger\b.*\brising\b|\btrigger\b.*\bfalling\b|\bslope\b/i.test(userMessage)) {
    push('trigger.a.edge.slope.write');
    push('trigger edge slope write');
  }
  if (/\bstate\b|\brun\b|\bstop\b|\bsingle\b|\bsequence\b|\bacquisition\b/i.test(userMessage)) {
    push('acquire.stopafter.write');
    push('acquire.state.write');
  }
  if (!queries.length) {
    push(userMessage);
  }
  return queries.slice(0, 8);
}

function formatPreloadedTmDevicesContext(rawResult: unknown): string {
  const rows = rawResult && typeof rawResult === 'object' && Array.isArray((rawResult as Record<string, unknown>).data)
    ? ((rawResult as Record<string, unknown>).data as Array<Record<string, unknown>>)
    : [];
  if (!rows.length) {
    return [
      'Source-of-truth preload:',
      '- No tm_devices paths were preloaded for this request.',
      '- Before proposing tm_device_command steps, call search_tm_devices for the missing method path and use only verified methods.',
    ].join('\n');
  }

  const lines = [
    'Source-of-truth preload (verified tm_devices candidates from MCP search_tm_devices):',
  ];
  rows.slice(0, 6).forEach((row, index) => {
    lines.push(`${index + 1}. ${String(row.methodPath || '').trim()}`);
    if (typeof row.signature === 'string' && row.signature.trim()) {
      lines.push(`   signature: ${String(row.signature).trim()}`);
    }
    if (typeof row.usageExample === 'string' && row.usageExample.trim()) {
      lines.push(`   example: ${String(row.usageExample).trim()}`);
    }
  });
  lines.push('Use only these verified tm_devices methods or additional MCP tool results for tm_device_command steps.');
  return lines.join('\n');
}

function extractHostedFunctionCalls(json: Record<string, unknown>): HostedFunctionCall[] {
  if (!Array.isArray(json.output)) return [];
  return (json.output as Array<Record<string, unknown>>)
    .filter((item) => item.type === 'function_call' && typeof item.name === 'string' && typeof item.call_id === 'string')
    .map((item) => ({
      name: String(item.name),
      callId: String(item.call_id),
      argumentsText:
        typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.arguments || {}),
    }));
}

async function executeHostedToolCall(
  req: McpChatRequest,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === 'get_current_flow') {
    return {
      ok: true,
      data: {
        flowContext: req.flowContext,
        runContext: req.runContext,
        selectedStepId: req.flowContext.selectedStepId,
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  if (name === 'validate_flow') {
    const issues = await detectFlowCommandIssues(req);
    return {
      ok: true,
      data: {
        valid: issues.length === 0,
        issues,
      },
      sourceMeta: [],
      warnings: [],
    };
  }

  if (name === 'apply_actions') {
    return {
      ok: true,
      data: {
        applied: false,
        message: 'Do not call apply_actions inside assistant chat. Return ACTIONS_JSON and let TekAutomate apply it client-side.',
      },
      sourceMeta: [],
      warnings: ['apply_actions is not executed server-side in assistant chat'],
    };
  }

  return runTool(name, args);
}

async function preloadSourceOfTruthContext(
  req: McpChatRequest,
  toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace']
): Promise<HostedPreloadContext> {
  if (!isHostedStructuredBuildRequest(req)) {
    return {
      contextText: '',
      restrictSearchTools: false,
      batchMaterializeOnly: false,
      candidateCount: 0,
      groupCount: 0,
      usedBm25: false,
    };
  }

  const wantsTmDevices =
    (req.flowContext.backend || '').toLowerCase() === 'tm_devices' ||
    /\btm[_\s-]*devices\b|\bscope\.commands\./i.test(req.userMessage);
  if (wantsTmDevices) {
    const mergedRows: Array<Record<string, unknown>> = [];
    const mergedKeys = new Set<string>();
    for (const query of buildTmDevicesPreloadQueries(req.userMessage)) {
      const args = {
        query,
        model: req.flowContext.deviceDriver || req.flowContext.modelFamily,
        limit: 6,
      };
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      const rawResult = await executeHostedToolCall(req, 'search_tm_devices', args);
      toolTrace.push({
        name: 'search_tm_devices',
        args,
        startedAt,
        durationMs: Date.now() - t0,
        resultSummary: buildToolResultSummary(rawResult),
        rawResult,
      });
      const data =
        rawResult && typeof rawResult === 'object'
          ? (rawResult as Record<string, unknown>).data
          : undefined;
      const rows = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : (data && typeof data === 'object' ? [data as Record<string, unknown>] : []);
      rows.forEach((row) => {
        const key = `${String(row.modelRoot || '')}:${String(row.methodPath || '')}`;
        if (!key.trim() || mergedKeys.has(key)) return;
        mergedKeys.add(key);
        mergedRows.push(row);
      });
    }
    return {
      contextText: formatPreloadedTmDevicesContext({ data: mergedRows }),
      restrictSearchTools: false,
      batchMaterializeOnly: false,
      candidateCount: mergedRows.length,
      groupCount: 0,
      usedBm25: true,
    };
  }

  const relevantGroups = detectRelevantScpiGroups(req.userMessage);
  const groupRawResults: unknown[] = [];
  for (const groupName of relevantGroups) {
    const args = { groupName };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const rawResult = await executeHostedToolCall(req, 'get_command_group', args);
    toolTrace.push({
      name: 'get_command_group',
      args,
      startedAt,
      durationMs: Date.now() - t0,
      resultSummary: buildToolResultSummary(rawResult),
      rawResult,
    });
    groupRawResults.push(rawResult);
  }

  const mergedRows: Array<Record<string, unknown>> = [];
  const mergedKeys = new Set<string>();
  const candidateHeaders: string[] = [];
  const seenHeaders = new Set<string>();
  const rememberHeader = (value: string) => {
    const header = String(value || '').trim();
    if (!header || seenHeaders.has(header)) return;
    seenHeaders.add(header);
    candidateHeaders.push(header);
  };

  for (const preload of buildScpiBm25Queries(req.userMessage, relevantGroups)) {
    const toolName = 'search_scpi';
    const args = {
      query: preload.query,
      modelFamily: req.flowContext.modelFamily,
      limit: 10,
      commandType: preload.commandType || 'both',
    };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const rawResult = await executeHostedToolCall(req, toolName, args);
    toolTrace.push({
      name: toolName,
      args,
      startedAt,
      durationMs: Date.now() - t0,
      resultSummary: buildToolResultSummary(rawResult),
      rawResult,
    });
    const data =
      rawResult && typeof rawResult === 'object'
        ? (rawResult as Record<string, unknown>).data
        : undefined;
    const rows = Array.isArray(data)
      ? (data as Array<Record<string, unknown>>)
      : (data && typeof data === 'object' ? [data as Record<string, unknown>] : []);
    rows.forEach((row) => {
      const key = `${String(row.sourceFile || '')}:${String(row.commandId || row.header || '')}`;
      if (!key.trim() || mergedKeys.has(key)) return;
      mergedKeys.add(key);
      mergedRows.push(row);
      rememberHeader(String(row.header || row.matchedHeader || ''));
    });
  }

  if (candidateHeaders.length < 4) {
    buildScpiPreloadQueries(req.userMessage)
      .filter((preload) => Boolean(preload.header))
      .forEach((preload) => rememberHeader(String(preload.header || '')));
  }

  const hydratedRows: Array<Record<string, unknown>> = [];
  if (candidateHeaders.length) {
    const batchArgs = {
      headers: candidateHeaders.slice(0, 8),
      family: req.flowContext.modelFamily,
    };
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const rawResult = await executeHostedToolCall(req, 'get_commands_by_header_batch', batchArgs);
    toolTrace.push({
      name: 'get_commands_by_header_batch',
      args: batchArgs,
      startedAt,
      durationMs: Date.now() - t0,
      resultSummary: buildToolResultSummary(rawResult),
      rawResult,
    });
    const batchData =
      rawResult && typeof rawResult === 'object'
        ? ((rawResult as Record<string, unknown>).data as Record<string, unknown> | undefined)
        : undefined;
    const batchResults = Array.isArray(batchData?.results)
      ? (batchData?.results as Array<Record<string, unknown>>)
      : [];
    batchResults.forEach((row) => {
      if (row.deduped === true) return;
      const key = `${String(row.sourceFile || '')}:${String(row.commandId || row.header || row.matchedHeader || '')}`;
      if (!key.trim() || mergedKeys.has(`hydrated:${key}`)) return;
      mergedKeys.add(`hydrated:${key}`);
      hydratedRows.push(row);
    });
  }

  const groupContext = formatPreloadedCommandGroupsContext(groupRawResults);
  const scpiContext = formatPreloadedScpiContext({ data: hydratedRows.length ? hydratedRows : mergedRows });
  const commonRequest = isCommonPreverifiedScpiRequest(req.userMessage, relevantGroups);
  const candidateCount = hydratedRows.length || mergedRows.length;
  const batchMaterializeOnly = commonRequest && candidateCount >= 1;
  return {
    contextText: [groupContext, scpiContext, batchMaterializeOnly
      ? [
          'MCP already completed BM25 top-match retrieval and command-group narrowing for this common request.',
          'Common SCPI fast path is active for this turn.',
          'Do not call search_scpi, get_command_group, get_command_by_header, get_commands_by_header_batch, or file_search unless the preloaded candidates are clearly insufficient.',
          'Choose the needed verified headers from the preloaded candidates, call finalize_scpi_commands once with every concrete command you need, then answer immediately.',
        ].join(' ')
      : '',
    ].filter(Boolean).join('\n\n'),
    restrictSearchTools: batchMaterializeOnly,
    batchMaterializeOnly,
    candidateCount,
    groupCount: relevantGroups.length,
    usedBm25: true,
  };
}

export function buildAssistantUserPrompt(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  options?: { hostedPromptConfigured?: boolean }
): string {
  const isExplainOnly = isExplainOnlyCommandAsk(req);
  const fc = req.flowContext;
  const flatSteps = flattenSteps(Array.isArray(fc.steps) ? fc.steps : []);
  const topStepTypes = flatSteps.slice(0, 12).map((s) => String(s.type || 'unknown'));
  const userText = String(req.userMessage || '');
  const hostedPromptConfigured = options?.hostedPromptConfigured === true;
  const isOfflineTekScope =
    /\boffline\b/i.test(userText) &&
    /\btekscope\s*pc\b|\btekscopepc\b/i.test(userText);
  const wantsTmDevices =
    (fc.backend || '').toLowerCase() === 'tm_devices' ||
    /\btm[_\s-]*devices\b|\bscope\.commands\./i.test(userText);
  const lines = [
    `TekAutomate request mode: ${req.outputMode}.`,
    `Backend: ${fc.backend || 'pyvisa'}, DeviceType: ${fc.deviceType || 'SCOPE'}, ModelFamily: ${fc.modelFamily || 'unknown'}.`,
    `Flow size: ${flatSteps.length} steps. Types: ${topStepTypes.join(', ') || '(empty)'}.`,
  ];
  const flowValidateMode = isFlowValidationRequest(req);
  const schemaLines = [
    'TekAutomate schema rules:',
    '- Your true job is to build or edit directly applyable TekAutomate Steps UI flows or valid Blockly XML, not generic workflow descriptions.',
    '- Use only real TekAutomate step types: connect, disconnect, write, query, set_and_query, sleep, comment, python, save_waveform, save_screenshot, error_check, group, tm_device_command, recall.',
    '- Never invent pseudo-step types such as set_channel, set_acquisition_mode, repeat, acquire_waveform, measure_parameter, log_to_csv, or similar abstractions.',
    '- Copy TekAutomate param keys exactly from these schemas:',
    '  connect -> params { instrumentIds: [], printIdn: true }',
    '  disconnect -> params { instrumentIds: [] }',
    '  write -> params { command: "..." }',
    '  query -> params { command: "...", saveAs: "..." }',
    '  sleep -> params { duration: 0.5 }',
    '  save_screenshot -> params { filename: "capture.png", scopeType: "modern|legacy", method: "pc_transfer" }',
    '  save_waveform -> params { source: "CH1", filename: "ch1.bin", format: "bin|csv|wfm|mat" }',
    '  group -> include params:{} and children:[]',
    '- Use label for step display text. Do not use name or title as a step field.',
    '- For query steps, use params.command, never params.query, and always include params.saveAs.',
    '- Query steps should be query-only. Do not prepend setup writes or semicolon-chained non-query commands before the final ? command.',
    '- For status/error checks, prefer *ESR? as the default command. Use ALLEV? only when the user explicitly asks for event-queue detail.',
    '- Do not add *OPC? by default. Use *OPC? only after OPC-capable operations and when completion sync is explicitly requested.',
    '- Canonical headers returned by search_scpi/get_command_by_header are authoritative templates. If the retrieved header uses placeholders like CH<x>, MEAS<x>, REF<x>, BUS<x>, SEARCH<x>, or PLOT<x>, instantiate only those placeholders (for example CH1, MEAS1) and keep the rest of the header unchanged.',
    '- After retrieving a canonical SCPI record for any write/query step, prefer finalize_scpi_commands for the whole set of commands you need in this turn. If you only need one command, materialize_scpi_command is acceptable. Pass the verified header plus placeholder bindings and argument values. If the user already specified a concrete instance like CH1, MEAS1, B1, or SEARCH1, pass that as concreteHeader so MCP can infer bindings deterministically. Copy the returned command verbatim into params.command instead of typing the final SCPI yourself.',
    '- Do not mutate literal tokens such as SOURCE, EDGE, RESULTS, MODE, or LEVEL into indexed variants unless the retrieved syntax itself contains that indexed form.',
    '- For any SCPI-bearing build/edit request, use source-of-truth retrieval first. Call search_scpi and/or file_search before proposing write/query steps unless MCP already preloaded verified command candidates for this turn.',
    '- Never ask the user to paste SCPI command strings when MCP lookup/materialization tools can retrieve the verified syntax.',
    '- For tm_devices build/edit requests, use source-of-truth retrieval first. Call search_tm_devices before proposing tm_device_command steps unless MCP already preloaded verified method candidates for this turn.',
    '- After retrieving a verified tm_devices methodPath, call materialize_tm_devices_call and copy the returned code verbatim into tm_device_command params.code instead of composing Python from memory.',
    '- Prefer retrieved source-backed syntax before composing applyable write/query/tm_device_command steps.',
    '- Do not treat prompt files, golden examples, templates, or general knowledge-base prose as proof of exact SCPI syntax. For exact SCPI verification, rely on MCP command-library tool results and their command JSON records.',
    '- When MCP returns command records, use their detailed description, argument descriptions, validValues, relatedCommands, manualReference, and example text to choose the right verified command instead of relying on a stripped header match alone.',
    '- Use exact long-form SCPI syntax when known. Avoid guessing ambiguous short mnemonics like SCA, COUP, or IMP.',
    '- Combine related same-subsystem setup commands into one write step using semicolons when it keeps the flow compact.',
    '- Keep compact combined setup writes to 3 commands or fewer per step.',
    '- For sleep steps, use duration, never seconds.',
    '- For screenshot steps, use filename, never file_path, and default to scopeType:"modern" plus method:"pc_transfer" when not otherwise specified.',
    '- For waveform steps, prefer save_waveform over raw save SCPI and include source, filename, and format.',
    '- Modern MSO screenshot capture should use save_screenshot, not HARDCopy.',
    '- If the current workspace is empty and you build a full flow, include connect first and disconnect last.',
    '- If the request cannot be represented with those real step types or valid Blockly blocks, explain the limitation briefly instead of emitting fake applyable JSON.',
    '- For Blockly/XML requests, return XML only and use supported blocks only: connect_scope, disconnect, set_device_context, scpi_write, scpi_query, recall, save, save_screenshot, save_waveform, wait_seconds, wait_for_opc, tm_devices_write, tm_devices_query, tm_devices_save_screenshot, tm_devices_recall_session, controls_for, controls_if, variables_set, variables_get, math_number, math_arithmetic, python_code.',
  ];
  if (hostedPromptConfigured) {
    lines.push(
      'Hosted Responses prompt is configured.',
      'Treat the stored prompt as the authority for TekAutomate schema, apply rules, Blockly rules, and tool-usage policy.',
      'Use this runtime message only for dynamic workspace context, current request details, and any preloaded verification findings for this turn.',
      resolveHostedVectorStoreId()
        ? 'Hosted file_search is available for this turn. Use file_search first for source discovery when the preloaded MCP results are incomplete or too narrow.'
        : 'Hosted file_search is not configured for this turn, so rely on MCP retrieval for source discovery.',
      'Treat file_search results as source discovery only. Prefer MCP lookup/materialization for final applyable SCPI or tm_devices output.',
      'When MCP returns command records, use their detailed description, argument descriptions, validValues, relatedCommands, manualReference, and example text to disambiguate the right verified command before building steps.',
      'Emit structured flow JSON for all verified portions even when some requested commands remain unverified.',
      'If SCPI syntax is available in the planner context (PLANNER RESOLVED section), use it immediately.',
      'If preloaded MCP verification is insufficient, proactively continue with tool calls (search_scpi, get_command_by_header, get_commands_by_header_batch, file_search as needed) before failing.',
      'Build what you can verify; only fail closed for specific commands not in planner context AND not findable via tool call.',
      'When verification is partial, include applyable actions for verified commands and add comment-step placeholders for manual completion of unverified parts.',
      'Never ask the user for SCPI strings when search_scpi/get_command_by_header can resolve them.',
      'When multiple related SCPI headers or concrete commands are needed, prefer get_commands_by_header_batch and finalize_scpi_commands to reduce tool chatter.',
      'If the stored prompt allows structured output, prefer a single parseable ```json``` block unless multiple smaller blocks are genuinely clearer.'
    );
  } else {
    lines.push(
      '',
      'Chat response contract:',
      '- For flow/create/edit requests, prefer one or more parseable ```json``` blocks rather than raw JSON text.',
      '- A JSON block may contain either full Steps UI flow JSON with "steps", or ACTIONS_JSON with "actions".',
      '- Short chat prose before or after the JSON is okay when it helps the user.',
      '- For explain-only requests, reply in concise plain text instead of JSON.',
      '- No citations, footnotes, or reference markers like [1] or [2].',
      '- Keep any non-JSON narrative short when structured output is included.',
      ...schemaLines,
      '- Never invent commands. If uncertain, prefer safe common commands and clearly state assumptions.',
      '- If you return actions, `newStep` and `flow` must be real JSON objects, not JSON-encoded strings.',
      '- Never use `param: "params"`; set one concrete field per `set_step_param`, or use `replace_step`.'
    );
  }
  if (wantsTmDevices) {
    lines.push(
      'tm_devices mode policy:',
      '- Prefer tm_devices paths/functions from source of truth.',
      '- The tm_devices API path from tm_devices_full_tree.json is authoritative for generation. Treat raw SCPI only as explanatory context when it is also available.',
      '- Avoid SCPI write/query steps unless user explicitly asks for SCPI.',
      '- If returning flow JSON, prefer "tm_device_command" steps for command execution.'
    );
  }
  if (isOfflineTekScope) {
    lines.push(
      'Offline TekScopePC policy (strict):',
      '- Do NOT include acquisition/trigger/channel hardware setup commands.',
      '- Prefer recall/session or waveform-load + measurement + query + save results.',
      '- If needed, include a finding that offline TekScopePC cannot execute live hardware acquisition.'
    );
  }
  // History is sent as native messages in hosted Responses mode;
  // avoid duplicating it in this prompt body.
  if (req.flowContext.selectedStep) {
    lines.push('Selected step:', JSON.stringify(req.flowContext.selectedStep));
  }
  if (flowValidateMode) {
    const flowCommandSnapshot = flatSteps.length
      ? flatSteps
          .slice(0, 80)
          .map((step) => {
            const id = String(step.id || '?');
            const type = String(step.type || 'unknown');
            const label = String(step.label || '').trim();
            const params = (step.params && typeof step.params === 'object')
              ? (step.params as Record<string, unknown>)
              : {};
            const command = typeof params.command === 'string' ? params.command : '';
            const commands = Array.isArray(params.commands)
              ? (params.commands as unknown[]).map((v) => String(v)).filter(Boolean)
              : [];
            const saveAs = typeof params.saveAs === 'string' ? params.saveAs : '';
            const descriptor = command
              ? ` command=${command}`
              : commands.length
                ? ` commands=${commands.join(' ; ')}`
                : '';
            const querySave = saveAs ? ` saveAs=${saveAs}` : '';
            return `- [${id}] ${type}${label ? ` "${label}"` : ''}${descriptor}${querySave}`;
          })
          .join('\n')
      : '- (empty flow)';
    lines.push('Flow command snapshot (for strict verification):', flowCommandSnapshot);
  }
  if (flowCommandIssues.length) {
    lines.push(`Precomputed flow command findings:\n${flowCommandIssues.map((x) => `- ${x}`).join('\n')}`);
  }
  const attachmentContext = buildAttachmentContext(req);
  if (attachmentContext) {
    lines.push(attachmentContext);
  }
  if (isExplainOnly) {
    lines.push(
      hostedPromptConfigured
        ? 'Intent: explain the selected command or step only.'
        : 'Intent: explain only. Do not include flow-edit JSON unless the user asks for changes.'
    );
  } else {
    lines.push(
      hostedPromptConfigured
        ? 'Intent: build or modify the flow for the current request.'
        : 'Intent: chat naturally, and when proposing flow changes include parseable JSON payloads when helpful. One block is preferred, but multiple smaller JSON blocks are okay.'
    );
  }
  lines.push('User request:', req.userMessage);
  return lines.join('\n\n');
}

/** Extract assistant text from Responses API output (output_text or output[].message.content[].text). */
function extractOpenAiResponseText(json: Record<string, unknown>): string {
  if (typeof json.output_text === 'string' && json.output_text.trim().length > 0) {
    return json.output_text;
  }
  if (!Array.isArray(json.output)) return '';
  return (json.output as Array<Record<string, unknown>>)
    .map((item) => {
      if (item.type === 'message' && Array.isArray(item.content)) {
        return (item.content as Array<Record<string, unknown>>)
          .map((c) => (typeof c?.text === 'string' ? c.text : ''))
          .join('');
      }
      if (typeof item.text === 'string') return item.text;
      return '';
    })
    .join('');
}

/** Extract text from Chat Completions API response (one-shot direct LLM). */
function extractChatCompletionText(json: Record<string, unknown>): string {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const msg = choices[0]?.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg.content !== 'string') return '';
  return msg.content;
}

export function buildHostedOpenAiResponsesRequest(
  req: McpChatRequest,
  assistantPrompt: string,
  options: HostedResponsesRequestOptions = {}
): Record<string, unknown> {
  const hostedModel = resolveHostedAssistantModel(req);
  const promptId = resolveOpenAiPromptId(req);
  const canAttachHostedPrompt = hostedModelSupportsReasoningEffort(hostedModel);
  const effectivePromptId = canAttachHostedPrompt ? promptId : '';
  const promptVersion = resolveOpenAiPromptVersion();
  const previousResponseId = options.previousResponseId ?? resolveOpenAiResponseCursor(req);
  const historyInput =
    previousResponseId || !Array.isArray(req.history)
      ? []
      : req.history
          .slice(-6)
          .map((h) => ({
            role: h.role,
            content: String(h.content || '').slice(0, 2000),
          }))
          .filter((h) => h.content.trim().length > 0);
  const developerMessage = String(options.developerMessage || '').trim();
  const initialInput = options.inputOverride || [
    ...(developerMessage
      ? [{ role: 'developer', content: developerMessage }]
      : []),
    ...historyInput.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: assistantPrompt },
  ];
  const requestPayload: Record<string, unknown> = {
    model: hostedModel,
    input: initialInput,
    store: true,
    stream: false,
  };
  if (hostedModelSupportsTemperature(hostedModel)) {
    requestPayload.temperature = resolveHostedResponseTemperature(req);
  }
  const reasoningEffort = resolveHostedReasoningEffort(req, hostedModel);
  if (reasoningEffort) {
    requestPayload.reasoning = { effort: reasoningEffort };
  }
  if (Array.isArray(options.tools) && options.tools.length > 0) {
    requestPayload.tools = options.tools;
  }
  if (options.toolChoice) {
    requestPayload.tool_choice = options.toolChoice;
  }
  if (effectivePromptId) {
    requestPayload.prompt = promptVersion
      ? { id: effectivePromptId, version: promptVersion }
      : { id: effectivePromptId };
  }
  if (previousResponseId) {
    requestPayload.previous_response_id = previousResponseId;
  }
  return requestPayload;
}

async function runOpenAiHostedResponse(
  req: McpChatRequest,
  assistantPrompt: string,
  options: HostedResponsesRequestOptions = {}
): Promise<{
  text: string;
  raw: Record<string, unknown>;
  requestPayload: Record<string, unknown>;
  responseId: string;
}> {
  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const requestPayload = buildHostedOpenAiResponsesRequest(req, assistantPrompt, options);
  const hostedModel = resolveHostedAssistantModel(req);
  const canAttachHostedPrompt = hostedModelSupportsReasoningEffort(hostedModel);
  const promptConfig = requestPayload.prompt as Record<string, unknown> | undefined;
  const reasoningCfg = requestPayload.reasoning as Record<string, unknown> | undefined;
  console.log(
    `[MCP] OpenAI hosted responses: model ${hostedModel}${reasoningCfg?.effort ? ` reasoning=${String(reasoningCfg.effort)}` : ''}`
  );
  if (usesServerDefaultHostedPrompt(req) && canAttachHostedPrompt && !promptConfig?.id) {
    throw new Error('OPENAI_PROMPT_ID is required for hosted server-default assistant mode. Set a real pmpt_... value in mcp-server/.env or send a prompt ID directly.');
  }
  if (usesServerDefaultHostedPrompt(req) && !canAttachHostedPrompt) {
    console.log(
      `[MCP] OpenAI hosted responses: skipping prompt attachment for model ${hostedModel} (reasoning-effort incompatible); using inline context`
    );
  }
  if (promptConfig?.id) {
    console.log(
      `[MCP] OpenAI hosted responses: using prompt ${String(promptConfig.id)}${promptConfig.version ? ` v${String(promptConfig.version)}` : ''}`
    );
  } else if (String(req.openaiAssistantId || '').trim().length > 0) {
    console.log('[MCP] OpenAI hosted responses: no prompt ID configured; using inline request prompt only');
  }
  let res = await fetch(`${openAiBase}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  });
  if (!res.ok) {
    let errText = await res.text();
    if (isUnsupportedReasoningEffortError(res.status, errText) && requestPayload.prompt) {
      console.log(
        `[MCP] OpenAI hosted responses: retrying without prompt for model ${hostedModel} after reasoning.effort incompatibility`
      );
      const fallbackPayload: Record<string, unknown> = { ...requestPayload };
      delete fallbackPayload.prompt;
      res = await fetch(`${openAiBase}/v1/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fallbackPayload),
      });
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        const responseId = String(json.id || '').trim();
        if (!responseId) {
          throw new Error('OpenAI Responses response missing id.');
        }
        return {
          text: extractOpenAiResponseText(json),
          raw: json,
          requestPayload: fallbackPayload,
          responseId,
        };
      }
      errText = await res.text();
    }
    throw new Error(`OpenAI Responses error ${res.status}: ${errText}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const responseId = String(json.id || '').trim();
  if (!responseId) {
    throw new Error('OpenAI Responses response missing id.');
  }
  return {
    text: extractOpenAiResponseText(json),
    raw: json,
    requestPayload,
    responseId,
  };
}

async function runOpenAiResponses(
  req: McpChatRequest,
  flowCommandIssues: string[] = []
): Promise<{
  text: string;
  assistantThreadId?: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const instructions = getModePrompt(req);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
  const useHostedAssistant = shouldUseOpenAiAssistant(req);
  const assistantPrompt = buildAssistantUserPrompt(req, flowCommandIssues, {
    hostedPromptConfigured: useHostedAssistant && Boolean(resolveOpenAiPromptId(req)),
  });
  const compactDeveloperContext = shouldUseCompactDeveloperContext(req);
  const developerPrompt = isExplainOnlyCommandAsk(req)
    ? 'Command explanation mode. Return plain text guidance only.'
    : await buildContext(req, { compact: compactDeveloperContext });
  console.log('[DEBUG] developer message:', String(developerPrompt || '').slice(0, 2000));
  if (useHostedAssistant) {
    console.log(
      '[HOSTED] developer message length:',
      developerPrompt.length,
      'compact:',
      compactDeveloperContext,
      'hasPlannerSection:',
      developerPrompt.includes('PLANNER RESOLVED')
    );
  }
  const toolDefinitions: Array<{ name: string; description: string }> = [];
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];

  const modelStartedAt = Date.now();
  let json: Record<string, unknown>;
  let content = '';
  let providerRequest: Record<string, unknown>;
  let assistantThreadId: string | undefined;
  try {
    if (useHostedAssistant) {
      console.log('[MCP] OpenAI route: assistant (Responses)');
      const hosted = await runOpenAiHostedResponse(req, assistantPrompt, {
        developerMessage: developerPrompt,
      });
      providerRequest = hosted.requestPayload;
      json = hosted.raw;
      content = hosted.text;
      assistantThreadId = hosted.responseId;
    } else {
      console.log('[MCP] OpenAI route: direct (Chat Completions one-shot)');
      const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
      const model = resolveOpenAiModel(req);
      providerRequest = {
        model,
        messages: [
          { role: 'system', content: `${instructions}\n\n${developerPrompt}` },
          { role: 'user', content: req.userMessage },
        ],
        ...buildOpenAiCompletionTokenOption(model),
      };
      const res = await fetch(`${openAiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${req.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerRequest),
      });
      if (!res.ok) {
        throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
      }
      json = (await res.json()) as Record<string, unknown>;
      content = extractChatCompletionText(json);
    }
  } catch (err) {
    console.log('[MCP] responses.create error:', JSON.stringify(err));
    throw err;
  }
  console.log('[MCP] raw output:', JSON.stringify(json.output || json));
  console.log('[DEBUG] raw response:', String(content || '').slice(0, 1000));
  const modelMs = Date.now() - modelStartedAt;

  return {
    text: content,
    assistantThreadId,
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs,
      promptChars: {
        system: instructions.length,
        user: useHostedAssistant ? assistantPrompt.length : userPrompt.length,
      },
    },
    debug: {
      systemPrompt: instructions,
      developerPrompt,
      userPrompt: useHostedAssistant ? assistantPrompt : userPrompt,
      rawOutput: json,
      providerRequest,
      toolDefinitions,
      toolTrace,
    },
  };
}

function shouldUseTools(req: McpChatRequest): boolean {
  if (isHostedStructuredBuildRequest(req)) return true;
  const msg = req.userMessage.toLowerCase();
  return (
    msg.includes('verify') ||
    msg.includes('search scpi') ||
    msg.includes('look up') ||
    msg.includes('lookup') ||
    msg.includes('check docs') ||
    msg.includes('exact syntax')
  );
}

function isModelFirstPriority(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  return (
    msg.includes('build a complete tekautomate flow') ||
    msg.includes('command lookup request') ||
    /\b(command|syntax|params?|examples?|what is|how do i|lookup|look up)\b/.test(msg) ||
    msg.includes('validate tm_devices command usage') ||
    msg.includes('sync / wait review') ||
    msg.includes('find missing synchronization') ||
    msg.includes('return actions_json')
  );
}

function shouldAttemptShortcutFirst(req: McpChatRequest): boolean {
  const msg = req.userMessage.toLowerCase();
  if (isHostedStructuredBuildRequest(req)) return false;
  if (isModelFirstPriority(req)) return false;
  const lookupIntent = /\b(command|syntax|params?|examples?|what is|how do i|lookup|look up)\b/.test(msg);
  const editIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply)\b/.test(msg);
  // Keep deterministic shortcuts for concise direct asks only.
  return (
    msg.length <= 180 &&
    editIntent &&
    !lookupIntent &&
    (
      /\bfast\s*frame\b|\bfastframes?\b/.test(msg) ||
      /\bmeas(?:urement)?s?\b/.test(msg)
    )
  );
}

function isExactScpiLookupRequest(req: McpChatRequest): boolean {
  const msg = String(req.userMessage || '').toLowerCase().trim();
  if (!msg) return false;
  const lookupIntent =
    /^(what(?:'s| is)|which|lookup|look up|show|list|find)\b/.test(msg) &&
    /\b(command|scpi|syntax|header|query)\b/.test(msg);
  const explicitLookup =
    /\b(what(?:'s| is)?\s+the\s+(?:scpi\s+)?command\s+for|scpi\s+for|command\s+for)\b/.test(msg) ||
    /\b(show|list)\b.*\b(related commands?|all commands?)\b/.test(msg);
  const flowEditIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply|run)\b/.test(msg);
  const followUpNegationIntent = /\b(don['’]?t|do not|skip|these|that one|this one|use this|not this)\b/.test(msg);
  const reasoningIntent = isReasoningRequest(msg) || /\b(troubleshoot|diagnose|why|recommend|best|optimal)\b/.test(msg);
  return (lookupIntent || explicitLookup) && !flowEditIntent && !followUpNegationIntent && !reasoningIntent;
}

function shouldAllowPlannerOnlyShortcut(req: McpChatRequest): boolean {
  // Planner-only shortcut should be very narrow: exact SCPI lookup asks.
  // All recommendation, diagnostic, and composition asks should go through AI.
  return isExactScpiLookupRequest(req);
}

function canShortcut(plannerOutput: PlannerOutput, req: McpChatRequest): boolean {
  const resolvedCount = plannerOutput?.resolvedCommands?.length || 0;
  const unresolvedCount = plannerOutput?.unresolved?.length || 0;
  if (resolvedCount === 0 || unresolvedCount > 0) return false;
  if (isExplainOnlyCommandAsk(req)) return false;
  if (isFollowUpCorrectionRequest(req)) return false;

  const backend = String(req.flowContext.backend || '').toLowerCase();
  // Keep tm_devices on model/tool path until planner has deterministic tm_devices materialization.
  if (backend === 'tm_devices') return false;

  // Allow planner shortcut for deterministic build/edit flows across device families.
  return (
    isFlowBuildIntentMessage(req.userMessage) ||
    shouldAttemptShortcutFirst(req) ||
    isExactScpiLookupRequest(req)
  );
}

function shouldUseCompactDeveloperContext(req: McpChatRequest): boolean {
  if (isFlowValidationRequest(req)) return false;
  const hasThread = Boolean(String(req.openaiThreadId || '').trim());
  const hasHistory = Array.isArray(req.history) && req.history.length > 0;
  if (!hasThread && !hasHistory) return false;
  const msg = String(req.userMessage || '').trim();
  if (!msg) return false;
  const likelyBigRebuild = /\b(build|create|replace|from scratch|new flow|full flow)\b/i.test(msg);
  if (likelyBigRebuild) return false;
  return msg.length <= 260;
}

function isFollowUpCorrectionRequest(req: McpChatRequest): boolean {
  const msg = String(req.userMessage || '').toLowerCase().trim();
  if (!msg) return false;
  const hasHistory = Array.isArray(req.history) && req.history.length > 0;
  if (!hasHistory) return false;

  const correctionWords =
    /\b(don['’]?t|do not|stop|skip|no|wrong|not this|use this|keep|append|add to existing|extend|continue|why did|wiped|removed)\b/.test(
      msg
    );
  const referentialWords = /\b(this|that|these|those|previous|last|above|again|same)\b/.test(msg);
  const shortFollowUp = msg.length <= 180;
  return shortFollowUp && (correctionWords || referentialWords);
}

function hasActionsJsonPayload(text: string): boolean {
  return /ACTIONS_JSON\s*:\s*\{[\s\S]*"actions"\s*:/i.test(text);
}

function hasEmptyActionsJson(text: string): boolean {
  return /ACTIONS_JSON\s*:\s*\{[\s\S]*"actions"\s*:\s*\[\s*\]/i.test(text);
}

function looksLikeUnverifiedGapResponse(text: string): boolean {
  return /\b(not verified|could not verify|verification is insufficient|unverified)\b/i.test(String(text || ''));
}

function isNonActionableModelResponse(text: string, errors: string[]): boolean {
  const body = String(text || '');
  const missingActions = !hasActionsJsonPayload(body);
  const emptyActions = hasEmptyActionsJson(body);
  const verificationGap = looksLikeUnverifiedGapResponse(body);
  const parseFailed = (errors || []).some((error) => /ACTIONS_JSON parse failed/i.test(String(error || '')));
  const noActionSignals =
    /\b(no actionable|no action(?:s)? generated|could not build|unable to build|cannot build|insufficient info to build)\b/i.test(
      body
    );
  return missingActions || emptyActions || verificationGap || parseFailed || noActionSignals;
}

function isExplainOnlyCommandAsk(req: McpChatRequest): boolean {
  if (req.intent === 'command_explain') return true;
  const msg = req.userMessage.toLowerCase();
  const commandLookupQuestion =
    /^(what|which|how)\b[\s\S]*\b(command|scpi|header|syntax)\b[\s\S]*\?/i.test(msg) ||
    /\bwhat(?:'s| is)\s+the\s+(?:scpi\s+)?command\b/i.test(msg) ||
    /\bset(?:s|ting)?\s+or\s+quer(?:y|ies)\b/i.test(msg);
  const flowEditIntent = /\b(add|insert|set|configure|build|create|make|update|fix|change|apply|replace|delete|remove)\b/.test(
    msg
  );
  const explanationIntent =
    /\b(explain|explanation|reasoning|rationale|why|walk me through|walkthrough|how does|how do|how can)\b/.test(
      msg
    ) || isReasoningRequest(msg);
  if (commandLookupQuestion && !flowEditIntent) return true;
  if (explanationIntent && !flowEditIntent) return true;
  return (
    msg.includes('command lookup request') &&
    msg.includes('focused command explanation') &&
    msg.includes('do not rewrite the full flow')
  );
}

function getModePrompt(req: McpChatRequest): string {
  if (isExplainOnlyCommandAsk(req)) {
    return [
      '# TekAutomate Command Explainer',
      '- This request is explanation-only for a selected command/step.',
      '- Return plain explanatory text only.',
      '- Never output ACTIONS_JSON for this mode.',
      '- Do not propose flow apply actions unless explicitly requested.',
      '- Cover command purpose, parameters, valid values/ranges, set/query usage, and common mistakes.',
      '- Preferred format:',
      '  Command: `<HEADER>`',
      '  Set: `<set form>`',
      '  Query: `<query form>`',
      '  Notes: one concise line when needed.',
    ].join('\n');
  }
  return loadPromptFile(req.outputMode);
}

function resolveOpenAiModel(req: McpChatRequest): string {
  const requested = String(req.model || '').trim();
  if (requested) return requested;
  const envDefault = String(process.env.OPENAI_DEFAULT_MODEL || '').trim();
  return envDefault || 'gpt-5.4-nano';
}

async function runOpenAiToolLoop(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  _maxCalls = 8
): Promise<{
  text: string;
  assistantThreadId?: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const modePrompt = getModePrompt(req);
  const systemPrompt = buildSystemPrompt(modePrompt, req.outputMode);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
  const useHostedAssistant = shouldUseOpenAiAssistant(req);
  const compactDeveloperContext = shouldUseCompactDeveloperContext(req);
  const developerPrompt = isExplainOnlyCommandAsk(req)
    ? 'Command explanation mode. Return plain text guidance only.'
    : await buildContext(req, { compact: compactDeveloperContext });
  let assistantPrompt = buildAssistantUserPrompt(req, flowCommandIssues, {
    hostedPromptConfigured: useHostedAssistant && Boolean(resolveOpenAiPromptId(req)),
  });
  const toolTrace: NonNullable<ToolLoopResult['debug']>['toolTrace'] = [];
  if (useHostedAssistant) {
    console.log(
      '[HOSTED] developer message length:',
      developerPrompt.length,
      'compact:',
      compactDeveloperContext,
      'hasPlannerSection:',
      developerPrompt.includes('PLANNER RESOLVED')
    );
    console.log('[MCP] OpenAI route: assistant (Responses + tools)');
    const preferHostedOneShot =
      req.mode === 'mcp_ai' &&
      isHostedStructuredBuildRequest(req) &&
      !isFlowValidationRequest(req) &&
      !isExplainOnlyCommandAsk(req) &&
      !isFollowUpCorrectionRequest(req);
    if (preferHostedOneShot) {
      console.log('[MCP] OpenAI fast-path: one-shot hosted response (no tool loop)');
      const oneShotStartedAt = Date.now();
      const oneShot = await runOpenAiHostedResponse(req, assistantPrompt, {
        tools: [],
        developerMessage: developerPrompt,
      });
      const oneShotHasStructuredOutput =
        hasActionsJsonPayload(oneShot.text) ||
        /```json\s*[\s\S]*```/i.test(String(oneShot.text || ''));
      if (oneShotHasStructuredOutput) {
        return {
          text: oneShot.text,
          assistantThreadId: oneShot.responseId,
          metrics: {
            totalMs: 0,
            usedShortcut: false,
            provider: 'openai',
            iterations: 1,
            toolCalls: 0,
            toolMs: 0,
            modelMs: Date.now() - oneShotStartedAt,
            promptChars: {
              system: systemPrompt.length,
              user: assistantPrompt.length,
            },
          },
          debug: {
            promptFileText: modePrompt,
            systemPrompt,
            developerPrompt,
            userPrompt: assistantPrompt,
            rawOutput: oneShot.raw,
            providerRequest: oneShot.requestPayload,
            toolDefinitions: [],
            toolTrace: [],
          },
        };
      }
      console.log('[MCP] OpenAI fast-path fallback: response lacked structured output, running tool loop.');
    }
    const preloadedContext = await preloadSourceOfTruthContext(req, toolTrace);
    if (preloadedContext.contextText) {
      assistantPrompt = `${assistantPrompt}\n\n${preloadedContext.contextText}`;
    }

    const initialPhase: HostedToolPhase = 'initial';
    const toolDefinitions: Array<{ name: string; description: string }> = buildHostedToolDefinitions(
      buildHostedResponsesTools(req, initialPhase, {
        restrictSearchTools: preloadedContext.restrictSearchTools,
        batchMaterializeOnly: preloadedContext.batchMaterializeOnly,
      })
        .filter((tool) => tool.type === 'function' && typeof tool.name === 'string')
        .map((tool) => String(tool.name))
    );
    const providerRequests: Record<string, unknown>[] = [];
    let latestJson: Record<string, unknown> = {};
    let assistantThreadId: string | undefined;
    let finalText = '';
    let currentInput: HostedResponseInputItem[] | undefined;
    let previousResponseId: string | undefined;
    const toolCache = new Map<string, unknown>();
    let totalModelMs = 0;
    let totalToolMs = 0;
    let totalToolCalls = toolTrace.length;
    let iterations = 0;
    let pendingToolOutputs: HostedResponseInputItem[] | undefined;
    let currentPhase: HostedToolPhase = initialPhase;

    for (let i = 0; i < Math.max(1, _maxCalls); i += 1) {
      iterations = i + 1;
      const hostedTools = buildHostedResponsesTools(req, currentPhase, {
        restrictSearchTools: currentPhase === 'initial' && preloadedContext.restrictSearchTools,
        batchMaterializeOnly: preloadedContext.batchMaterializeOnly,
      });
      const toolChoice = buildHostedAllowedToolChoice(hostedTools);
      const modelStartedAt = Date.now();
      const hosted = await runOpenAiHostedResponse(req, assistantPrompt, {
        inputOverride: currentInput,
        previousResponseId,
        tools: hostedTools,
        toolChoice: toolChoice || 'auto',
        developerMessage: developerPrompt,
      });
      totalModelMs += Date.now() - modelStartedAt;
      providerRequests.push(hosted.requestPayload);
      latestJson = hosted.raw;
      assistantThreadId = hosted.responseId;
      previousResponseId = hosted.responseId;

      const functionCalls = extractHostedFunctionCalls(hosted.raw);
      if (!functionCalls.length) {
        finalText = hosted.text;
        pendingToolOutputs = undefined;
        break;
      }

      const toolOutputs: HostedResponseInputItem[] = [];
      let allCallsCached = functionCalls.length > 0;
      let shouldForceFinalAnswer = false;
      for (const call of functionCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.argumentsText);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            parsedArgs = parsed as Record<string, unknown>;
          }
        } catch {
          parsedArgs = {};
        }

        const cacheKey = `${call.name}:${stableStringify(parsedArgs)}`;
        const startedAt = new Date().toISOString();
        const cachedResult = toolCache.get(cacheKey);
        const t0 = Date.now();
        const rawResult = typeof cachedResult === 'undefined'
          ? await executeHostedToolCall(req, call.name, parsedArgs)
          : cachedResult;
        const durationMs = typeof cachedResult === 'undefined' ? Date.now() - t0 : 0;
        if (typeof cachedResult === 'undefined') {
          toolCache.set(cacheKey, rawResult);
          totalToolMs += durationMs;
          totalToolCalls += 1;
          allCallsCached = false;
        }
        toolTrace.push({
          name: call.name,
          args: parsedArgs,
          startedAt,
          durationMs,
          resultSummary: {
            ...buildToolResultSummary(rawResult),
            cached: typeof cachedResult !== 'undefined',
          },
          rawResult,
        });
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(rawResult),
        });
        if (call.name === 'verify_scpi_commands' || call.name === 'finalize_scpi_commands' || call.name === 'validate_action_payload') {
          shouldForceFinalAnswer = true;
        }
      }

      if ((allCallsCached || shouldForceFinalAnswer) && toolOutputs.length) {
        const reason = shouldForceFinalAnswer
          ? 'Hosted Responses verification pass completed; forcing final answer without more tools'
          : 'Hosted Responses repeated cached tool calls; forcing final answer without more tools';
        console.log(`[MCP] ${reason}`);
        const modelStartedAt = Date.now();
        const hostedFinal = await runOpenAiHostedResponse(req, assistantPrompt, {
          inputOverride: buildHostedFinalAnswerInput(toolOutputs),
          previousResponseId,
          developerMessage: developerPrompt,
        });
        totalModelMs += Date.now() - modelStartedAt;
        providerRequests.push(hostedFinal.requestPayload);
        latestJson = hostedFinal.raw;
        assistantThreadId = hostedFinal.responseId;
        previousResponseId = hostedFinal.responseId;
        finalText = hostedFinal.text;
        iterations = providerRequests.length;
        pendingToolOutputs = undefined;
        break;
      }

      currentInput = toolOutputs;
      pendingToolOutputs = toolOutputs;
      currentPhase = 'finalize';
    }

    if (!finalText && pendingToolOutputs?.length) {
      console.log('[MCP] Hosted Responses loop reached tool-call cap; forcing final answer pass without tools');
      const modelStartedAt = Date.now();
      const hosted = await runOpenAiHostedResponse(req, assistantPrompt, {
        inputOverride: buildHostedFinalAnswerInput(pendingToolOutputs),
        previousResponseId,
        developerMessage: developerPrompt,
      });
      totalModelMs += Date.now() - modelStartedAt;
      providerRequests.push(hosted.requestPayload);
      latestJson = hosted.raw;
      assistantThreadId = hosted.responseId;
      previousResponseId = hosted.responseId;
      finalText = hosted.text;
      iterations = providerRequests.length;
    }

    return {
      text: finalText || extractOpenAiResponseText(latestJson),
      assistantThreadId,
      metrics: {
        totalMs: 0,
        usedShortcut: false,
        provider: 'openai',
        iterations,
        toolCalls: totalToolCalls,
        toolMs: totalToolMs,
        modelMs: totalModelMs,
        promptChars: {
          system: 0,
          user: assistantPrompt.length,
        },
      },
      debug: {
        promptFileText: modePrompt,
        systemPrompt: 'Hosted assistant mode (system prompt handled by assistant).',
        developerPrompt,
        userPrompt: assistantPrompt,
        rawOutput: latestJson,
        providerRequest:
          providerRequests.length <= 1
            ? providerRequests[0]
            : { requests: providerRequests },
        toolDefinitions,
        toolTrace,
      },
    };
  }

  let json: Record<string, unknown>;
  let content = '';
  let providerRequest: Record<string, unknown>;
  console.log('[MCP] OpenAI route: direct (Chat Completions one-shot)');
  const openAiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
  const model = resolveOpenAiModel(req);
  providerRequest = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...buildOpenAiCompletionTokenOption(model),
  };
  const res = await fetch(`${openAiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(providerRequest),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  }
  json = (await res.json()) as Record<string, unknown>;
  content = extractChatCompletionText(json);

  return {
    text: content,
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'openai',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: {
        system: useHostedAssistant ? 0 : systemPrompt.length,
        user: useHostedAssistant ? assistantPrompt.length : userPrompt.length,
      },
    },
    debug: {
      promptFileText: modePrompt,
      systemPrompt: useHostedAssistant ? 'Hosted assistant mode (system prompt handled by assistant).' : systemPrompt,
      userPrompt: useHostedAssistant ? assistantPrompt : userPrompt,
      rawOutput: json,
      providerRequest,
      toolDefinitions,
      toolTrace,
    },
  };
}

async function runAnthropicToolLoop(
  req: McpChatRequest,
  flowCommandIssues: string[] = [],
  maxCalls = 6
): Promise<{
  text: string;
  metrics: NonNullable<ToolLoopResult['metrics']>;
  debug: NonNullable<ToolLoopResult['debug']>;
}> {
  const modePrompt = getModePrompt(req);
  const systemPrompt = buildSystemPrompt(modePrompt, req.outputMode);
  const userPrompt = buildUserPrompt(req, flowCommandIssues);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      system: systemPrompt,
      max_tokens: 2000,
      messages: [
        ...(req.history || [])
          .slice(-6)
          .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content.slice(0, 800) })),
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const text = Array.isArray(json.content)
    ? (json.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === 'text')
        .map((c) => String(c.text || ''))
        .join('\\n')
    : '';
  return {
    text,
    metrics: {
      totalMs: 0,
      usedShortcut: false,
      provider: 'anthropic',
      iterations: 1,
      toolCalls: 0,
      toolMs: 0,
      modelMs: 0,
      promptChars: {
        system: systemPrompt.length,
        user: userPrompt.length,
      },
    },
    debug: {
      promptFileText: modePrompt,
      systemPrompt,
      userPrompt,
      toolDefinitions: [],
      toolTrace,
    },
  };
}

export async function runToolLoop(req: McpChatRequest): Promise<ToolLoopResult> {
  const startedAt = Date.now();
  const rawApiKey = String((req as { apiKey?: string }).apiKey || '').trim();
  const mcpOnlyMode =
    req.mode === 'mcp_only' ||
    rawApiKey.length === 0 ||
    rawApiKey === '__mcp_only__' ||
    rawApiKey.toLowerCase() === 'undefined';
  const explainOnlyMode = isExplainOnlyCommandAsk(req);
  const forceToolCallMode = mcpOnlyMode ? false : Boolean(req.toolCallMode);
  const buildHeavyMode = isFlowBuildIntentMessage(req.userMessage);
  const normalizedModelFamily = normalizeScopeModelFamily(req);
  if (normalizedModelFamily && normalizedModelFamily !== req.flowContext.modelFamily) {
    req.flowContext.modelFamily = normalizedModelFamily;
  }
  console.log('[DEBUG] deviceType:', req.flowContext.deviceType || 'SCOPE');
  console.log('[DEBUG] toolCallMode:', forceToolCallMode);
  const directExec = forceToolCallMode ? null : detectDirectExecution(req);
  if (directExec) {
    if (req.instrumentEndpoint) {
      const result = await probeCommandProxy(req.instrumentEndpoint, directExec.command);
      const responseText =
        result.ok && result.data && typeof result.data === 'object' && typeof result.data.response === 'string'
          ? result.data.response
          : '';
      const decoded = decodeCommandStatus(directExec.command, responseText);
      const finalText = decoded.length > 0
        ? `${directExec.command}: ${responseText}\nDecoded:\n- ${decoded.join('\n- ')}`.trim()
        : `${directExec.command}: ${responseText}`.trim();
      return {
        text: finalText,
        displayText: finalText,
        assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
        errors: result.ok ? [] : ['Live instrument execution failed'],
        warnings: result.warnings || [],
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
          provider: req.provider,
          iterations: 0,
          toolCalls: 1,
          toolMs: Date.now() - startedAt,
          modelMs: 0,
          promptChars: { system: 0, user: 0 },
        },
        debug: {
          shortcutResponse: finalText,
          toolTrace: [],
        },
      };
    }

    const step =
      directExec.type === 'query' || directExec.type === 'error_check'
        ? {
            id: '2',
            type: 'query',
            label: directExec.command,
            params: { command: directExec.command, saveAs: 'result' },
          }
        : {
            id: '2',
            type: 'write',
            label: directExec.command,
            params: { command: directExec.command },
          };

    return buildShortcutResponse({
      summary: `Execute ${directExec.command}`,
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        step,
        { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
      req,
      startedAt,
    });
  }

  if (!forceToolCallMode && shouldAskScopePlatform(req)) {
    const text =
      'Need your scope platform to choose the right command family. Are you on DPO 5k/7k/70k, or newer MSO series (2/4/5/6/7)?';
    return {
      text,
      displayText: text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        shortcutResponse: text,
        toolTrace: [],
      },
    };
  }
  const allowMissingActionsJson = explainOnlyMode;
  const flowValidateMode = isFlowValidationRequest(req);
  const flowCommandIssues = flowValidateMode
    ? await detectFlowCommandIssues(req)
    : [];
  if (flowValidateMode && flowCommandIssues.length > 0) {
    const text =
      `Found ${flowCommandIssues.length} flow command issue(s).\n` +
      `ACTIONS_JSON: ${JSON.stringify({
        summary: 'Flow has command verification issues.',
        findings: flowCommandIssues,
        suggestedFixes: [
          'Fix unverified command headers and invalid argument values, then run Validate Flow again.',
        ],
        actions: [],
      })}`;
    return {
      text,
      displayText: text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: false,
        provider: req.provider,
        iterations: 0,
        toolCalls: 1,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        toolDefinitions: [],
        toolTrace: [
          {
            tool: 'detectFlowCommandIssues',
            args: {},
            result: { count: flowCommandIssues.length, issues: flowCommandIssues },
          },
        ],
      },
    };
  }
  const reasoningMode = isReasoningRequest(req.userMessage);
  const followUpCorrectionMode = isFollowUpCorrectionRequest(req);
  const allowDeterministicShortcut = mcpOnlyMode;
  const allowLegacyDeterministicShortcuts = false;
  const commonServerShortcut =
    !allowLegacyDeterministicShortcuts ||
    !allowDeterministicShortcut ||
    explainOnlyMode ||
    (reasoningMode && !buildHeavyMode) ||
    followUpCorrectionMode ||
    forceToolCallMode
      ? null
      : await buildPyvisaCommonServerShortcut(req);
  const fastFrameShortcut =
    !allowLegacyDeterministicShortcuts ||
    !allowDeterministicShortcut ||
    explainOnlyMode ||
    (reasoningMode && !buildHeavyMode) ||
    followUpCorrectionMode ||
    forceToolCallMode
      ? null
      : buildPyvisaFastFrameShortcut(req);
  const measurementShortcut =
    !allowLegacyDeterministicShortcuts ||
    !allowDeterministicShortcut ||
    explainOnlyMode ||
    (reasoningMode && !buildHeavyMode) ||
    followUpCorrectionMode ||
    forceToolCallMode
      ? null
      : await buildPyvisaMeasurementShortcut(req);
  const shortcut = explainOnlyMode
    ? null
    : (
        commonServerShortcut ||
        fastFrameShortcut ||
        measurementShortcut ||
        (
          !allowLegacyDeterministicShortcuts ||
          !allowDeterministicShortcut ||
          (reasoningMode && !buildHeavyMode) ||
          followUpCorrectionMode ||
          forceToolCallMode
            ? null
            : buildTmDevicesMeasurementShortcut(req)
        )
      );
  const shouldUseShortcut = explainOnlyMode
    ? false
    : (
        allowDeterministicShortcut &&
        (!reasoningMode || buildHeavyMode) &&
        !followUpCorrectionMode &&
        !forceToolCallMode &&
        (
          Boolean(commonServerShortcut) ||
          Boolean(fastFrameShortcut) ||
          shouldAttemptShortcutFirst(req) ||
          (Boolean(shortcut) && isHostedStructuredBuildRequest(req))
        )
      );
  if (!explainOnlyMode && shortcut && shouldUseShortcut) {
    const checked = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
      alias: req.flowContext.alias,
      instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
    }, { allowMissingActionsJson });
    return {
      text: checked.text,
      displayText: shortcut,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
      debug: {
        shortcutResponse: shortcut,
        toolTrace: [],
      },
    };
  }

  let plannerShortcut: string | null = null;
  let plannerOutputCache: PlannerOutput | null = null;
  if (!explainOnlyMode) {
    const plannerOutput = await planIntent(req);
    plannerOutputCache = plannerOutput;
    console.log(
      '[PLANNER] deviceType:',
      req.flowContext.deviceType || 'SCOPE',
      'resolvedCount:',
      plannerOutput?.resolvedCommands?.length || 0,
      'unresolvedCount:',
      plannerOutput?.unresolved?.length || 0
    );
    const shortcutEligible = canShortcut(plannerOutput, req);
    console.log('[SHORTCUT]', {
      resolvedCount: plannerOutput.resolvedCommands.length,
      unresolvedCount: plannerOutput.unresolved.length,
      deviceType: req.flowContext.deviceType,
      isReasoning: isReasoningRequest(req.userMessage),
      isBuildHeavy: isFlowBuildIntentMessage(req.userMessage),
      canShortcut: shortcutEligible,
    });
    plannerShortcut =
      allowDeterministicShortcut &&
      shortcutEligible &&
      plannerOutput.resolvedCommands.length > 0 &&
      plannerOutput.unresolved.length === 0
        ? buildActionsFromPlanner(plannerOutput, req)
        : null;
  }
  if (!explainOnlyMode && allowDeterministicShortcut && plannerShortcut) {
    const checked = await postCheckResponse(plannerShortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
      alias: req.flowContext.alias,
      instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
    }, { allowMissingActionsJson });
    return {
      text: checked.text,
      displayText: plannerShortcut,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
      debug: {
        shortcutResponse: plannerShortcut,
        toolTrace: [],
      },
    };
  }

  // MCP-only mode is deterministic/local by design:
  // never call external model providers from here.
  if (mcpOnlyMode) {
    if (explainOnlyMode) {
      const explainApply = await buildMcpOnlyExplainApplyResponse(req);
      if (explainApply) {
        const checked = await postCheckResponse(explainApply, {
          backend: req.flowContext.backend,
          modelFamily: req.flowContext.modelFamily,
          originalSteps: req.flowContext.steps,
          scpiContext: req.scpiContext as Array<Record<string, unknown>>,
          alias: req.flowContext.alias,
          instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
        }, { allowMissingActionsJson: false });
        return {
          text: checked.text,
          displayText: checked.text,
          assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
          errors: checked.errors,
          warnings: checked.warnings,
          metrics: {
            totalMs: Date.now() - startedAt,
            usedShortcut: true,
            provider: req.provider,
            iterations: 0,
            toolCalls: 0,
            toolMs: 0,
            modelMs: 0,
            promptChars: {
              system: 0,
              user: 0,
            },
          },
          debug: {
            shortcutResponse: checked.text,
            toolTrace: [],
          },
        };
      }
    }

    const plannerOutput = plannerOutputCache || await planIntent(req);
    const unresolved = plannerOutput.unresolved || [];
    const deterministicActions =
      plannerOutput.resolvedCommands.length > 0 && unresolved.length === 0
        ? buildActionsFromPlanner(plannerOutput, req)
        : null;

    if (deterministicActions) {
      const checked = await postCheckResponse(deterministicActions, {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      }, { allowMissingActionsJson });
      return {
        text: checked.text,
        displayText: deterministicActions,
        assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
        errors: checked.errors,
        warnings: checked.warnings,
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
          provider: req.provider,
          iterations: 0,
          toolCalls: 0,
          toolMs: 0,
          modelMs: 0,
          promptChars: {
            system: 0,
            user: 0,
          },
        },
        debug: {
          shortcutResponse: deterministicActions,
          toolTrace: [],
        },
      };
    }

    const findings = unresolved.length
      ? unresolved.slice(0, 12).map((u) => `Unresolved: ${u}`)
      : ['No deterministic planner actions were generated for this request.'];
    const response = `ACTIONS_JSON: ${JSON.stringify({
      summary: unresolved.length
        ? 'MCP-only planner could not fully resolve all commands.'
        : 'MCP-only planner found no actionable deterministic flow changes.',
      findings,
      suggestedFixes: [
        'Rephrase with explicit instrument intent, channels, and protocol details.',
        'Use exact SCPI/measurement wording when possible for deterministic matching.',
      ],
      confidence: unresolved.length ? 'medium' : 'low',
      actions: [],
    })}`;
    return {
      text: response,
      displayText: response,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: unresolved.length ? ['MCP-only mode skipped model fallback because request was partially unresolved.'] : [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: false,
        provider: req.provider,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: {
          system: 0,
          user: 0,
        },
      },
      debug: {
        toolTrace: [],
      },
    };
  }
  if (flowValidateMode && flowCommandIssues.length === 0) {
    const flatSteps = flattenSteps(Array.isArray(req.flowContext.steps) ? req.flowContext.steps : []);
    const firstType = flatSteps.length ? String(flatSteps[0].type || '').toLowerCase() : '';
    const lastType = flatSteps.length ? String(flatSteps[flatSteps.length - 1].type || '').toLowerCase() : '';
    const findings: string[] = [];
    if (flatSteps.length && firstType !== 'connect') {
      findings.push('Flow does not start with connect.');
    }
    if (flatSteps.length && lastType !== 'disconnect') {
      findings.push('Flow does not end with disconnect.');
    }
    const text =
      `Flow verification passed: ${flatSteps.length} step(s) checked, 0 SCPI/header issues found.\n` +
      `ACTIONS_JSON: ${JSON.stringify({
        summary: 'Flow commands verified against command index.',
        findings,
        suggestedFixes: findings.length
          ? ['Keep connect as first step and disconnect as last step for full-run flows.']
          : [],
        actions: [],
      })}`;
    return {
      text,
      displayText: text,
      assistantThreadId: resolveOpenAiResponseCursor(req) || undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: Date.now() - startedAt,
        usedShortcut: true,
        provider: req.provider,
        iterations: 0,
        toolCalls: 1,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 },
      },
      debug: {
        shortcutResponse: text,
        toolTrace: [
          {
            tool: 'detectFlowCommandIssues',
            args: {},
            result: { count: 0, issues: [] },
          },
        ],
      },
    };
  }

  const maxToolRounds = forceToolCallMode ? 8 : (isHostedStructuredBuildRequest(req) ? 4 : 3);
  const loopResult = (forceToolCallMode || shouldUseTools(req))
    ? await runOpenAiToolLoop(req, flowCommandIssues, maxToolRounds)
    : await runOpenAiResponses(req, flowCommandIssues);
  const assistantMode = Boolean(loopResult.assistantThreadId);
  const checkedPass1 = await postCheckResponse(loopResult.text, {
    backend: req.flowContext.backend,
    modelFamily: req.flowContext.modelFamily,
    originalSteps: req.flowContext.steps,
    scpiContext: req.scpiContext as Array<Record<string, unknown>>,
    alias: req.flowContext.alias,
    instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
  }, { allowMissingActionsJson, assistantMode, toolTrace: loopResult.debug?.toolTrace as Array<Record<string, unknown>> | undefined });
  // Second pass only for direct LLM; assistant mode uses single lenient pass.
  const checkedPass2 = assistantMode
    ? checkedPass1
    : await postCheckResponse(checkedPass1.text, {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      }, { allowMissingActionsJson });
  const checked = {
    text: checkedPass2.text,
    errors: Array.from(new Set([...(checkedPass1.errors || []), ...(checkedPass2.errors || [])])),
    warnings: Array.from(new Set([...(checkedPass1.warnings || []), ...(checkedPass2.warnings || [])])),
  };

  // Hybrid gap-fill: when hosted/model output fail-closes or returns no actions,
  // try deterministic planner synthesis for resolvable commands.
  const shouldTryPlannerGapFill =
    !allowMissingActionsJson &&
    !explainOnlyMode &&
    !followUpCorrectionMode &&
    isNonActionableModelResponse(checked.text, checked.errors);
  if (shouldTryPlannerGapFill) {
    const plannerOutput = await planIntent(req);
    if (plannerOutput.resolvedCommands.length > 0) {
      const plannerFill = buildActionsFromPlanner(plannerOutput, req);
      if (plannerFill) {
        const plannerChecked = await postCheckResponse(
          plannerFill,
          {
            backend: req.flowContext.backend,
            modelFamily: req.flowContext.modelFamily,
            originalSteps: req.flowContext.steps,
            scpiContext: req.scpiContext as Array<Record<string, unknown>>,
            alias: req.flowContext.alias,
            instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
          },
          { allowMissingActionsJson }
        );
        if (!plannerChecked.errors.length) {
          return {
            text: plannerChecked.text,
            displayText: plannerFill,
            assistantThreadId: loopResult.assistantThreadId,
            errors: [],
            warnings: Array.from(new Set([...(checked.warnings || []), 'Hybrid planner gap-fill applied.'])),
            metrics: {
              ...loopResult.metrics,
              totalMs: Date.now() - startedAt,
              usedShortcut: true,
            },
            debug: {
              ...loopResult.debug,
              shortcutResponse: plannerFill,
            },
          };
        }
      }
    }
  }

  // If the model returned truncated/invalid ACTIONS_JSON, retry once with
  // a strict JSON-only instruction to recover actionable output.
  if (!allowMissingActionsJson && checked.errors.includes('ACTIONS_JSON parse failed')) {
    const retryReq: McpChatRequest = {
      ...req,
      userMessage:
        `${req.userMessage}\n\n` +
        'Return ONLY valid ACTIONS_JSON as one compact JSON object. No prose, no markdown, no code fences.',
    };
    const retryLoop = shouldUseTools(retryReq)
      ? await runOpenAiToolLoop(retryReq, flowCommandIssues, 2)
      : await runOpenAiResponses(retryReq, flowCommandIssues);
    const retryChecked = await postCheckResponse(
      retryLoop.text,
      {
        backend: req.flowContext.backend,
        modelFamily: req.flowContext.modelFamily,
        originalSteps: req.flowContext.steps,
        scpiContext: req.scpiContext as Array<Record<string, unknown>>,
        alias: req.flowContext.alias,
        instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
      },
      {
        allowMissingActionsJson,
        assistantMode: Boolean(retryLoop.assistantThreadId),
        toolTrace: retryLoop.debug?.toolTrace as Array<Record<string, unknown>> | undefined,
      }
    );
    if (!retryChecked.errors.length) {
      return {
        text: retryChecked.text,
        displayText: retryLoop.displayText || retryLoop.text,
        assistantThreadId: retryLoop.assistantThreadId || loopResult.assistantThreadId,
        errors: [],
        warnings: Array.from(new Set([...(checked.warnings || []), ...(retryChecked.warnings || []), 'Recovered from truncated model output via JSON-only retry.'])),
        metrics: {
          totalMs: Date.now() - startedAt,
          usedShortcut: false,
          provider: req.provider,
          iterations: (loopResult.metrics?.iterations || 1) + 1,
          toolCalls: (loopResult.metrics?.toolCalls || 0),
          toolMs: (loopResult.metrics?.toolMs || 0),
          modelMs: (loopResult.metrics?.modelMs || 0),
          promptChars: loopResult.metrics?.promptChars,
        },
        debug: loopResult.debug,
      };
    }
  }

  if (
    checked.errors.length &&
    shortcut &&
    !commonServerShortcut &&
    !shouldAttemptShortcutFirst(req) &&
    !isHostedStructuredBuildRequest(req)
  ) {
    const fallback = await postCheckResponse(shortcut, {
      backend: req.flowContext.backend,
      modelFamily: req.flowContext.modelFamily,
      originalSteps: req.flowContext.steps,
      scpiContext: req.scpiContext as Array<Record<string, unknown>>,
      alias: req.flowContext.alias,
      instrumentMap: req.flowContext.instrumentMap as Array<Record<string, unknown>> | undefined,
    }, { allowMissingActionsJson });
    const modelLooksWeak = !hasActionsJsonPayload(checked.text) && /return actions_json|add|insert|build|fix|update/i.test(req.userMessage);
    if (!fallback.errors.length && modelLooksWeak) {
      return {
        text: fallback.text,
        displayText: shortcut,
        assistantThreadId: loopResult.assistantThreadId,
        errors: [],
        warnings: fallback.warnings,
        metrics: {
          ...loopResult.metrics,
          totalMs: Date.now() - startedAt,
          usedShortcut: true,
        },
        debug: {
          ...loopResult.debug,
          shortcutResponse: shortcut,
        },
      };
    }
  }

  if (checked.errors.length) {
    console.log('[MCP] postCheck errors:', checked.errors);
  }
  if (checked.warnings.length) {
    console.log('[MCP] postCheck warnings:', checked.warnings);
  }
  return {
      text: checked.text,
      displayText: loopResult.displayText || loopResult.text,
      assistantThreadId: loopResult.assistantThreadId,
      errors: checked.errors,
      warnings: checked.warnings,
      metrics: {
        ...loopResult.metrics,
        totalMs: Date.now() - startedAt,
    },
    debug: loopResult.debug,
  };
}
