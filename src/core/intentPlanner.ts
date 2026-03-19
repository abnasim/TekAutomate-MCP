import { getCommandIndex, type CommandArgument, type CommandCodeExample, type CommandIndex, type CommandRecord } from './commandIndex';
import type { McpChatRequest } from './schemas';

export type IntentGroup =
  | 'CHANNEL_SETUP'
  | 'TRIGGER'
  | 'TRIGGER_B'
  | 'MEASUREMENT'
  | 'BUS_DECODE'
  | 'ACQUISITION'
  | 'FASTFRAME'
  | 'HORIZONTAL'
  | 'DISPLAY'
  | 'CURSOR'
  | 'MATH'
  | 'SEARCH'
  | 'HISTOGRAM'
  | 'SPECTRUM'
  | 'POWER_ANALYSIS'
  | 'SAVE'
  | 'RECALL'
  | 'WAVEFORM_TRANSFER'
  | 'ERROR_CHECK'
  | 'ACT_ON_EVENT'
  | 'AFG_SOURCE'
  | 'AFG_OUTPUT'
  | 'AFG_BURST'
  | 'AFG_MODULATION'
  | 'AWG_OUTPUT'
  | 'AWG_WAVEFORM'
  | 'AWG_CLOCK'
  | 'AWG_SEQUENCE'
  | 'SMU_SOURCE'
  | 'SMU_SENSE'
  | 'SMU_OUTPUT'
  | 'SMU_MEASURE'
  | 'SMU_SWEEP'
  | 'SMU_BUFFER'
  | 'RSA_FREQUENCY'
  | 'RSA_TRIGGER'
  | 'RSA_SPECTRUM'
  | 'RSA_DPX'
  | 'RSA_TRACE'
  | 'IEEE488'
  | 'STATUS'
  | 'SYSTEM';

export type DetectedDeviceType = 'SCOPE' | 'AFG' | 'AWG' | 'SMU' | 'RSA' | 'UNKNOWN';

export interface ParsedChannelIntent {
  channel: string;
  scaleVolts?: number;
  offsetVolts?: number;
  coupling?: 'AC' | 'DC';
  terminationOhms?: number;
  label?: string;
}

export interface ParsedTriggerIntent {
  type?: 'EDGE' | 'PULSE' | 'RUNT' | 'LOGIC' | 'BUS';
  source?: string;
  slope?: 'RISe' | 'FALL';
  levelVolts?: number;
  mode?: 'NORMal' | 'AUTO';
  holdoffSeconds?: number;
}

export interface ParsedMeasurementIntent {
  type:
    | 'FREQUENCY'
    | 'AMPLITUDE'
    | 'RISETIME'
    | 'FALLTIME'
    | 'PK2PK'
    | 'MEAN'
    | 'RMS'
    | 'HIGH'
    | 'LOW'
    | 'PERIOD'
    | 'POVERSHOOT'
    | 'NOVERSHOOT'
    | 'DELAY'
    | 'PHASE';
  source1?: string;
  source2?: string;
}

export interface ParsedBusIntent {
  protocol:
    | 'I2C'
    | 'SPI'
    | 'CANFD'
    | 'CAN'
    | 'UART'
    | 'RS232'
    | 'RS232C'
    | 'LIN'
    | 'ARINC'
    | 'ARINC429'
    | 'MIL'
    | 'MIL1553B';
  bus?: string;
  source1?: string;
  source2?: string;
  clockSource?: string;
  dataSource?: string;
  bitrateBps?: number;
  dataPhaseBitrateBps?: number;
  standard?: string;
  thresholdVolts?: number;
  clockThresholdVolts?: number;
  dataThresholdVolts?: number;
  chipSelect?: string;
  selectPolarity?: 'LOW' | 'HIGH';
  baudRate?: number;
  dataBits?: number;
  parity?: 'NONe' | 'EVEN' | 'ODD';
  slope?: 'RISe' | 'FALL';
}

export interface ParsedAcquisitionIntent {
  mode?: 'AVErage' | 'HIRes' | 'SAMple' | 'PEAKdetect';
  numAvg?: number;
  stopAfter?: 'SEQuence';
  recordLength?: number;
  horizontalScaleSeconds?: number;
  fastFrameCount?: number;
}

export interface ParsedHorizontalIntent {
  scaleSeconds?: number;
  positionSeconds?: number;
  recordLength?: number;
}

export interface ParsedFastFrameIntent {
  count?: number;
  state?: boolean;
}

export interface ParsedMathIntent {
  expression?: string;
  operation?: 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'FFT' | 'UNKNOWN';
  sources?: string[];
}

export interface ParsedCursorIntent {
  type?: 'VERTical' | 'HORizontal' | 'WAVEform';
  source?: string;
}

export interface ParsedSearchIntent {
  type?: 'EDGE' | 'BUS' | 'PULSE' | 'SETUPHOLD' | 'TRANSITION' | 'WINDOW' | 'UNKNOWN';
  bus?: string;
  protocol?: ParsedBusIntent['protocol'];
  searchType?: 'ERRFRAME' | 'ADDRESS' | 'DATA' | 'ANYFIELD';
  condition?: string;
  frameType?: string;
  errType?: string;
}

export interface ParsedAfgIntent {
  channel: 1 | 2;
  function?: 'SINusoid' | 'SQUare' | 'RAMP' | 'PULSe' | 'DC' | 'NOISe' | 'ARBitrary';
  frequencyHz?: number;
  amplitudeVpp?: number;
  offsetVolts?: number;
  dutyCyclePct?: number;
  impedance?: '50' | 'HIGHZ';
  outputOn?: boolean;
  burstCycles?: number;
  burstState?: boolean;
}

export interface ParsedAwgIntent {
  channel: number;
  waveformName?: string;
  frequencyHz?: number;
  amplitudeVpp?: number;
  outputOn?: boolean;
  sampleRateHz?: number;
  runMode?: 'CONTinuous' | 'TRIGgered' | 'GATed' | 'SEQuence';
}

export interface ParsedSmuIntent {
  sourceFunction?: 'VOLTage' | 'CURRent';
  sourceLevel?: number;
  complianceLevel?: number;
  outputOn?: boolean;
  measureFunction?: 'VOLTage' | 'CURRent' | 'RESistance' | 'POWer';
  sweepStart?: number;
  sweepStop?: number;
  sweepPoints?: number;
  saveAs?: string;
}

export interface ParsedRsaIntent {
  centerFreqHz?: number;
  spanHz?: number;
  rbwHz?: number;
  refLevelDbm?: number;
  triggerType?: 'FREE' | 'EXT' | 'IF' | 'TIME';
  traceType?: 'WRITe' | 'MAXHold' | 'MINHold' | 'AVErage';
  measurementType?: 'SPECTRUM' | 'DPX' | 'DEMOD' | 'PULSE';
}

export interface ParsedSaveIntent {
  screenshot?: boolean;
  waveformSources?: string[];
  format?: 'bin' | 'csv' | 'wfm' | 'mat';
  setupPath?: string;
}

export interface ParsedRecallIntent {
  factory?: boolean;
  sessionPath?: string;
}

export interface ParsedStatusIntent {
  esr?: boolean;
  opc?: boolean;
}

export interface PlannerIntent {
  deviceType: DetectedDeviceType;
  modelFamily: string;
  groups: IntentGroup[];
  channels: ParsedChannelIntent[];
  trigger?: ParsedTriggerIntent;
  triggerB?: ParsedTriggerIntent;
  measurements: ParsedMeasurementIntent[];
  bus?: ParsedBusIntent;
  acquisition?: ParsedAcquisitionIntent;
  horizontal?: ParsedHorizontalIntent;
  fastFrame?: ParsedFastFrameIntent;
  math?: ParsedMathIntent;
  cursor?: ParsedCursorIntent;
  search?: ParsedSearchIntent;
  afg?: ParsedAfgIntent;
  awg?: ParsedAwgIntent;
  smu?: ParsedSmuIntent;
  rsa?: ParsedRsaIntent;
  save?: ParsedSaveIntent;
  recall?: ParsedRecallIntent;
  status?: ParsedStatusIntent;
  errorCheck?: boolean;
  reset?: boolean;
  idn?: boolean;
  unresolved: string[];
}

export interface ResolvedCommandArgument {
  name: string;
  type: string;
  required: boolean;
  validValues?: string[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}

export interface ResolvedCommandExample {
  scpi?: string;
  tm_devices?: string;
}

export interface ResolvedCommand {
  group: IntentGroup;
  header: string;
  concreteCommand: string;
  commandType: 'set' | 'query';
  saveAs?: string;
  stepType?: string;
  stepParams?: Record<string, unknown>;
  verified: true;
  sourceFile: string;
  syntax: {
    set?: string;
    query?: string;
  };
  arguments: ResolvedCommandArgument[];
  examples: ResolvedCommandExample[];
  notes?: string[];
  relatedCommands?: string[];
}

export interface PlannerOutput {
  intent: PlannerIntent;
  resolvedCommands: ResolvedCommand[];
  unresolved: string[];
}

interface ParseContext {
  channels: ParsedChannelIntent[];
  bus?: ParsedBusIntent;
}

async function getIntentAliasMaps(): Promise<IntentAliasMaps> {
  if (!intentAliasMapsPromise) {
    intentAliasMapsPromise = buildIntentAliasMaps();
  }
  return intentAliasMapsPromise;
}

async function buildIntentAliasMaps(): Promise<IntentAliasMaps> {
  const index = await getCommandIndex();

  const measurementRecord = findAliasSourceRecord(index, 'MEASUrement:ADDMEAS');
  const triggerRecord = findAliasSourceRecord(index, 'TRIGger:A:TYPe');
  const busRecord = findAliasSourceRecord(index, 'BUS:B<x>:TYPe');
  const acquisitionRecord = findAliasSourceRecord(index, 'ACQuire:MODe');

  return {
    measurementAliases: buildAliasMap(
      extractRecordValidValues(measurementRecord),
      MEASUREMENT_SYNONYMS
    ),
    triggerTypeAliases: buildAliasMap(
      extractRecordValidValues(triggerRecord),
      TRIGGER_TYPE_SYNONYMS
    ),
    busProtocolAliases: buildAliasMap(
      extractRecordValidValues(busRecord),
      BUS_PROTOCOL_SYNONYMS
    ),
    acquisitionModeAliases: buildAliasMap(
      extractRecordValidValues(acquisitionRecord),
      ACQUISITION_MODE_SYNONYMS
    ),
  };
}

function findAliasSourceRecord(index: CommandIndex, header: string): CommandRecord | null {
  const matches = index
    .getEntries()
    .filter((entry) => headersEquivalent(entry.header, header));
  return matches[0] ?? null;
}

function extractRecordValidValues(record: CommandRecord | null): string[] {
  if (!record) return [];
  const values = new Set<string>();
  for (const arg of record.arguments || []) {
    for (const value of extractValidValues(arg.validValues || {}, {})) {
      values.add(String(value));
    }
  }
  return Array.from(values);
}

function buildAliasMap(validValues: string[], synonymMap: Record<string, string[]>): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const add = (alias: string, value: string) => {
    const normalized = normalizeAliasText(alias);
    if (normalized) aliasMap.set(normalized, value);
  };

  for (const value of validValues) {
    add(value, value);
    add(value.toLowerCase(), value);
    add(humanizeEnumValue(value), value);
    for (const alias of synonymMap[value] || []) {
      add(alias, value);
    }
  }

  return aliasMap;
}

function humanizeEnumValue(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/[_/]+/g, ' ')
    .toLowerCase();
}

function normalizeAliasText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchAliasValues(input: string, aliasMap: Map<string, string>): string[] {
  const haystack = ` ${normalizeAliasText(input)} `;
  const matches = new Map<string, { index: number; aliasLength: number }>();
  for (const [alias, value] of aliasMap.entries()) {
    if (!alias) continue;
    const index = haystack.indexOf(` ${alias} `);
    if (index >= 0) {
      const existing = matches.get(value);
      if (!existing || index < existing.index || (index === existing.index && alias.length > existing.aliasLength)) {
        matches.set(value, { index, aliasLength: alias.length });
      }
    }
  }
  return Array.from(matches.entries())
    .sort((left, right) => left[1].index - right[1].index || right[1].aliasLength - left[1].aliasLength)
    .map(([value]) => value);
}

function matchFirstAliasValue(input: string, aliasMap: Map<string, string>): string | undefined {
  return matchAliasValues(input, aliasMap)[0];
}

const CHANNEL_REGEX = /\b(CH[1-4])\b/gi;
const VOLTAGE_REGEX = /(-?\d+(?:\.\d+)?)\s*(mV|V)\b/gi;
const COUPLING_REGEX = /\b(AC|DC)\b/gi;
const TERMINATION_REGEX = /\b(50ohm|50|1Mohm|1M)\b/gi;
const TRIGGER_SOURCE_REGEX = /\b(CH[1-4])\b/i;
const TRIGGER_SLOPE_RISE_REGEX = /\b(rising|rise|ris)\b/i;
const TRIGGER_SLOPE_FALL_REGEX = /\b(falling|fall)\b/i;
const TRIGGER_LEVEL_AT_REGEX = /\bat\s+(-?\d+(?:\.\d+)?)\s*(mV|V)\b/i;
const TRIGGER_MODE_REGEX = /\b(normal|auto)\b/i;
const TRIGGER_HOLDOFF_REGEX = /\bholdoff\s+(\d+(?:\.\d+)?)\s*(ms|us|ns)\b/i;
const BUS_SLOT_REGEX = /\b(B[1-4])\b/i;
const BITRATE_REGEX = /(\d+(?:\.\d+)?)\s*(kbps|mbps)\b/i;
const ACQ_NUMAVG_REGEX = /\b(?:(\d+)\s*waveforms|average\s+(\d+))\b/i;
const ACQ_STOP_AFTER_REGEX = /\b(single\s+sequence|single)\b/i;
const RECORD_LENGTH_REGEX =
  /\b(\d+(?:\.\d+)?[kKmM]?)\s*samples?\b|\brecord\s+length\s+(\d+(?:\.\d+)?[kKmM]?)\b/i;
const FASTFRAME_REGEX = /\bfast\s*frames?\s+(\d+)\b|\bfastframe\s+(\d+)\b/i;
const HORIZONTAL_SCALE_REGEX = /\b(\d+(?:\.\d+)?)\s*(ns|us|ms|s)\/div\b/i;
const HORIZONTAL_POSITION_REGEX = /\bposition\s+(-?\d+(?:\.\d+)?)\s*(ns|us|ms|s)\b/i;
const SAVE_SCREENSHOT_REGEX = /\b(screenshot|capture screen)\b/i;
const SAVE_WAVEFORM_REGEX =
  /\b(save|export)\b(?=[^.!?\n\r]*\b(waveform|channels?|CH[1-4])\b)|\bwaveform\b/i;
const SAVE_PATH_REGEX = /C:\/\S+\.set\b/i;
const RECALL_FACTORY_REGEX = /\b(factory\s+defaults?|reset)\b/i;
const RECALL_SESSION_REGEX = /C:\/\S+\.tss\b/i;
const IDN_REGEX = /\b(idn|\*idn|identify)\b/i;
const ERROR_CHECK_REGEX = /\b(error check|error queue|allev|system error|check errors|esr)\b/i;
const STATUS_QUERY_REGEX = /\b(status quer(?:y|ies)|status checks?|check status|event status|esr|opc)\b/i;

interface IntentAliasMaps {
  measurementAliases: Map<string, string>;
  triggerTypeAliases: Map<string, string>;
  busProtocolAliases: Map<string, string>;
  acquisitionModeAliases: Map<string, string>;
}

const MEASUREMENT_SYNONYMS: Record<string, string[]> = {
  PK2PK: ['pk2pk', 'peak to peak', 'peak-to-peak'],
  POVERSHOOT: ['overshoot', 'positive overshoot'],
  NOVERSHOOT: ['undershoot', 'negative overshoot'],
  RISETIME: ['rise time', 'risetime', 'rise'],
  FALLTIME: ['fall time', 'falltime', 'fall'],
};

const TRIGGER_TYPE_SYNONYMS: Record<string, string[]> = {
  EDGE: ['edge'],
  WIDth: ['width', 'pulse width'],
  TIMEOut: ['timeout', 'time out'],
  RUNt: ['runt'],
  WINdow: ['window'],
  LOGIc: ['logic'],
  SETHold: ['setup hold', 'setup/hold', 'sethold'],
  BUS: ['bus'],
  TRANsition: ['transition'],
};

const BUS_PROTOCOL_SYNONYMS: Record<string, string[]> = {
  CANFD: ['can fd', 'canfd'],
  RS232C: ['rs232', 'rs-232', 'uart'],
  MIL1553B: ['mil', 'mil 1553', 'mil-1553', '1553'],
  ARINC429: ['arinc', 'arinc 429'],
};

const ACQUISITION_MODE_SYNONYMS: Record<string, string[]> = {
  AVErage: ['average', 'avg'],
  HIRes: ['hi res', 'hires', 'high res'],
  SAMple: ['sample'],
  PEAKdetect: ['peak', 'peak detect', 'peakdetect'],
};

let intentAliasMapsPromise: Promise<IntentAliasMaps> | null = null;

export async function parseIntent(
  req: Pick<McpChatRequest, 'userMessage'> & Partial<Pick<McpChatRequest, 'flowContext'>>
): Promise<PlannerIntent> {
  const message = normalizeMessage(req.userMessage);
  const deviceType = detectDeviceType(req);
  const modelFamily = req.flowContext?.modelFamily ?? '';
  const aliasMaps = await getIntentAliasMaps();

  const channels = deviceType === 'SCOPE' ? parseChannelIntent(message) : [];
  const trigger = deviceType === 'SCOPE' ? parseTriggerIntent(message, aliasMaps) : undefined;
  const triggerB = deviceType === 'SCOPE' ? parseSecondaryTriggerIntent(message, aliasMaps) : undefined;
  const bus = deviceType === 'SCOPE' ? parseBusIntent(message, aliasMaps) : undefined;
  const measurements =
    deviceType === 'SCOPE' ? parseMeasurementIntent(message, { channels, bus }, aliasMaps) : [];
  const acquisition = deviceType === 'SCOPE' ? parseAcquisitionIntent(message, aliasMaps) : undefined;
  const horizontal = deviceType === 'SCOPE' ? parseHorizontalIntent(message) : undefined;
  const fastFrame = deviceType === 'SCOPE' ? parseFastFrameIntent(message) : undefined;
  const math = deviceType === 'SCOPE' ? parseMathIntent(message) : undefined;
  const cursor = deviceType === 'SCOPE' ? parseCursorIntent(message) : undefined;
  const search = deviceType === 'SCOPE' ? parseSearchIntent(message, bus) : undefined;

  const afg = deviceType === 'AFG' ? parseAfgIntent(message) : undefined;
  const awg = deviceType === 'AWG' ? parseAwgIntent(message) : undefined;
  const smu = deviceType === 'SMU' ? parseSmuIntent(message) : undefined;
  const rsa = deviceType === 'RSA' ? parseRsaIntent(message) : undefined;

  const save = parseSaveIntent(message, { channels });
  const recall = parseRecallIntent(message);
  const status = parseStatusIntent(message);
  const errorCheck = ERROR_CHECK_REGEX.test(message) || undefined;
  const reset = RECALL_FACTORY_REGEX.test(message) || undefined;
  const idn = IDN_REGEX.test(message) || undefined;

  const groups: IntentGroup[] = [];

  if (deviceType === 'SCOPE') {
    if (channels.length > 0) groups.push('CHANNEL_SETUP');
    if (trigger) groups.push('TRIGGER');
    if (triggerB) groups.push('TRIGGER_B');
    if (measurements.length > 0) groups.push('MEASUREMENT');
    if (bus) groups.push('BUS_DECODE');
    if (acquisition) groups.push('ACQUISITION');
    if (horizontal) groups.push('HORIZONTAL');
    if (fastFrame) groups.push('FASTFRAME');
    if (math) groups.push('MATH');
    if (cursor) groups.push('CURSOR');
    if (search) groups.push('SEARCH');
  }

  if (afg) {
    groups.push('AFG_SOURCE');
    if (afg.outputOn !== undefined || afg.impedance !== undefined) groups.push('AFG_OUTPUT');
    if (afg.burstState !== undefined || afg.burstCycles !== undefined) groups.push('AFG_BURST');
  }

  if (awg) {
    groups.push('AWG_WAVEFORM');
    if (awg.outputOn !== undefined) groups.push('AWG_OUTPUT');
    if (awg.sampleRateHz !== undefined) groups.push('AWG_CLOCK');
    if (awg.runMode === 'SEQuence') groups.push('AWG_SEQUENCE');
  }

  if (smu) {
    if (
      smu.sourceFunction !== undefined ||
      smu.sourceLevel !== undefined ||
      smu.complianceLevel !== undefined
    ) {
      groups.push('SMU_SOURCE');
    }
    if (smu.outputOn !== undefined) groups.push('SMU_OUTPUT');
    if (smu.measureFunction !== undefined) groups.push('SMU_MEASURE');
    if (smu.sweepStart !== undefined || smu.sweepStop !== undefined) groups.push('SMU_SWEEP');
  }

  if (rsa) {
    if (rsa.centerFreqHz !== undefined || rsa.spanHz !== undefined || rsa.rbwHz !== undefined) {
      groups.push('RSA_FREQUENCY');
    }
    if (rsa.measurementType === 'DPX') groups.push('RSA_DPX');
    else if (rsa.measurementType !== undefined) groups.push('RSA_SPECTRUM');
    if (rsa.traceType !== undefined) groups.push('RSA_TRACE');
    if (rsa.triggerType !== undefined) groups.push('RSA_TRIGGER');
  }

  if (save) {
    groups.push('SAVE');
    if (save.waveformSources && save.waveformSources.length > 0) groups.push('WAVEFORM_TRANSFER');
  }
  if (recall) groups.push('RECALL');
  if (status) groups.push('STATUS');
  if (errorCheck) groups.push('ERROR_CHECK');
  if (idn) groups.push('IEEE488');
  if (reset) groups.push('SYSTEM');

  return {
    deviceType,
    modelFamily,
    groups: dedupeGroups(groups),
    channels,
    trigger,
    triggerB,
    measurements,
    bus,
    acquisition,
    horizontal,
    fastFrame,
    math,
    cursor,
    search,
    afg,
    awg,
    smu,
    rsa,
    save,
    recall,
    status,
    errorCheck,
    reset,
    idn,
    unresolved: [],
  };
}

export function detectDeviceType(
  req: Pick<McpChatRequest, 'userMessage'> & Partial<Pick<McpChatRequest, 'flowContext'>>
): DetectedDeviceType {
  if (req.flowContext?.deviceType) {
    const dt = req.flowContext.deviceType.toUpperCase();
    if (dt === 'AFG') return 'AFG';
    if (dt === 'AWG') return 'AWG';
    if (dt === 'SMU') return 'SMU';
    if (dt === 'SCOPE') return 'SCOPE';
    if (dt === 'RSA') return 'RSA';
  }

  const modelFamily = (req.flowContext?.modelFamily || '').toUpperCase();
  if (/AFG/.test(modelFamily)) return 'AFG';
  if (/AWG/.test(modelFamily)) return 'AWG';
  if (/SMU/.test(modelFamily)) return 'SMU';
  if (/RSA/.test(modelFamily)) return 'RSA';
  if (/MSO|DPO|TDS|SCOPE/.test(modelFamily)) return 'SCOPE';

  const message = req.userMessage.toLowerCase();
  if (/\bafg\b|function gen|arbitrary func/.test(message)) return 'AFG';
  if (/\bawg\b|arbitrary wave/.test(message)) return 'AWG';
  if (/\bsmu\b|source measure|keithley/.test(message)) return 'SMU';
  if (/\brsa\b|spectrum anal/.test(message)) return 'RSA';
  return 'SCOPE';
}

export function getCommandFile(deviceType: string, modelFamily: string): string {
  const normalizedModelFamily = (modelFamily || '').toUpperCase();
  switch (deviceType) {
    case 'AFG':
      return 'afg.json';
    case 'AWG':
      return 'awg.json';
    case 'SMU':
      return 'smu.json';
    case 'RSA':
      return 'rsa.json';
    case 'SCOPE':
      if (/DPO|5K|7K|70K/.test(normalizedModelFamily)) return 'MSO_DPO_5k_7k_70K.json';
      return 'mso_2_4_5_6_7.json';
    default:
      return 'mso_2_4_5_6_7.json';
  }
}

export async function planIntent(
  req: Pick<McpChatRequest, 'userMessage'> & Partial<Pick<McpChatRequest, 'flowContext'>>
): Promise<PlannerOutput> {
  const intent = await parseIntent(req);

  const index = await getCommandIndex();
  const bindings = buildBindings(intent);
  const sourceFile = getCommandFile(intent.deviceType, intent.modelFamily);
  const resolvedCommands: ResolvedCommand[] = [];

  resolvedCommands.push(
    ...(await resolveChannelCommands(index, intent.channels, bindings, intent.modelFamily, sourceFile)),
    ...(await resolveTriggerCommands(index, intent.trigger, bindings, intent.modelFamily, sourceFile)),
    ...(await resolveMeasurementCommands(index, intent.measurements, intent.modelFamily, sourceFile)),
    ...(await resolveAcquisitionCommands(index, intent.acquisition, sourceFile)),
    ...(await resolveHorizontalCommands(index, intent.fastFrame, sourceFile)),
    ...(await resolveSearchCommands(index, intent.search, sourceFile)),
    ...(await resolveBusCommands(index, intent.bus, sourceFile)),
    ...(await resolveStatusCommands(index, intent.status, sourceFile)),
    ...(await resolveErrorCheckCommands(index, intent.errorCheck, sourceFile)),
    ...(await resolveIeee488Commands(index, { idn: intent.idn }, sourceFile)),
    ...(await resolveAfgCommands(index, intent.afg, sourceFile)),
    ...(await resolveAwgCommands(index, intent.awg, sourceFile)),
    ...(await resolveSmuCommands(index, intent.smu, sourceFile)),
    ...(await resolveSaveCommands(intent.save, intent.modelFamily))
  );

  const seenResolved = new Set<string>();
  const dedupedResolved: ResolvedCommand[] = [];
  for (const command of resolvedCommands) {
    const key = `${command.commandType}|${command.concreteCommand.trim().toLowerCase()}|${String(command.saveAs || '').toLowerCase()}`;
    if (seenResolved.has(key)) continue;
    seenResolved.add(key);
    dedupedResolved.push(command);
  }

  return {
    intent,
    resolvedCommands: dedupedResolved,
    unresolved: intent.unresolved,
  };
}

export const resolveIntent = planIntent;

export async function resolveChannelCommands(
  index: CommandIndex,
  intent: ParsedChannelIntent[],
  bindings: Record<string, string>,
  modelFamily: string,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  const out: ResolvedCommand[] = [];

  for (const channelIntent of intent) {
    const channel = channelIntent.channel;
    const scaleRecord = findExactHeader(index, 'CH<x>:SCAle', sourceFile);
    if (scaleRecord && channelIntent.scaleVolts !== undefined) {
      out.push(
        materialize(
          scaleRecord,
          `${channel}:SCAle`,
          formatValue(channelIntent.scaleVolts),
          'CHANNEL_SETUP'
        )
      );
    }

    const couplingRecord = findExactHeader(index, 'CH<x>:COUPling', sourceFile);
    if (couplingRecord && channelIntent.coupling) {
      out.push(
        materialize(couplingRecord, `${channel}:COUPling`, channelIntent.coupling, 'CHANNEL_SETUP')
      );
    }

    const terminationRecord = findExactHeader(index, 'CH<x>:TERmination', sourceFile);
    if (terminationRecord && channelIntent.terminationOhms !== undefined) {
      out.push(
        materialize(
          terminationRecord,
          `${channel}:TERmination`,
          channelIntent.terminationOhms === 50 ? '50' : '1E6',
          'CHANNEL_SETUP'
        )
      );
    }

    const offsetRecord = findExactHeader(index, 'CH<x>:OFFSet', sourceFile);
    if (offsetRecord && channelIntent.offsetVolts !== undefined) {
      out.push(
        materialize(
          offsetRecord,
          `${channel}:OFFSet`,
          formatValue(channelIntent.offsetVolts),
          'CHANNEL_SETUP'
        )
      );
    } else if (channelIntent.offsetVolts !== undefined) {
      out.push({
        group: 'CHANNEL_SETUP',
        header: 'CH<x>:OFFSet',
        concreteCommand: `${channel}:OFFSet ${formatValue(channelIntent.offsetVolts)}`,
        commandType: 'set',
        verified: true,
        sourceFile,
        syntax: {
          set: 'CH<x>:OFFSet <NR3>',
          query: 'CH<x>:OFFSet?',
        },
        arguments: [
          {
            name: 'channel',
            type: 'integer',
            required: true,
            description: 'CH<x> where x is the analog channel number.',
          },
          {
            name: 'value',
            type: 'number',
            required: true,
            unit: 'V',
            description: 'Vertical offset for the specified analog channel.',
          },
        ],
        examples: [{ scpi: `${channel}:OFFSet ${formatValue(channelIntent.offsetVolts)}` }],
      });
    }

    if (channelIntent.label) {
      const labelRecord = findExactHeader(index, 'CH<x>:LABel', sourceFile);
      if (labelRecord) {
        out.push(
          materialize(
            labelRecord,
            `${channel}:LABel`,
            `"${channelIntent.label}"`,
            'CHANNEL_SETUP'
          )
        );
      }
    }
  }

  return out;
}

export async function resolveTriggerCommands(
  index: CommandIndex,
  trigger: ParsedTriggerIntent | undefined,
  bindings: Record<string, string>,
  modelFamily: string,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!trigger) {
    return [];
  }

  const out: ResolvedCommand[] = [];
  if (trigger.type) {
    const typeRecord = findExactHeader(index, 'TRIGger:A:TYPe', sourceFile);
    if (typeRecord) {
      out.push(materialize(typeRecord, 'TRIGger:A:TYPe', trigger.type, 'TRIGGER'));
    }
  }

  if (trigger.source) {
    const sourceRecord = findExactHeader(index, 'TRIGger:A:EDGE:SOUrce', sourceFile);
    if (sourceRecord) {
      out.push(materialize(sourceRecord, 'TRIGger:A:EDGE:SOUrce', trigger.source, 'TRIGGER'));
    }
  }

  if (trigger.slope) {
    const slopeRecord = findExactHeader(index, 'TRIGger:A:EDGE:SLOpe', sourceFile);
    if (slopeRecord) {
      out.push(materialize(slopeRecord, 'TRIGger:A:EDGE:SLOpe', trigger.slope, 'TRIGGER'));
    }
  }

  if (trigger.levelVolts !== undefined && trigger.source) {
    const levelRecord = findExactHeader(index, `TRIGger:A:LEVel:${trigger.source}`, sourceFile);
    if (levelRecord) {
      out.push(
        materialize(
          levelRecord,
          `TRIGger:A:LEVel:${trigger.source}`,
          formatValue(trigger.levelVolts),
          'TRIGGER'
        )
      );
    }
  }

  if (trigger.mode) {
    const modeRecord = findExactHeader(index, 'TRIGger:A:MODe', sourceFile);
    if (modeRecord) {
      out.push(materialize(modeRecord, 'TRIGger:A:MODe', trigger.mode, 'TRIGGER'));
    }
  }

  if (trigger.holdoffSeconds !== undefined) {
    const holdoffRecord = findExactHeader(index, 'TRIGger:A:HOLDoff:TIMe', sourceFile);
    if (holdoffRecord) {
      out.push(
        materialize(
          holdoffRecord,
          'TRIGger:A:HOLDoff:TIMe',
          trigger.holdoffSeconds.toExponential(),
          'TRIGGER'
        )
      );
    }
  }

  return out;
}

export async function resolveMeasurementCommands(
  index: CommandIndex,
  measurements: ParsedMeasurementIntent[],
  modelFamily: string,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  const out: ResolvedCommand[] = [];
  const isDpo = /DPO|5K|7K|70K/i.test(modelFamily);

  measurements.forEach((measurement, indexWithinMeasurement) => {
    const slot = indexWithinMeasurement + 1;

    if (isDpo) {
      const typeRecord = findExactHeader(index, 'MEASUrement:IMMed:TYPe', sourceFile);
      const sourceRecord = findExactHeader(index, 'MEASUrement:IMMed:SOUrce1', sourceFile);
      const valueRecord = findExactHeader(index, 'MEASUrement:IMMed:VALue', sourceFile);

      if (typeRecord) {
        out.push(materialize(typeRecord, 'MEASUrement:IMMed:TYPe', measurement.type, 'MEASUREMENT'));
      }
      if (sourceRecord && measurement.source1) {
        out.push(
          materialize(sourceRecord, 'MEASUrement:IMMed:SOUrce1', measurement.source1, 'MEASUREMENT')
        );
      }
      if (valueRecord) {
        out.push(
          materialize(
            valueRecord,
            'MEASUrement:IMMed:VALue?',
            undefined,
            'MEASUREMENT',
            'query',
            `meas${slot}_${measurement.type.toLowerCase()}`
          )
        );
      }
      return;
    }

    const addRecord = findExactHeader(index, 'MEASUrement:ADDMEAS', sourceFile);
    const sourceRecord =
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce1`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce${slot}`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOUrce<x>`, sourceFile) ??
      findExactHeader(index, `MEASUrement:MEAS${slot}:SOURCE`, sourceFile);
    const resultRecord = findExactHeader(
      index,
      `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN`,
      sourceFile
    );

    if (addRecord) {
      out.push(materialize(addRecord, 'MEASUrement:ADDMEAS', measurement.type, 'MEASUREMENT'));
    }
    if (sourceRecord && measurement.source1) {
      out.push(
        materialize(
          sourceRecord,
          `MEASUrement:MEAS${slot}:SOUrce1`,
          measurement.source1,
          'MEASUREMENT'
        )
      );
    }
    if (resultRecord) {
      out.push(
        materialize(
          resultRecord,
          `MEASUrement:MEAS${slot}:RESUlts:CURRentacq:MEAN?`,
          undefined,
          'MEASUREMENT',
          'query',
          `meas${slot}_${measurement.type.toLowerCase()}`
        )
      );
    }
  });

  return out;
}

export async function resolveAcquisitionCommands(
  index: CommandIndex,
  acquisition: ParsedAcquisitionIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!acquisition) return [];

  const out: ResolvedCommand[] = [];

  if (acquisition.stopAfter) {
    const stopAfterRecord = findExactHeader(index, 'ACQuire:STOPAfter', sourceFile);
    if (stopAfterRecord) {
      out.push(materialize(stopAfterRecord, 'ACQuire:STOPAfter', acquisition.stopAfter, 'ACQUISITION'));
      const stateRecord = findExactHeader(index, 'ACQuire:STATE', sourceFile);
      if (stateRecord) {
        out.push(materialize(stateRecord, 'ACQuire:STATE', 'RUN', 'ACQUISITION'));
      }
    }
  }

  if (acquisition.mode) {
    const modeRecord = findExactHeader(index, 'ACQuire:MODe', sourceFile);
    if (modeRecord) {
      out.push(materialize(modeRecord, 'ACQuire:MODe', acquisition.mode, 'ACQUISITION'));
    }
  }

  if (acquisition.numAvg !== undefined) {
    const numAvgRecord = findExactHeader(index, 'ACQuire:NUMAVg', sourceFile);
    if (numAvgRecord) {
      out.push(materialize(numAvgRecord, 'ACQuire:NUMAVg', String(acquisition.numAvg), 'ACQUISITION'));
    }
  }

  if (acquisition.recordLength !== undefined) {
    const recordLengthRecord = findExactHeader(index, 'HORizontal:RECOrdlength', sourceFile);
    if (recordLengthRecord) {
      out.push(
        materialize(
          recordLengthRecord,
          'HORizontal:RECOrdlength',
          String(acquisition.recordLength),
          'ACQUISITION'
        )
      );
    }
  }

  if (acquisition.horizontalScaleSeconds !== undefined) {
    const scaleRecord = findExactHeader(index, 'HORizontal:SCAle', sourceFile);
    if (scaleRecord) {
      out.push(
        materialize(
          scaleRecord,
          'HORizontal:SCAle',
          acquisition.horizontalScaleSeconds.toExponential(),
          'ACQUISITION'
        )
      );
    }
  }

  return out;
}

export async function resolveHorizontalCommands(
  index: CommandIndex,
  fastFrame: ParsedFastFrameIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!fastFrame) return [];

  const out: ResolvedCommand[] = [];
  const stateRecord = findExactHeader(index, 'HORizontal:FASTframe:STATE', sourceFile);
  if (stateRecord) {
    out.push(materialize(stateRecord, 'HORizontal:FASTframe:STATE', 'ON', 'FASTFRAME'));
  }

  if (fastFrame.count !== undefined) {
    const countRecord = findExactHeader(index, 'HORizontal:FASTframe:COUNt', sourceFile);
    if (countRecord) {
      out.push(
        materialize(countRecord, 'HORizontal:FASTframe:COUNt', String(fastFrame.count), 'FASTFRAME')
      );
    }
  }

  return out;
}

export async function resolveBusCommands(
  index: CommandIndex,
  bus: ParsedBusIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!bus || !bus.bus) return [];
  if (!hasBusDecodeDetails(bus)) return [];

  const out: ResolvedCommand[] = [];
  const displayStateRecord = findExactHeader(index, 'DISplay:WAVEView<x>:BUS:B<x>:STATE', sourceFile);
  const pushBusDisplayState = () => {
    if (displayStateRecord) {
      out.push(
        materialize(
          displayStateRecord,
          `DISplay:WAVEView1:BUS:${bus.bus}:STATE`,
          'ON',
          'BUS_DECODE'
        )
      );
    }
  };

  const typeRecord = findExactHeader(index, 'BUS:B<x>:TYPe', sourceFile);

  if (bus.protocol === 'I2C') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'I2C', 'BUS_DECODE'));
    if (bus.source1) {
      const clockSourceRecord = findExactHeader(index, 'BUS:B<x>:I2C:CLOCk:SOUrce', sourceFile);
      if (clockSourceRecord) {
        out.push(materialize(clockSourceRecord, `BUS:${bus.bus}:I2C:CLOCk:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.clockThresholdVolts !== undefined) {
      const clockThresholdRecord = findExactHeader(index, 'BUS:B<x>:I2C:CLOCk:THReshold', sourceFile);
      if (clockThresholdRecord) {
        out.push(
          materialize(
            clockThresholdRecord,
            `BUS:${bus.bus}:I2C:CLOCk:THReshold`,
            formatValue(bus.clockThresholdVolts),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.source2) {
      const dataSourceRecord = findExactHeader(index, 'BUS:B<x>:I2C:DATa:SOUrce', sourceFile);
      if (dataSourceRecord) {
        out.push(materialize(dataSourceRecord, `BUS:${bus.bus}:I2C:DATa:SOUrce`, bus.source2, 'BUS_DECODE'));
      }
    }
    if (bus.dataThresholdVolts !== undefined) {
      const dataThresholdRecord = findExactHeader(index, 'BUS:B<x>:I2C:DATa:THReshold', sourceFile);
      if (dataThresholdRecord) {
        out.push(
          materialize(
            dataThresholdRecord,
            `BUS:${bus.bus}:I2C:DATa:THReshold`,
            formatValue(bus.dataThresholdVolts),
            'BUS_DECODE'
          )
        );
      }
    }
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'CAN' || bus.protocol === 'CANFD') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'CAN', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:CAN:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:CAN:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.bitrateBps !== undefined) {
      const bitrateModeRecord = findExactHeader(index, 'BUS:B<x>:CAN:BITRate', sourceFile);
      if (bitrateModeRecord) {
        out.push(materialize(bitrateModeRecord, `BUS:${bus.bus}:CAN:BITRate`, 'CUSTom', 'BUS_DECODE'));
      }
      const bitrateValueRecord = findExactHeader(index, 'BUS:B<x>:CAN:BITRate:VALue', sourceFile);
      if (bitrateValueRecord) {
        out.push(
          materialize(
            bitrateValueRecord,
            `BUS:${bus.bus}:CAN:BITRate:VALue`,
            String(bus.bitrateBps),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.protocol === 'CANFD' || bus.standard) {
      const standardRecord = findExactHeader(index, 'BUS:B<x>:CAN:STANDard', sourceFile);
      if (standardRecord) {
        out.push(
          materialize(
            standardRecord,
            `BUS:${bus.bus}:CAN:STANDard`,
            bus.standard ?? 'FDISO',
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.dataPhaseBitrateBps !== undefined) {
      const dataRateRecord = findExactHeader(index, 'BUS:B<x>:CAN:FD:BITRate:CUSTom', sourceFile);
      if (dataRateRecord) {
        out.push(
          materialize(
            dataRateRecord,
            `BUS:${bus.bus}:CAN:FD:BITRate:CUSTom`,
            String(bus.dataPhaseBitrateBps),
            'BUS_DECODE'
          )
        );
      }
    }
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'SPI') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'SPI', 'BUS_DECODE'));
    if (bus.source1) {
      const clockSourceRecord = findExactHeader(index, 'BUS:B<x>:SPI:CLOCk:SOUrce', sourceFile);
      if (clockSourceRecord) {
        out.push(materialize(clockSourceRecord, `BUS:${bus.bus}:SPI:CLOCk:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.slope) {
      const polarityRecord = findExactHeader(index, 'BUS:B<x>:SPI:CLOCk:POLarity', sourceFile);
      if (polarityRecord) {
        out.push(
          materialize(
            polarityRecord,
            `BUS:${bus.bus}:SPI:CLOCk:POLarity`,
            bus.slope === 'RISe' ? 'LOW' : 'HIGH',
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.source2) {
      const dataSourceRecord = findExactHeader(index, 'BUS:B<x>:SPI:DATa:SOUrce', sourceFile);
      if (dataSourceRecord) {
        out.push(materialize(dataSourceRecord, `BUS:${bus.bus}:SPI:DATa:SOUrce`, bus.source2, 'BUS_DECODE'));
      }
    }
    if (bus.chipSelect) {
      const selectSourceRecord = findExactHeader(index, 'BUS:B<x>:SPI:SELect:SOUrce', sourceFile);
      if (selectSourceRecord) {
        out.push(
          materialize(selectSourceRecord, `BUS:${bus.bus}:SPI:SELect:SOUrce`, bus.chipSelect, 'BUS_DECODE')
        );
      }
    }
    if (bus.selectPolarity) {
      const selectPolarityRecord = findExactHeader(index, 'BUS:B<x>:SPI:SELect:POLarity', sourceFile);
      if (selectPolarityRecord) {
        out.push(
          materialize(
            selectPolarityRecord,
            `BUS:${bus.bus}:SPI:SELect:POLarity`,
            bus.selectPolarity,
            'BUS_DECODE'
          )
        );
      }
    }
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'UART' || bus.protocol === 'RS232' || bus.protocol === 'RS232C') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'RS232C', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:RS232C:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:RS232C:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.baudRate !== undefined) {
      const bitRateModeRecord = findExactHeader(index, 'BUS:B<x>:RS232C:BITRate', sourceFile);
      if (bitRateModeRecord) {
        out.push(materialize(bitRateModeRecord, `BUS:${bus.bus}:RS232C:BITRate`, 'CUSTOM', 'BUS_DECODE'));
      }
      const bitRateCustomRecord = findExactHeader(index, 'BUS:B<x>:RS232C:BITRate:CUSTom', sourceFile);
      if (bitRateCustomRecord) {
        out.push(
          materialize(
            bitRateCustomRecord,
            `BUS:${bus.bus}:RS232C:BITRate:CUSTom`,
            String(bus.baudRate),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.dataBits !== undefined) {
      const dataBitsRecord = findExactHeader(index, 'BUS:B<x>:RS232C:DATABits', sourceFile);
      if (dataBitsRecord) {
        out.push(
          materialize(dataBitsRecord, `BUS:${bus.bus}:RS232C:DATABits`, String(bus.dataBits), 'BUS_DECODE')
        );
      }
    }
    if (bus.parity) {
      const parityRecord = findExactHeader(index, 'BUS:B<x>:RS232C:PARity', sourceFile);
      if (parityRecord) {
        out.push(materialize(parityRecord, `BUS:${bus.bus}:RS232C:PARity`, bus.parity, 'BUS_DECODE'));
      }
    }
    pushBusDisplayState();
    return out;
  }

  if (bus.protocol === 'LIN') {
    if (typeRecord) out.push(materialize(typeRecord, `BUS:${bus.bus}:TYPe`, 'LIN', 'BUS_DECODE'));
    if (bus.source1) {
      const sourceRecord = findExactHeader(index, 'BUS:B<x>:LIN:SOUrce', sourceFile);
      if (sourceRecord) {
        out.push(materialize(sourceRecord, `BUS:${bus.bus}:LIN:SOUrce`, bus.source1, 'BUS_DECODE'));
      }
    }
    if (bus.baudRate !== undefined || bus.bitrateBps !== undefined) {
      const rateRecord = findExactHeader(index, 'BUS:B<x>:LIN:BITRate:CUSTom', sourceFile);
      if (rateRecord) {
        out.push(
          materialize(
            rateRecord,
            `BUS:${bus.bus}:LIN:BITRate:CUSTom`,
            String(bus.baudRate ?? bus.bitrateBps),
            'BUS_DECODE'
          )
        );
      }
    }
    if (bus.standard) {
      const standardRecord = findExactHeader(index, 'BUS:B<x>:LIN:STANdard', sourceFile);
      if (standardRecord) {
        out.push(materialize(standardRecord, `BUS:${bus.bus}:LIN:STANdard`, bus.standard, 'BUS_DECODE'));
      }
    }
    pushBusDisplayState();
  }

  return out;
}

export async function resolveSearchCommands(
  index: CommandIndex,
  search: ParsedSearchIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!search || search.type !== 'BUS' || !search.protocol) return [];

  const out: ResolvedCommand[] = [];
  const selectedRecord = findExactHeader(index, 'SEARCH:SELected', sourceFile);
  if (selectedRecord) {
    out.push(materialize(selectedRecord, 'SEARCH:SELected', 'SEARCH1', 'SEARCH'));
  }

  const typeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:TYPe', sourceFile);
  if (typeRecord) {
    out.push(materialize(typeRecord, 'SEARCH:SEARCH1:TRIGger:A:TYPe', 'BUS', 'SEARCH'));
  }

  const busSourceRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:SOUrce', sourceFile);
  if (busSourceRecord) {
    out.push(
      materialize(
        busSourceRecord,
        'SEARCH:SEARCH1:TRIGger:A:BUS:SOUrce',
        search.bus || 'B1',
        'SEARCH'
      )
    );
  }

  if (search.protocol === 'CAN' || search.protocol === 'CANFD') {
    const conditionRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:CONDition', sourceFile);
    if (conditionRecord && search.condition) {
      out.push(
        materialize(
          conditionRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition',
          search.condition,
          'SEARCH'
        )
      );
    }

    const frameTypeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:FRAMEtype', sourceFile);
    if (frameTypeRecord && search.frameType) {
      out.push(
        materialize(
          frameTypeRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype',
          search.frameType,
          'SEARCH'
        )
      );
    }

    const errTypeRecord = findExactHeader(index, 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:ERRType', sourceFile);
    if (errTypeRecord && search.errType) {
      out.push(
        materialize(
          errTypeRecord,
          'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:ERRType',
          search.errType,
          'SEARCH'
        )
      );
    }
  }

  return out;
}

export async function resolveSaveCommands(
  save: ParsedSaveIntent | undefined,
  modelFamily: string
): Promise<ResolvedCommand[]> {
  if (!save) return [];

  const out: ResolvedCommand[] = [];
  const isDpo = /DPO|5K|7K|70K/i.test(modelFamily);

  if (save.screenshot) {
    out.push({
      group: 'SAVE',
      header: 'STEP:save_screenshot',
      concreteCommand: 'save_screenshot',
      commandType: 'set',
      stepType: 'save_screenshot',
      stepParams: {
        filename: 'screenshot.png',
        scopeType: isDpo ? 'legacy' : 'modern',
        method: 'pc_transfer',
      },
      verified: true,
      sourceFile: 'tekautomate',
      syntax: {},
      arguments: [],
      examples: [],
    });
  }

  for (const source of save.waveformSources || []) {
    out.push({
      group: 'SAVE',
      header: 'STEP:save_waveform',
      concreteCommand: `save_waveform ${source}`,
      commandType: 'set',
      stepType: 'save_waveform',
      stepParams: {
        source,
        filename: `${source.toLowerCase()}_data.${save.format || 'bin'}`,
        format: save.format || 'bin',
      },
      verified: true,
      sourceFile: 'tekautomate',
      syntax: {},
      arguments: [],
      examples: [],
    });
  }

  return out;
}

export async function resolveStatusCommands(
  index: CommandIndex,
  status: ParsedStatusIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!status) return [];
  const out: ResolvedCommand[] = [];

  if (status.esr) {
    const esrRecord = findExactHeader(index, '*ESR?', sourceFile);
    if (esrRecord) {
      out.push(materialize(esrRecord, '*ESR?', undefined, 'STATUS', 'query', 'status_esr'));
    } else {
      out.push(buildSyntheticQuery('*ESR?', 'STATUS', 'status_esr'));
    }
  }

  if (status.opc) {
    const opcRecord = findExactHeader(index, '*OPC?', sourceFile);
    if (opcRecord) {
      out.push(materialize(opcRecord, '*OPC?', undefined, 'STATUS', 'query', 'status_opc'));
    } else {
      out.push(buildSyntheticQuery('*OPC?', 'STATUS', 'status_opc'));
    }
  }

  return out;
}

export async function resolveErrorCheckCommands(
  index: CommandIndex,
  errorCheck: boolean | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!errorCheck) return [];
  const esrRecord = findExactHeader(index, '*ESR?', sourceFile);
  if (esrRecord) {
    return [materialize(esrRecord, '*ESR?', undefined, 'ERROR_CHECK', 'query', 'error_status')];
  }
  return [buildSyntheticQuery('*ESR?', 'ERROR_CHECK', 'error_status')];
}

export async function resolveIeee488Commands(
  index: CommandIndex,
  ieee: { idn?: boolean } | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!ieee?.idn) return [];
  const idnRecord = findExactHeader(index, '*IDN?', sourceFile);
  if (idnRecord) {
    return [materialize(idnRecord, '*IDN?', undefined, 'IEEE488', 'query', 'idn')];
  }
  return [buildSyntheticQuery('*IDN?', 'IEEE488', 'idn')];
}

export async function resolveAfgCommands(
  index: CommandIndex,
  afg: ParsedAfgIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!afg) return [];

  const out: ResolvedCommand[] = [];
  const channel = String(afg.channel);

  if (afg.function) {
    const functionRecord = findExactHeader(index, `SOURce${channel}:FUNCtion`, sourceFile);
    if (functionRecord) {
      out.push(materialize(functionRecord, `SOURce${channel}:FUNCtion`, afg.function, 'AFG_SOURCE'));
    }
  }
  if (afg.frequencyHz !== undefined) {
    const frequencyRecord = findExactHeader(index, `SOURce${channel}:FREQuency:FIXed`, sourceFile);
    if (frequencyRecord) {
      out.push(
        materialize(
          frequencyRecord,
          `SOURce${channel}:FREQuency:FIXed`,
          String(afg.frequencyHz),
          'AFG_SOURCE'
        )
      );
    }
  }
  if (afg.amplitudeVpp !== undefined) {
    const amplitudeRecord = findExactHeader(
      index,
      `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
      sourceFile
    );
    if (amplitudeRecord) {
      out.push(
        materialize(
          amplitudeRecord,
          `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
          String(afg.amplitudeVpp),
          'AFG_SOURCE'
        )
      );
    }
  }
  if (afg.offsetVolts !== undefined) {
    const offsetRecord = findExactHeader(
      index,
      `SOURce${channel}:VOLTage:LEVel:IMMediate:OFFSet`,
      sourceFile
    );
    if (offsetRecord) {
      out.push(
        materialize(
          offsetRecord,
          `SOURce${channel}:VOLTage:LEVel:IMMediate:OFFSet`,
          String(afg.offsetVolts),
          'AFG_SOURCE'
        )
      );
    }
  }
  if (afg.dutyCyclePct !== undefined) {
    const dutyRecord = findExactHeader(index, `SOURce${channel}:PULSe:DCYCle`, sourceFile);
    if (dutyRecord) {
      out.push(
        materialize(dutyRecord, `SOURce${channel}:PULSe:DCYCle`, String(afg.dutyCyclePct), 'AFG_SOURCE')
      );
    }
  }
  if (afg.impedance) {
    const impedanceRecord = findExactHeader(index, `OUTPut${channel}:IMPedance`, sourceFile);
    if (impedanceRecord) {
      out.push(
        materialize(
          impedanceRecord,
          `OUTPut${channel}:IMPedance`,
          afg.impedance === 'HIGHZ' ? 'INF' : '50',
          'AFG_OUTPUT'
        )
      );
    }
  }
  if (afg.outputOn !== undefined) {
    const outputRecord = findExactHeader(index, `OUTPut${channel}:STATe`, sourceFile);
    if (outputRecord) {
      out.push(
        materialize(outputRecord, `OUTPut${channel}:STATe`, afg.outputOn ? 'ON' : 'OFF', 'AFG_OUTPUT')
      );
    }
  }
  if (afg.burstCycles !== undefined) {
    const cyclesRecord = findExactHeader(index, `SOURce${channel}:BURSt:NCYCles`, sourceFile);
    if (cyclesRecord) {
      out.push(
        materialize(
          cyclesRecord,
          `SOURce${channel}:BURSt:NCYCles`,
          String(afg.burstCycles),
          'AFG_BURST'
        )
      );
    }
  }

  return out;
}

export async function resolveAwgCommands(
  index: CommandIndex,
  awg: ParsedAwgIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!awg) return [];

  const out: ResolvedCommand[] = [];
  const channel = String(awg.channel);

  if (awg.waveformName) {
    const waveformRecord = findExactHeader(index, `SOURce${channel}:WAVeform`, sourceFile);
    if (waveformRecord) {
      out.push(materialize(waveformRecord, `SOURce${channel}:WAVeform`, `"${awg.waveformName}"`, 'AWG_WAVEFORM'));
    }
  }
  if (awg.amplitudeVpp !== undefined) {
    const amplitudeRecord = findExactHeader(
      index,
      `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
      sourceFile
    );
    if (amplitudeRecord) {
      out.push(
        materialize(
          amplitudeRecord,
          `SOURce${channel}:VOLTage:LEVel:IMMediate:AMPLitude`,
          String(awg.amplitudeVpp),
          'AWG_WAVEFORM'
        )
      );
    }
  }
  if (awg.outputOn !== undefined) {
    const outputRecord = findExactHeader(index, `OUTPut${channel}:STATe`, sourceFile);
    if (outputRecord) {
      out.push(
        materialize(outputRecord, `OUTPut${channel}:STATe`, awg.outputOn ? 'ON' : 'OFF', 'AWG_OUTPUT')
      );
    }
  }
  if (awg.runMode) {
    const runModeRecord = findExactHeader(index, 'AWGControl:RMODe', sourceFile);
    if (runModeRecord) {
      out.push(materialize(runModeRecord, 'AWGControl:RMODe', awg.runMode, 'AWG_SEQUENCE'));
    }
  }

  return out;
}

export async function resolveSmuCommands(
  index: CommandIndex,
  smu: ParsedSmuIntent | undefined,
  sourceFile: string
): Promise<ResolvedCommand[]> {
  if (!smu) return [];

  const out: ResolvedCommand[] = [];

  if (smu.sourceFunction) {
    const functionRecord = findExactHeader(index, ':SOURce:FUNCtion', sourceFile);
    if (functionRecord) {
      out.push(materialize(functionRecord, ':SOURce:FUNCtion', smu.sourceFunction, 'SMU_SOURCE'));
    }
  }
  if (smu.sourceLevel !== undefined) {
    const levelHeader =
      smu.sourceFunction === 'CURRent' ? ':SOURce:CURRent:LEVel' : ':SOURce:VOLTage:LEVel';
    const levelRecord = findExactHeader(index, levelHeader, sourceFile);
    if (levelRecord) {
      out.push(materialize(levelRecord, levelHeader, String(smu.sourceLevel), 'SMU_SOURCE'));
    }
  }
  if (smu.complianceLevel !== undefined) {
    const complianceHeader =
      smu.sourceFunction === 'CURRent'
        ? ':SENSe:VOLTage:PROTection'
        : ':SENSe:CURRent:PROTection';
    const complianceRecord = findExactHeader(index, complianceHeader, sourceFile);
    if (complianceRecord) {
      out.push(
        materialize(complianceRecord, complianceHeader, String(smu.complianceLevel), 'SMU_SOURCE')
      );
    }
  }
  if (smu.outputOn !== undefined) {
    const outputRecord = findExactHeader(index, ':OUTPut:STATe', sourceFile);
    if (outputRecord) {
      out.push(materialize(outputRecord, ':OUTPut:STATe', smu.outputOn ? 'ON' : 'OFF', 'SMU_OUTPUT'));
    }
  }
  if (smu.measureFunction) {
    const senseRecord = findExactHeader(index, ':SENSe:FUNCtion', sourceFile);
    if (senseRecord) {
      out.push(
        materialize(senseRecord, ':SENSe:FUNCtion', `"${smu.measureFunction}"`, 'SMU_MEASURE')
      );
    }
  }
  if (smu.sweepStart !== undefined) {
    const startRecord = findExactHeader(index, ':SOURce:VOLTage:STARt', sourceFile);
    if (startRecord) {
      out.push(materialize(startRecord, ':SOURce:VOLTage:STARt', String(smu.sweepStart), 'SMU_SWEEP'));
    }
  }
  if (smu.sweepStop !== undefined) {
    const stopRecord = findExactHeader(index, ':SOURce:VOLTage:STOP', sourceFile);
    if (stopRecord) {
      out.push(materialize(stopRecord, ':SOURce:VOLTage:STOP', String(smu.sweepStop), 'SMU_SWEEP'));
    }
  }

  return out;
}

export function parseChannelIntent(message: string): ParsedChannelIntent[] {
  const channels = new Map<string, ParsedChannelIntent>();
  const clauses = extractChannelClauses(message);

  for (const clause of clauses) {
    if (!CHANNEL_REGEX.test(clause)) continue;
    CHANNEL_REGEX.lastIndex = 0;

    const clauseChannels = Array.from(clause.matchAll(CHANNEL_REGEX)).map((match) =>
      match[1].toUpperCase()
    );
    const scaleVolts = parseLastVoltageInVolts(clause);
    const offsetVolts = parseOffsetInVolts(clause);
    const couplingMatch = clause.match(COUPLING_REGEX);
    const terminationMatch = clause.match(TERMINATION_REGEX);

    for (const channel of clauseChannels) {
      const existing = channels.get(channel) ?? { channel };
      if (scaleVolts !== undefined && existing.scaleVolts === undefined) existing.scaleVolts = scaleVolts;
      if (offsetVolts !== undefined && existing.offsetVolts === undefined) existing.offsetVolts = offsetVolts;
      if (couplingMatch && existing.coupling === undefined) {
        existing.coupling = couplingMatch[0].toUpperCase() as ParsedChannelIntent['coupling'];
      }
      if (terminationMatch && existing.terminationOhms === undefined) {
        existing.terminationOhms = parseTerminationOhms(terminationMatch[0]);
      }
      channels.set(channel, existing);
    }
  }

  return Array.from(channels.values()).sort((left, right) =>
    left.channel.localeCompare(right.channel)
  );
}

export function parseTriggerIntent(
  message: string,
  aliasMaps: IntentAliasMaps
): ParsedTriggerIntent | undefined {
  const clause = findTriggerClause(message, false);
  return clause ? parseTriggerClause(clause, aliasMaps) : undefined;
}

export function parseSecondaryTriggerIntent(
  message: string,
  aliasMaps: IntentAliasMaps
): ParsedTriggerIntent | undefined {
  const clause = findTriggerClause(message, true);
  return clause ? parseTriggerClause(clause, aliasMaps) : undefined;
}

export function parseMeasurementIntent(
  message: string,
  context: ParseContext,
  aliasMaps: IntentAliasMaps
): ParsedMeasurementIntent[] {
  const clauses = extractMeasurementClauses(message);
  const measurements: ParsedMeasurementIntent[] = [];
  const seen = new Set<string>();
  const defaultSource = context.channels[0]?.channel;

  for (const clause of clauses) {
    const matchedMeasurementTypes = matchAliasValues(clause, aliasMaps.measurementAliases);
    if (!isMeasurementClause(clause) && matchedMeasurementTypes.length === 0) continue;
    const clauseSource = parseMeasurementSource(clause) ?? defaultSource;

    for (const measurementType of matchedMeasurementTypes) {
      const key = `${measurementType}:${clauseSource ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      measurements.push({
        type: measurementType as ParsedMeasurementIntent['type'],
        source1: clauseSource,
      });
    }
  }

  return measurements;
}

export function parseBusIntent(message: string, aliasMaps: IntentAliasMaps): ParsedBusIntent | undefined {
  const protocol = matchFirstAliasValue(message, aliasMaps.busProtocolAliases);
  if (!protocol) return undefined;

  const bus: ParsedBusIntent = {
    protocol: protocol as ParsedBusIntent['protocol'],
  };

  const busSlotMatch = message.match(BUS_SLOT_REGEX);
  if (busSlotMatch) bus.bus = busSlotMatch[1].toUpperCase();

  const clockMatch = message.match(/\bclock\s+(CH[1-4])\b/i);
  if (clockMatch) {
    bus.clockSource = clockMatch[1].toUpperCase();
    bus.source1 = bus.clockSource;
  }

  const dataMatch = message.match(/\bdata\s+(CH[1-4])\b/i);
  if (dataMatch) {
    bus.dataSource = dataMatch[1].toUpperCase();
    bus.source2 = bus.dataSource;
  }

  if (!bus.source1) {
    const genericSourceMatches = Array.from(message.matchAll(CHANNEL_REGEX)).map((match) =>
      match[1].toUpperCase()
    );
    if (genericSourceMatches.length > 0) {
      bus.source1 = genericSourceMatches[0];
      bus.source2 = genericSourceMatches[1];
    }
  }

  const bitrateMatch = message.match(BITRATE_REGEX);
  if (bitrateMatch) bus.bitrateBps = toBitrate(bitrateMatch[1], bitrateMatch[2]);

  const dataPhaseMatch = message.match(/data\s+phase\s+(\d+(?:\.\d+)?)\s*(kbps|mbps)\b/i);
  if (dataPhaseMatch) {
    bus.dataPhaseBitrateBps = toBitrate(dataPhaseMatch[1], dataPhaseMatch[2]);
  }

  if (/\bcan\s*fd\b/i.test(message)) {
    bus.standard = /\biso\s+standard\b|\biso\b/i.test(message) ? 'FDISO' : 'FDNONISO';
  } else if (/\biso\s+standard\b|\biso\b/i.test(message)) {
    bus.standard = 'ISO';
  }

  const thresholdMatches = Array.from(message.matchAll(/(\d+(?:\.\d+)?)\s*(mV|V)\b/gi)).map(
    (match) => toVolts(match[1], match[2])
  );
  if (bus.protocol === 'I2C') {
    if (thresholdMatches.length >= 1) bus.clockThresholdVolts = thresholdMatches[0];
    if (thresholdMatches.length >= 2) bus.dataThresholdVolts = thresholdMatches[1];
  } else if (thresholdMatches.length >= 1) {
    bus.thresholdVolts = thresholdMatches[0];
  }

  const chipSelectMatch = message.match(/\b(cs|chip\s*select)\s+(CH[1-4])\b/i);
  if (chipSelectMatch) {
    bus.chipSelect = chipSelectMatch[2].toUpperCase();
  }
  if (/\bactive\s+high\b|\bselect\s+high\b/i.test(message)) {
    bus.selectPolarity = 'HIGH';
  } else if (/\bactive\s+low\b|\bselect\s+low\b/i.test(message)) {
    bus.selectPolarity = 'LOW';
  }

  const baudMatch = message.match(/(\d+(?:\.\d+)?)\s*(baud|kbps|mbps)\b/i);
  if (baudMatch && /uart|rs232/i.test(message)) {
    bus.baudRate = /baud/i.test(baudMatch[2])
      ? Number(baudMatch[1])
      : toBitrate(baudMatch[1], baudMatch[2]);
  }

  const dataBitsMatch = message.match(/\b([789])\s*data\s*bits?\b/i);
  if (dataBitsMatch) {
    bus.dataBits = Number(dataBitsMatch[1]);
  }
  if (/\beven\s+parity\b|\bparity\s+even\b/i.test(message)) bus.parity = 'EVEN';
  else if (/\bodd\s+parity\b|\bparity\s+odd\b/i.test(message)) bus.parity = 'ODD';
  else if (/\bno\s+parity\b|\bparity\s+none\b/i.test(message)) bus.parity = 'NONe';

  if (/\brising\b|\brise\b/i.test(message)) bus.slope = 'RISe';
  else if (/\bfalling\b|\bfall\b/i.test(message)) bus.slope = 'FALL';

  return bus;
}

export function parseAcquisitionIntent(
  message: string,
  aliasMaps: IntentAliasMaps
): ParsedAcquisitionIntent | undefined {
  const acquisition: ParsedAcquisitionIntent = {};
  const mode = matchFirstAliasValue(message, aliasMaps.acquisitionModeAliases);
  if (mode) acquisition.mode = mode as ParsedAcquisitionIntent['mode'];

  const numAvgMatch = message.match(ACQ_NUMAVG_REGEX);
  if (numAvgMatch) acquisition.numAvg = Number(numAvgMatch[1] ?? numAvgMatch[2]);

  if (ACQ_STOP_AFTER_REGEX.test(message)) acquisition.stopAfter = 'SEQuence';

  const recordLengthMatch = message.match(RECORD_LENGTH_REGEX);
  if (recordLengthMatch) {
    acquisition.recordLength = parseScaledInteger(recordLengthMatch[1] ?? recordLengthMatch[2]);
  }

  const horizontalScaleMatch = message.match(HORIZONTAL_SCALE_REGEX);
  if (horizontalScaleMatch) {
    acquisition.horizontalScaleSeconds = toSeconds(horizontalScaleMatch[1], horizontalScaleMatch[2]);
  }

  const fastFrameMatch = message.match(FASTFRAME_REGEX);
  if (fastFrameMatch) acquisition.fastFrameCount = Number(fastFrameMatch[1] ?? fastFrameMatch[2]);

  return Object.keys(acquisition).length > 0 ? acquisition : undefined;
}

export function parseHorizontalIntent(message: string): ParsedHorizontalIntent | undefined {
  const horizontal: ParsedHorizontalIntent = {};
  const scaleMatch = message.match(HORIZONTAL_SCALE_REGEX);
  if (scaleMatch) horizontal.scaleSeconds = toSeconds(scaleMatch[1], scaleMatch[2]);
  const positionMatch = message.match(HORIZONTAL_POSITION_REGEX);
  if (positionMatch) horizontal.positionSeconds = toSeconds(positionMatch[1], positionMatch[2]);
  const recordLengthMatch = message.match(RECORD_LENGTH_REGEX);
  if (recordLengthMatch) {
    horizontal.recordLength = parseScaledInteger(recordLengthMatch[1] ?? recordLengthMatch[2]);
  }
  return Object.keys(horizontal).length > 0 ? horizontal : undefined;
}

export function parseFastFrameIntent(message: string): ParsedFastFrameIntent | undefined {
  const match = message.match(FASTFRAME_REGEX);
  if (!match) return undefined;
  return {
    count: Number(match[1] ?? match[2]),
    state: true,
  };
}

export function parseMathIntent(message: string): ParsedMathIntent | undefined {
  if (!/\bmath\b|\bfft\b|\bmath\s+(add|subtract|multiply|divide)\b/i.test(message)) {
    return undefined;
  }

  const sources = Array.from(message.matchAll(CHANNEL_REGEX)).map((match) => match[1].toUpperCase());
  let operation: ParsedMathIntent['operation'] = 'UNKNOWN';
  if (/\bfft\b/i.test(message)) operation = 'FFT';
  else if (/\bmath\s+subtract\b/i.test(message)) operation = 'SUBTRACT';
  else if (/\bmath\s+multiply\b/i.test(message)) operation = 'MULTIPLY';
  else if (/\bmath\s+divide\b/i.test(message)) operation = 'DIVIDE';
  else if (/\bmath\s+add\b/i.test(message)) operation = 'ADD';

  return {
    operation,
    sources: sources.length > 0 ? Array.from(new Set(sources)) : undefined,
  };
}

export function parseCursorIntent(message: string): ParsedCursorIntent | undefined {
  if (!/\bcursor\b/i.test(message)) return undefined;

  const cursor: ParsedCursorIntent = {};
  if (/\bvertical cursor\b/i.test(message)) cursor.type = 'VERTical';
  else if (/\bhorizontal cursor\b/i.test(message)) cursor.type = 'HORizontal';
  else cursor.type = 'WAVEform';

  const sourceMatch = message.match(/\bon\s+(CH[1-4])\b/i);
  if (sourceMatch) cursor.source = sourceMatch[1].toUpperCase();

  return cursor;
}

export function parseSearchIntent(
  message: string,
  bus?: ParsedBusIntent
): ParsedSearchIntent | undefined {
  const isSearch =
    /\bsearch\b|\bfind\b|\bmark\b|\btrigger\s+on\s+bus\b|\bbus\s+event\b|\berror\s+frames?\b/i.test(message);
  if (!isSearch) return undefined;

  let type: ParsedSearchIntent['type'] = 'UNKNOWN';
  if (/\bsetup\s*time|\bhold\s*time/i.test(message)) type = 'SETUPHOLD';
  else if (/\bedge\b/i.test(message)) type = 'EDGE';
  else if (/\bpulse\b/i.test(message)) type = 'PULSE';
  else if (/\btransition\b/i.test(message)) type = 'TRANSITION';
  else if (/\bwindow\b/i.test(message)) type = 'WINDOW';
  else if (bus) type = 'BUS';

  let searchType: ParsedSearchIntent['searchType'] = 'ANYFIELD';
  if (/\berror\s+frames?\b/i.test(message)) searchType = 'ERRFRAME';
  else if (/\baddress\b/i.test(message)) searchType = 'ADDRESS';
  else if (/\bdata\b/i.test(message)) searchType = 'DATA';

  const protocol = bus?.protocol;
  const busMatch = message.match(BUS_SLOT_REGEX);

  let condition: string | undefined;
  let frameType: string | undefined;
  let errType: string | undefined;
  if (protocol === 'CAN' || protocol === 'CANFD') {
    if (searchType === 'ERRFRAME') {
      condition = 'FRAMEtype';
      frameType = 'ERRor';
    } else if (searchType === 'DATA') {
      condition = 'DATa';
    } else if (searchType === 'ADDRESS') {
      condition = 'IDentifier';
    }
    if (/\bany\s+error\b|\berror\s+frame\b/i.test(message)) {
      errType = 'ANYERRor';
    }
  }

  return {
    type,
    bus: busMatch?.[1]?.toUpperCase() || bus?.bus || 'B1',
    protocol,
    searchType,
    condition,
    frameType,
    errType,
  };
}

export function parseAfgIntent(message: string): ParsedAfgIntent | undefined {
  if (!/\bafg\b|function gen|sine|square|ramp|pulse|noise|arb/i.test(message)) return undefined;

  const channel = /ch(?:annel)?\s*2/i.test(message) ? 2 : 1;
  const functionMatch = message.match(
    /\b(sin(?:e|usoid)?|squ(?:are)?|ramp|pulse|dc|noise|arb(?:itrary)?)\b/i
  );
  const frequencyMatch = message.match(/(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const amplitudeMatch = message.match(/(\d+(?:\.\d+)?)\s*(mVpp|Vpp)\b/i);
  const offsetMatch = message.match(/offset\s+(-?\d+(?:\.\d+)?)\s*(mV|V)\b/i);
  const dutyMatch = message.match(/(\d+(?:\.\d+)?)\s*%\s*duty\b/i);
  const burstMatch = message.match(/burst\s+(\d+)\s*cycles?\b/i);
  const outputOn = /\b(output\s+on|enable\s+output)\b/i.test(message) ? true : undefined;
  const hiZ = /\bhi.?z|high.?z|high\s+imp/i.test(message);

  return {
    channel,
    function: functionMatch ? normalizeAfgFunction(functionMatch[1]) : undefined,
    frequencyHz: frequencyMatch ? toHz(frequencyMatch[1], frequencyMatch[2]) : undefined,
    amplitudeVpp: amplitudeMatch ? toVolts(amplitudeMatch[1], amplitudeMatch[2]) : undefined,
    offsetVolts: offsetMatch ? toVolts(offsetMatch[1], offsetMatch[2]) : undefined,
    dutyCyclePct: dutyMatch ? Number(dutyMatch[1]) : undefined,
    impedance: hiZ ? 'HIGHZ' : '50',
    outputOn,
    burstCycles: burstMatch ? Number(burstMatch[1]) : undefined,
    burstState: burstMatch ? true : undefined,
  };
}

export function parseAwgIntent(message: string): ParsedAwgIntent | undefined {
  if (!/\bawg\b|arbitrary wave/i.test(message)) return undefined;

  const channelMatch = message.match(/\b(?:awg\s*)?(?:channel|ch)\s*(\d+)\b/i);
  const waveformMatch = message.match(
    /\b(sine|sinusoid|square|ramp|pulse|arb(?:itrary)?|gaussian)\b/i
  );
  const frequencyMatch = message.match(/(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const amplitudeMatch = message.match(/(\d+(?:\.\d+)?)\s*(mVpp|Vpp)\b/i);
  const sampleRateMatch = message.match(/sample\s+rate\s+(\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const outputOn = /\b(output\s+on|enable\s+output)\b/i.test(message) ? true : undefined;

  let runMode: ParsedAwgIntent['runMode'];
  if (/\bsequence\b/i.test(message)) runMode = 'SEQuence';
  else if (/\btriggered\b/i.test(message)) runMode = 'TRIGgered';
  else if (/\bgated\b/i.test(message)) runMode = 'GATed';
  else if (/\bcontinuous\b/i.test(message)) runMode = 'CONTinuous';

  return {
    channel: channelMatch ? Number(channelMatch[1]) : 1,
    waveformName: waveformMatch ? normalizeWaveformName(waveformMatch[1]) : undefined,
    frequencyHz: frequencyMatch ? toHz(frequencyMatch[1], frequencyMatch[2]) : undefined,
    amplitudeVpp: amplitudeMatch ? toVolts(amplitudeMatch[1], amplitudeMatch[2]) : undefined,
    outputOn,
    sampleRateHz: sampleRateMatch ? toHz(sampleRateMatch[1], sampleRateMatch[2]) : undefined,
    runMode,
  };
}

export function parseSmuIntent(message: string): ParsedSmuIntent | undefined {
  if (
    !/\bsmu\b|source measure|keithley|measure current|measure voltage|source current|source voltage/i.test(
      message
    )
  ) {
    return undefined;
  }

  const isCurrentSource = /\b(source|force)\s+current\b|current\s+source\b/i.test(message);
  const voltageMatch = message.match(/(-?\d+(?:\.\d+)?)\s*V\b(?!\s*pp)/i);
  const currentMatch = message.match(/(-?\d+(?:\.\d+)?)\s*(mA|A|uA)\b/i);
  const complianceMatch = message.match(
    /(?:compliance|current limit|voltage limit)\s+(-?\d+(?:\.\d+)?)\s*(mA|A|V|mV)\b/i
  );
  const sweepMatch = message.match(
    /sweep.*?(-?\d+(?:\.\d+)?)\s*(V|mV|A|mA|uA).*?to\s+(-?\d+(?:\.\d+)?)\s*(V|mV|A|mA|uA)/i
  );
  const pointsMatch = message.match(/\b(\d+)\s*points\b/i);
  const outputOn = /\b(output\s+on|enable\s+output)\b/i.test(message) ? true : undefined;
  const measureVoltage = /\b(measure|query)\s+volt/i.test(message);
  const measureCurrent = /\b(measure|query)\s+curr/i.test(message);
  const measureResistance = /\b(measure|query)\s+res/i.test(message);
  const measurePower = /\b(measure|query)\s+power/i.test(message);

  return {
    sourceFunction: isCurrentSource ? 'CURRent' : 'VOLTage',
    sourceLevel: isCurrentSource
      ? currentMatch
        ? toAmps(currentMatch[1], currentMatch[2])
        : undefined
      : voltageMatch
        ? toVolts(voltageMatch[1], 'V')
        : currentMatch
          ? toAmps(currentMatch[1], currentMatch[2])
          : undefined,
    complianceLevel: complianceMatch ? toVoltsOrAmps(complianceMatch[1], complianceMatch[2]) : undefined,
    outputOn,
    measureFunction: measureResistance
      ? 'RESistance'
      : measureCurrent
        ? 'CURRent'
        : measureVoltage
          ? 'VOLTage'
          : measurePower
            ? 'POWer'
            : undefined,
    sweepStart: sweepMatch ? toVoltsOrAmps(sweepMatch[1], sweepMatch[2]) : undefined,
    sweepStop: sweepMatch ? toVoltsOrAmps(sweepMatch[3], sweepMatch[4]) : undefined,
    sweepPoints: pointsMatch ? Number(pointsMatch[1]) : undefined,
  };
}

export function parseRsaIntent(message: string): ParsedRsaIntent | undefined {
  if (!/\brsa\b|spectrum anal|center frequency|span|rbw|reference level/i.test(message)) {
    return undefined;
  }

  const centerMatch = message.match(
    /\bcenter\s+frequency\s+(-?\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i
  );
  const spanMatch = message.match(/\bspan\s+(-?\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const rbwMatch = message.match(/\brbw\s+(-?\d+(?:\.\d+)?)\s*(Hz|kHz|MHz|GHz)\b/i);
  const refLevelMatch = message.match(/\breference\s+level\s+(-?\d+(?:\.\d+)?)\s*dBm\b/i);

  let triggerType: ParsedRsaIntent['triggerType'];
  if (/\bexternal trigger\b|\bext trigger\b|\btrigger ext\b/i.test(message)) triggerType = 'EXT';
  else if (/\bif trigger\b/i.test(message)) triggerType = 'IF';
  else if (/\btime trigger\b/i.test(message)) triggerType = 'TIME';
  else if (/\bfree run\b|\bfree trigger\b/i.test(message)) triggerType = 'FREE';

  let traceType: ParsedRsaIntent['traceType'];
  if (/\bmax hold\b/i.test(message)) traceType = 'MAXHold';
  else if (/\bmin hold\b/i.test(message)) traceType = 'MINHold';
  else if (/\baverage trace\b|\btrace average\b/i.test(message)) traceType = 'AVErage';
  else if (/\bwrite trace\b|\bclear write\b/i.test(message)) traceType = 'WRITe';

  let measurementType: ParsedRsaIntent['measurementType'];
  if (/\bdpx\b/i.test(message)) measurementType = 'DPX';
  else if (/\bdemod\b/i.test(message)) measurementType = 'DEMOD';
  else if (/\bpulse\b/i.test(message)) measurementType = 'PULSE';
  else if (centerMatch || spanMatch || rbwMatch || /\bspectrum\b/i.test(message)) {
    measurementType = 'SPECTRUM';
  }

  const rsa: ParsedRsaIntent = {
    centerFreqHz: centerMatch ? toHz(centerMatch[1], centerMatch[2]) : undefined,
    spanHz: spanMatch ? toHz(spanMatch[1], spanMatch[2]) : undefined,
    rbwHz: rbwMatch ? toHz(rbwMatch[1], rbwMatch[2]) : undefined,
    refLevelDbm: refLevelMatch ? Number(refLevelMatch[1]) : undefined,
    triggerType,
    traceType,
    measurementType,
  };

  return Object.values(rsa).some((value) => value !== undefined) ? rsa : undefined;
}

export function parseSaveIntent(
  message: string,
  context: Pick<ParseContext, 'channels'>
): ParsedSaveIntent | undefined {
  const save: ParsedSaveIntent = {};
  const clauses = splitClauses(message);

  if (SAVE_SCREENSHOT_REGEX.test(message)) save.screenshot = true;

  if (/\bsave\b/i.test(message) && /\bwaveform\b/i.test(message) && context.channels.length > 0) {
    save.waveformSources = context.channels.map((channel) => channel.channel);
    save.format = parseSaveFormat(message) ?? 'bin';
  }

  const waveformClauses = clauses.filter((clause) => SAVE_WAVEFORM_REGEX.test(clause));
  if (waveformClauses.length > 0) {
    const waveformSources = new Set<string>();
    for (const clause of waveformClauses) {
      for (const match of clause.matchAll(CHANNEL_REGEX)) {
        waveformSources.add(match[1].toUpperCase());
      }
    }
    if (waveformSources.size === 0) {
      for (const channel of context.channels) waveformSources.add(channel.channel);
    }
    if (waveformSources.size > 0) save.waveformSources = Array.from(waveformSources.values());
    save.format = parseSaveFormat(message) ?? 'bin';
  }

  const setupPathMatch = message.match(SAVE_PATH_REGEX);
  if (setupPathMatch) save.setupPath = setupPathMatch[0];

  return Object.keys(save).length > 0 ? save : undefined;
}

export function parseRecallIntent(message: string): ParsedRecallIntent | undefined {
  const recall: ParsedRecallIntent = {};
  if (RECALL_FACTORY_REGEX.test(message)) recall.factory = true;
  const sessionPathMatch = message.match(RECALL_SESSION_REGEX);
  if (sessionPathMatch) recall.sessionPath = sessionPathMatch[0];
  return Object.keys(recall).length > 0 ? recall : undefined;
}

export function parseStatusIntent(message: string): ParsedStatusIntent | undefined {
  if (!STATUS_QUERY_REGEX.test(message)) return undefined;
  const status: ParsedStatusIntent = {};
  if (/\besr\b|\bevent status\b|\bstatus quer(?:y|ies)\b|\bstatus checks?\b|\bcheck status\b/i.test(message)) {
    status.esr = true;
  }
  if (/\bopc\b|\boperation complete\b/i.test(message)) {
    status.opc = true;
  }
  return Object.keys(status).length > 0 ? status : undefined;
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

function splitClauses(message: string): string[] {
  return message
    .split(/[,\n;\r]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function extractChannelClauses(message: string): string[] {
  const clauses = splitClauses(message);
  const segments: string[] = [];

  for (const clause of clauses) {
    const matches = Array.from(clause.matchAll(CHANNEL_REGEX));
    if (matches.length === 0) continue;

    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index ?? 0;
      const nextStart = matches[index + 1]?.index ?? clause.length;
      const rawSegment = clause.slice(start, nextStart);
      const trimmedSegment = rawSegment.split(/\b(?:trigger|add|measure|save|single|acquisition|decode|bus)\b/i)[0]?.trim();
      if (trimmedSegment) {
        segments.push(trimmedSegment);
      }
    }
  }

  return segments;
}

function extractMeasurementClauses(message: string): string[] {
  const clauses = splitClauses(message);
  const segments: string[] = [];

  for (const clause of clauses) {
    if (!/\b(add|measure|measurement|query)\b/i.test(clause)) {
      segments.push(clause);
      continue;
    }

    const match = clause.match(/\b(add|measure|measurement|query)\b/i);
    const start = match?.index ?? 0;
    const segment = clause
      .slice(start)
      .split(/\b(?:save|screenshot|single|acquisition|trigger|decode|bus)\b/i)[0]
      ?.trim();
    if (segment) {
      segments.push(segment);
    }
  }

  return segments.length > 0 ? segments : clauses;
}

function findTriggerClause(message: string, secondary: boolean): string | undefined {
  const clauses = splitClauses(message);
  if (secondary) {
    return clauses.find((clause) => /\btrigger\s*b\b|\bb\s*trigger\b/i.test(clause));
  }
  return clauses.find(
    (clause) =>
      (/\btrigger\b/i.test(clause) && !/\btrigger\s*b\b|\bb\s*trigger\b/i.test(clause)) ||
      /\b(edge|pulse|runt|logic)\b/i.test(clause)
  );
}

function parseTriggerClause(
  clause: string,
  aliasMaps: IntentAliasMaps
): ParsedTriggerIntent | undefined {
  const trigger: ParsedTriggerIntent = {};
  const matchedType = matchFirstAliasValue(clause, aliasMaps.triggerTypeAliases);
  if (matchedType) trigger.type = matchedType as ParsedTriggerIntent['type'];

  const sourceMatch = clause.match(TRIGGER_SOURCE_REGEX);
  if (sourceMatch) trigger.source = sourceMatch[1].toUpperCase();

  if (TRIGGER_SLOPE_RISE_REGEX.test(clause)) trigger.slope = 'RISe';
  else if (TRIGGER_SLOPE_FALL_REGEX.test(clause)) trigger.slope = 'FALL';

  const levelAtMatch = clause.match(TRIGGER_LEVEL_AT_REGEX);
  if (levelAtMatch) {
    trigger.levelVolts = toVolts(levelAtMatch[1], levelAtMatch[2]);
  } else {
    const voltages = Array.from(clause.matchAll(VOLTAGE_REGEX));
    if (voltages.length > 0) {
      const lastMatch = voltages[voltages.length - 1];
      trigger.levelVolts = toVolts(lastMatch[1], lastMatch[2]);
    }
  }

  const modeMatch = clause.match(TRIGGER_MODE_REGEX);
  if (modeMatch) trigger.mode = modeMatch[1].toLowerCase() === 'normal' ? 'NORMal' : 'AUTO';

  const holdoffMatch = clause.match(TRIGGER_HOLDOFF_REGEX);
  if (holdoffMatch) trigger.holdoffSeconds = toSeconds(holdoffMatch[1], holdoffMatch[2]);

  return Object.keys(trigger).length > 0 ? trigger : undefined;
}

function isMeasurementClause(clause: string): boolean {
  if (/\b(trigger|screenshot|waveform|decode|recall|factory|reset)\b/i.test(clause)) {
    return false;
  }
  return /\b(add|measure|measurement|query)\b/i.test(clause);
}

function parseMeasurementSource(clause: string): string | undefined {
  const explicitOnSourceMatch = clause.match(/\bon\s+(CH[1-4])\b/i);
  if (explicitOnSourceMatch) return explicitOnSourceMatch[1].toUpperCase();
  const explicitFromSourceMatch = clause.match(/\bfrom\s+(CH[1-4])\b/i);
  if (explicitFromSourceMatch) return explicitFromSourceMatch[1].toUpperCase();
  return undefined;
}

function parseLastVoltageInVolts(input: string): number | undefined {
  const matches = Array.from(input.matchAll(VOLTAGE_REGEX));
  if (matches.length === 0) return undefined;
  const lastMatch = matches[matches.length - 1];
  return toVolts(lastMatch[1], lastMatch[2]);
}

function parseTerminationOhms(value: string): number {
  return value.toLowerCase().startsWith('1m') ? 1_000_000 : 50;
}

function normalizeAfgFunction(value: string): ParsedAfgIntent['function'] {
  const normalized = value.toLowerCase();
  if (normalized.startsWith('sin')) return 'SINusoid';
  if (normalized.startsWith('squ')) return 'SQUare';
  if (normalized.startsWith('ramp')) return 'RAMP';
  if (normalized.startsWith('pul')) return 'PULSe';
  if (normalized.startsWith('dc')) return 'DC';
  if (normalized.startsWith('noi')) return 'NOISe';
  return 'ARBitrary';
}

function normalizeWaveformName(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.startsWith('sin')) return 'SINE';
  if (normalized.startsWith('squ')) return 'SQUARE';
  if (normalized.startsWith('ramp')) return 'RAMP';
  if (normalized.startsWith('pul')) return 'PULSE';
  if (normalized.startsWith('gauss')) return 'GAUSSIAN';
  return 'ARBITRARY';
}

function parseSaveFormat(message: string): ParsedSaveIntent['format'] | undefined {
  if (/\.csv\b|\bcsv\b/i.test(message)) return 'csv';
  if (/\.wfm\b|\bwfm\b/i.test(message)) return 'wfm';
  if (/\.mat\b|\bmat\b/i.test(message)) return 'mat';
  if (/\.bin\b|\bbinary\b/i.test(message)) return 'bin';
  return undefined;
}

function toVolts(value: string, unit: string): number {
  const numericValue = Number(value);
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit === 'mv' || normalizedUnit === 'mvpp') return numericValue / 1000;
  return numericValue;
}

function toSeconds(value: string, unit: string): number {
  const numericValue = Number(value);
  switch (unit.toLowerCase()) {
    case 'ms':
      return numericValue / 1000;
    case 'us':
      return numericValue / 1_000_000;
    case 'ns':
      return numericValue / 1_000_000_000;
    default:
      return numericValue;
  }
}

function toHz(value: string, unit: string): number {
  const numericValue = Number(value);
  switch (unit.toLowerCase()) {
    case 'ghz':
      return numericValue * 1_000_000_000;
    case 'mhz':
      return numericValue * 1_000_000;
    case 'khz':
      return numericValue * 1000;
    default:
      return numericValue;
  }
}

function toBitrate(value: string, unit: string): number {
  const numericValue = Number(value);
  return unit.toLowerCase() === 'mbps' ? numericValue * 1_000_000 : numericValue * 1000;
}

function toAmps(value: string, unit: string): number {
  const numericValue = Number(value);
  switch (unit.toLowerCase()) {
    case 'ma':
      return numericValue / 1000;
    case 'ua':
      return numericValue / 1_000_000;
    default:
      return numericValue;
  }
}

function toVoltsOrAmps(value: string, unit: string): number {
  return /v/i.test(unit) ? toVolts(value, unit) : toAmps(value, unit);
}

function parseScaledInteger(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)([kKmM]?)$/);
  if (!match) return Number(value);
  const numericValue = Number(match[1]);
  const suffix = match[2].toLowerCase();
  if (suffix === 'k') return Math.round(numericValue * 1000);
  if (suffix === 'm') return Math.round(numericValue * 1_000_000);
  return Math.round(numericValue);
}

function parseOffsetInVolts(clause: string): number | undefined {
  const match = clause.match(/\boffset\s+(?:to\s+)?(-?\d+(?:\.\d+)?)\s*(mV|V)?\b/i);
  if (!match) return undefined;
  return toVolts(match[1], match[2] || 'V');
}

function dedupeGroups(groups: IntentGroup[]): IntentGroup[] {
  return Array.from(new Set(groups));
}

function buildBindings(intent: PlannerIntent): Record<string, string> {
  const bindings: Record<string, string> = {};
  if (intent.channels[0]?.channel) bindings['CH<x>'] = intent.channels[0].channel;
  if (intent.bus?.bus) bindings['B<x>'] = intent.bus.bus;
  return bindings;
}

function getPrimaryFamilyHint(modelFamily: string): string | undefined {
  const normalized = (modelFamily || '').toUpperCase();
  if (/DPO70000/.test(normalized)) return 'DPO70000';
  if (/DPO7000|7K/.test(normalized)) return 'DPO7000';
  if (/DPO5000|5K/.test(normalized)) return 'DPO5000';
  if (/MSO7/.test(normalized)) return 'MSO7';
  if (/MSO6/.test(normalized)) return 'MSO6';
  if (/MSO5/.test(normalized)) return 'MSO5';
  if (/MSO4/.test(normalized)) return 'MSO4';
  if (/MSO2/.test(normalized)) return 'MSO2';
  return undefined;
}

function findExactHeader(
  index: CommandIndex,
  header: string,
  sourceFile: string
): CommandRecord | null {
  const matches = index
    .getEntries()
    .filter((entry) => headersEquivalent(entry.header, header));

  return matches.find((entry) => entry.sourceFile === sourceFile) ?? matches[0] ?? null;
}

function materialize(
  record: CommandRecord,
  concreteHeader: string,
  value: string | undefined,
  group: IntentGroup,
  commandType: 'set' | 'query' = 'set',
  saveAs?: string
): ResolvedCommand {
  const concreteCommand =
    value !== undefined ? `${concreteHeader} ${value}` : concreteHeader;

  return {
    group,
    header: record.header,
    concreteCommand,
    commandType,
    saveAs,
    verified: true,
    sourceFile: record.sourceFile,
    syntax: record.syntax || {},
    arguments: transformArguments(record.arguments, record.raw),
    examples: transformExamples(record.codeExamples),
    notes: record.notes,
    relatedCommands: record.relatedCommands,
  };
}

function buildSyntheticQuery(
  command: string,
  group: IntentGroup,
  saveAs?: string
): ResolvedCommand {
  return {
    group,
    header: command.replace(/\?$/, ''),
    concreteCommand: command,
    commandType: 'query',
    saveAs,
    verified: true,
    sourceFile: 'synthetic_common',
    syntax: { query: command },
    arguments: [],
    examples: [{ scpi: command }],
    notes: ['Synthetic fallback for standard IEEE/status query.'],
  };
}

function transformArguments(
  args: CommandArgument[],
  raw: Record<string, unknown>
): ResolvedCommandArgument[] {
  const rawParams = Array.isArray(raw.params)
    ? (raw.params as Array<Record<string, unknown>>)
    : [];

  return args.map((arg, index) => {
    const rawParam = rawParams[index] ?? {};
    const validValues = extractValidValues(arg.validValues, rawParam);

    return {
      name: arg.name,
      type: arg.type,
      required: arg.required,
      validValues: validValues.length > 0 ? validValues : undefined,
      min: coerceNumber(rawParam.min),
      max: coerceNumber(rawParam.max),
      unit: typeof rawParam.unit === 'string' ? rawParam.unit : undefined,
      description: arg.description,
    };
  });
}

function transformExamples(examples: CommandCodeExample[]): ResolvedCommandExample[] {
  return (examples || []).map((example) => ({
    scpi: example.scpi?.code,
    tm_devices: example.tm_devices?.code,
  }));
}

function extractValidValues(
  validValues: Record<string, unknown>,
  rawParam: Record<string, unknown>
): string[] {
  const fromValues = Array.isArray(validValues.values)
    ? (validValues.values as unknown[]).map(String)
    : [];
  const fromOptions = Array.isArray(rawParam.options)
    ? (rawParam.options as unknown[]).map(String)
    : [];
  return Array.from(new Set([...fromValues, ...fromOptions]));
}

function coerceNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function hasBusDecodeDetails(bus: ParsedBusIntent): boolean {
  return Boolean(
    bus.source1 ||
      bus.source2 ||
      bus.clockSource ||
      bus.dataSource ||
      bus.bitrateBps !== undefined ||
      bus.dataPhaseBitrateBps !== undefined ||
      bus.standard ||
      bus.thresholdVolts !== undefined ||
      bus.clockThresholdVolts !== undefined ||
      bus.dataThresholdVolts !== undefined ||
      bus.chipSelect ||
      bus.selectPolarity ||
      bus.baudRate !== undefined ||
      bus.dataBits !== undefined ||
      bus.parity ||
      bus.slope
  );
}

function headersEquivalent(left: string, right: string): boolean {
  return canonicalizeHeader(left) === canonicalizeHeader(right);
}

function canonicalizeHeader(header: string): string {
  return header
    .trim()
    .split(/\s+/)[0]
    .replace(/^:/, '')
    .replace(/\?/g, '')
    .replace(/\{A\|B\}/gi, 'A')
    .replace(/\{CH\}|\{ch\}|\[1\|2\]/g, '<x>')
    .replace(/\{M\}|\{m\}/g, '<x>')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bSOURce\d+\b/gi, 'SOURce<x>')
    .replace(/\bOUTPut\d+\b/gi, 'OUTPut<x>')
    .replace(/\bB\d+\b/gi, 'B<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bWAVEVIEW\d+\b/gi, 'WAVEView<x>')
    .toUpperCase();
}
