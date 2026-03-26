import { publicAssetUrl } from '../publicUrl';

const COMMAND_LIBRARY_FILES = [
  'mso_2_4_5_6_7.json',
  'MSO_DPO_5k_7k_70K.json',
  'afg.json',
  'awg.json',
  'smu.json',
  'dpojet.json',
  'tekexpress.json',
  'rsa.json',
] as const;

const BLOCKLY_ALLOWED_TYPES = new Set([
  'connect_scope',
  'disconnect',
  'set_device_context',
  'scpi_write',
  'scpi_query',
  'recall',
  'save',
  'save_screenshot',
  'save_waveform',
  'wait_seconds',
  'wait_for_opc',
  'tm_devices_write',
  'tm_devices_query',
  'tm_devices_save_screenshot',
  'tm_devices_recall_session',
  'controls_for',
  'controls_if',
  'variables_set',
  'variables_get',
  'math_number',
  'math_arithmetic',
]);

const BLOCKLY_INVALID_TYPES = new Set(['group', 'comment', 'error_check']);

const STEP_TYPES = new Set([
  'connect',
  'disconnect',
  'query',
  'write',
  'set_and_query',
  'recall',
  'sleep',
  'python',
  'save_waveform',
  'save_screenshot',
  'error_check',
  'comment',
  'group',
  'tm_device_command',
]);

type JsonRecord = Record<string, unknown>;

export interface CommandEntry {
  key: string;
  commandId: string;
  sourceFile: string;
  group?: string;
}

export interface CommandLibraryIndex {
  commandMap: Map<string, CommandEntry[]>;
}

export interface TmDevicesIndex {
  methodPathsByRoot: Map<string, Set<string>>;
}

export interface ScpiVerificationInput {
  command: string;
  mode?: 'scpi' | 'tm_devices';
  modelHint?: string;
}

export interface ScpiVerificationItem {
  input: string;
  mode: 'scpi' | 'tm_devices';
  valid: boolean;
  references: Array<{ commandId: string; sourceFile: string; group?: string }>;
  reason?: string;
}

export interface VerificationResult {
  valid: boolean;
  items: ScpiVerificationItem[];
  errors: string[];
}

export interface StrictValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

let commandLibraryCache: CommandLibraryIndex | null = null;
let tmDevicesCache: TmDevicesIndex | null = null;

function toObject(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function normalizeWs(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeCommandTokenCase(value: string): string {
  return normalizeWs(value)
    .replace(/["']/g, '"')
    .toUpperCase();
}

function stripSegmentArguments(segment: string): string[] {
  const tokens = normalizeWs(segment).split(' ').filter(Boolean);
  const candidates: string[] = [];
  for (let count = Math.min(4, tokens.length); count >= 1; count -= 1) {
    const slice = tokens.slice(0, count).join(' ');
    const cleaned = slice
      .replace(/,\s*".*$/g, '')
      .replace(/,\s*<.*$/g, '')
      .replace(/\s+".*$/g, '')
      .replace(/\s+<.*$/g, '')
      .replace(/\s+\{.*$/g, '');
    if (cleaned.trim()) candidates.push(normalizeCommandTokenCase(cleaned));
  }
  const first = tokens[0] || '';
  if (first) {
    candidates.push(
      normalizeCommandTokenCase(first.replace(/[;,]$/, '').replace(/\?.*$/, '?'))
    );
    candidates.push(
      normalizeCommandTokenCase(first.replace(/[;,]$/, '').replace(/\?$/, ''))
    );
  }
  return Array.from(new Set(candidates));
}

function splitScpiSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch as '"' | "'";
      current += ch;
      continue;
    }
    if (ch === quote) {
      quote = '';
      current += ch;
      continue;
    }
    if (ch === ';' && !quote) {
      const trimmed = current.trim();
      if (trimmed) segments.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) segments.push(tail);
  return segments;
}

function extractCommandsFromGroups(
  sourceFile: string,
  groupsObj: JsonRecord,
  map: Map<string, CommandEntry[]>
): void {
  Object.entries(groupsObj).forEach(([groupName, groupRaw]) => {
    const group = toObject(groupRaw);
    const commands = Array.isArray(group?.commands) ? (group?.commands as unknown[]) : [];
    commands.forEach((cmdRaw) => {
      const cmd = toObject(cmdRaw);
      if (!cmd) return;

      const variants: string[] = [];
      const header = typeof cmd.header === 'string' ? cmd.header : '';
      const scpi = typeof cmd.scpi === 'string' ? cmd.scpi : '';
      const command = typeof cmd.command === 'string' ? cmd.command : '';
      const syntax = toObject(cmd.syntax);
      const manual = toObject(cmd._manualEntry);
      const manualHeader = typeof manual?.header === 'string' ? manual.header : '';
      const manualSyntax = toObject(manual?.syntax);

      if (header) variants.push(header);
      if (manualHeader) variants.push(manualHeader);
      if (scpi) variants.push(scpi);
      if (command) variants.push(command);
      if (typeof syntax?.set === 'string') variants.push(syntax.set);
      if (typeof syntax?.query === 'string') variants.push(syntax.query);
      if (Array.isArray(cmd.syntax)) {
        (cmd.syntax as unknown[]).forEach((s) => {
          if (typeof s === 'string') variants.push(s);
        });
      }
      if (typeof manualSyntax?.set === 'string') variants.push(manualSyntax.set);
      if (typeof manualSyntax?.query === 'string') variants.push(manualSyntax.query);

      const commandId =
        (typeof cmd.id === 'string' && cmd.id) ||
        header ||
        manualHeader ||
        scpi ||
        command ||
        'unknown_command';

      variants.forEach((variant) => {
        const normalized = stripSegmentArguments(variant);
        normalized.forEach((key) => {
          const existing = map.get(key) || [];
          existing.push({ key, commandId, sourceFile, group: groupName });
          map.set(key, existing);
        });
      });
    });
  });
}

function extractCommandsFromSections(
  sourceFile: string,
  sectionsObj: JsonRecord,
  map: Map<string, CommandEntry[]>
): void {
  Object.entries(sectionsObj).forEach(([sectionName, sectionRaw]) => {
    if (!Array.isArray(sectionRaw)) return;
    (sectionRaw as unknown[]).forEach((cmdRaw) => {
      const cmd = toObject(cmdRaw);
      if (!cmd) return;
      const command = typeof cmd.command === 'string' ? cmd.command : '';
      const manual = toObject(cmd._manualEntry);
      const manualHeader = typeof manual?.header === 'string' ? manual.header : '';
      const commandId = command || manualHeader || `${sectionName}_command`;
      [command, manualHeader].forEach((variant) => {
        if (!variant) return;
        const keys = stripSegmentArguments(variant);
        keys.forEach((key) => {
          const existing = map.get(key) || [];
          existing.push({ key, commandId, sourceFile, group: sectionName });
          map.set(key, existing);
        });
      });
    });
  });
}

export async function loadCommandLibraryIndex(
  fetcher: typeof fetch = fetch
): Promise<CommandLibraryIndex> {
  if (commandLibraryCache) return commandLibraryCache;
  const map = new Map<string, CommandEntry[]>();

  for (const file of COMMAND_LIBRARY_FILES) {
    const response = await fetcher(publicAssetUrl(`commands/${file}`));
    if (!response.ok) continue;
    const data = (await response.json()) as unknown;
    const obj = toObject(data);
    if (!obj) continue;
    const groups = toObject(obj.groups);
    if (groups) {
      extractCommandsFromGroups(file, groups, map);
      continue;
    }
    const sections = toObject(obj.commands_by_section);
    if (sections) {
      extractCommandsFromSections(file, sections, map);
    }
  }

  commandLibraryCache = { commandMap: map };
  return commandLibraryCache;
}

function normalizeTmDevicesCode(input: string): { candidatePath: string; method: string } | null {
  const cleaned = normalizeWs(input);
  const methodMatch = cleaned.match(/\.(write|query|verify)\s*\(/i);
  if (!methodMatch) return null;
  const method = methodMatch[1].toLowerCase();
  const prefix = cleaned.slice(0, methodMatch.index);
  const withoutVar = prefix.replace(/^[A-Za-z_]\w*\.commands\./, '');
  const normalizedPath = withoutVar.replace(/\[(\d+)\]/g, '[x]').toLowerCase();
  if (!normalizedPath) return null;
  return { candidatePath: `${normalizedPath}.${method}`, method };
}

function walkTmDevicesTree(node: unknown, prefix: string[], collector: Set<string>): void {
  const obj = toObject(node);
  if (!obj) return;
  Object.entries(obj).forEach(([key, value]) => {
    if (key === 'cmd_syntax') return;
    if (value === 'METHOD') {
      const fullPath = [...prefix, key].join('.').toLowerCase();
      collector.add(fullPath);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      walkTmDevicesTree(value, [...prefix, key], collector);
    }
  });
}

export async function loadTmDevicesIndex(
  fetcher: typeof fetch = fetch
): Promise<TmDevicesIndex> {
  if (tmDevicesCache) return tmDevicesCache;
  const response = await fetcher(publicAssetUrl('commands/tm_devices_full_tree.json'));
  if (!response.ok) {
    tmDevicesCache = { methodPathsByRoot: new Map() };
    return tmDevicesCache;
  }
  const json = (await response.json()) as unknown;
  const root = toObject(json);
  const methodPathsByRoot = new Map<string, Set<string>>();
  if (!root) {
    tmDevicesCache = { methodPathsByRoot };
    return tmDevicesCache;
  }

  Object.entries(root).forEach(([rootKey, tree]) => {
    const methods = new Set<string>();
    walkTmDevicesTree(tree, [], methods);
    methodPathsByRoot.set(rootKey.toLowerCase(), methods);
  });

  tmDevicesCache = { methodPathsByRoot };
  return tmDevicesCache;
}

export function setCommandLibraryIndexForTests(index: CommandLibraryIndex | null): void {
  commandLibraryCache = index;
}

export function setTmDevicesIndexForTests(index: TmDevicesIndex | null): void {
  tmDevicesCache = index;
}

export async function verifyScpiCommands(
  inputs: ScpiVerificationInput[],
  deps?: { commandLibrary?: CommandLibraryIndex; tmDevices?: TmDevicesIndex }
): Promise<VerificationResult> {
  const commandLibrary = deps?.commandLibrary || (await loadCommandLibraryIndex());
  const tmDevices = deps?.tmDevices || (await loadTmDevicesIndex());

  const items: ScpiVerificationItem[] = [];
  const errors: string[] = [];

  inputs.forEach((input) => {
    const mode = input.mode || 'scpi';
    if (mode === 'tm_devices') {
      const parsed = normalizeTmDevicesCode(input.command);
      if (!parsed) {
        const reason = 'Invalid tm_devices code format.';
        items.push({ input: input.command, mode, valid: false, references: [], reason });
        errors.push(`${input.command}: ${reason}`);
        return;
      }
      const roots = Array.from(tmDevices.methodPathsByRoot.keys());
      const matchedRoots = input.modelHint
        ? roots.filter((r) => r.includes(input.modelHint!.toLowerCase()))
        : roots;
      const candidateRoots = matchedRoots.length ? matchedRoots : roots;
      const found = candidateRoots.some((root) =>
        tmDevices.methodPathsByRoot.get(root)?.has(parsed.candidatePath)
      );
      if (!found) {
        const reason = 'This is not documented in the uploaded sources.';
        items.push({ input: input.command, mode, valid: false, references: [], reason });
        errors.push(`${input.command}: ${reason}`);
        return;
      }
      items.push({
        input: input.command,
        mode,
        valid: true,
        references: [{ commandId: parsed.candidatePath, sourceFile: 'tm_devices_full_tree.json' }],
      });
      return;
    }

    const segments = splitScpiSegments(input.command);
    if (!segments.length) {
      const reason = 'Empty command.';
      items.push({ input: input.command, mode, valid: false, references: [], reason });
      errors.push(`${input.command}: ${reason}`);
      return;
    }

    const segmentRefs: Array<{ commandId: string; sourceFile: string; group?: string }> = [];
    let segmentFailed = false;

    segments.forEach((segment) => {
      const keys = stripSegmentArguments(segment);
      const refs = keys.flatMap((key) => commandLibrary.commandMap.get(key) || []);
      if (!refs.length) {
        segmentFailed = true;
        errors.push(
          `${segment}: I could not verify this command in the uploaded sources.`
        );
        return;
      }
      refs.forEach((r) =>
        segmentRefs.push({ commandId: r.commandId, sourceFile: r.sourceFile, group: r.group })
      );
    });

    if (segmentFailed) {
      items.push({
        input: input.command,
        mode,
        valid: false,
        references: [],
        reason: 'I could not verify this command in the uploaded sources.',
      });
      return;
    }

    const dedup = new Map<string, { commandId: string; sourceFile: string; group?: string }>();
    segmentRefs.forEach((ref) => {
      dedup.set(`${ref.sourceFile}:${ref.commandId}:${ref.group || ''}`, ref);
    });
    items.push({
      input: input.command,
      mode,
      valid: true,
      references: Array.from(dedup.values()),
    });
  });

  return { valid: errors.length === 0, items, errors };
}

function collectSteps(
  steps: unknown[],
  out: Array<{ step: JsonRecord; path: string }>
): void {
  steps.forEach((raw, idx) => {
    const step = toObject(raw);
    if (!step) return;
    out.push({ step, path: `steps[${idx}]` });
    if (Array.isArray(step.children)) {
      collectSteps(step.children as unknown[], out);
    }
  });
}

function hasFileExtension(value: string, ext: string): boolean {
  return value.trim().toLowerCase().endsWith(ext.toLowerCase());
}

export async function validateStepsJson(
  payload: unknown,
  deps?: { commandLibrary?: CommandLibraryIndex; tmDevices?: TmDevicesIndex }
): Promise<StrictValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = toObject(payload);
  if (!root) {
    return { valid: false, errors: ['Payload must be a JSON object.'], warnings };
  }
  if (typeof root.name !== 'string' || !root.name.trim()) {
    errors.push('Root "name" is required.');
  }
  if (typeof root.backend !== 'string' || !root.backend.trim()) {
    errors.push('Root "backend" is required.');
  }
  if (!Array.isArray(root.steps)) {
    errors.push('Root "steps" must be an array.');
    return { valid: false, errors, warnings };
  }

  const topLevel = root.steps as unknown[];
  if (topLevel.length) {
    const first = toObject(topLevel[0]);
    const last = toObject(topLevel[topLevel.length - 1]);
    if (first?.type !== 'connect') {
      warnings.push('Workflow should start with a connect step.');
    }
    if (last?.type !== 'disconnect') {
      warnings.push('Workflow should end with a disconnect step.');
    }
  }

  const flattened: Array<{ step: JsonRecord; path: string }> = [];
  collectSteps(topLevel, flattened);
  const ids = new Set<string>();
  const scpiToVerify: ScpiVerificationInput[] = [];

  flattened.forEach(({ step, path }) => {
    const id = step.id;
    if (typeof id !== 'string' || !id.trim()) {
      errors.push(`${path}: step id must be a non-empty string.`);
    } else if (ids.has(id)) {
      errors.push(`${path}: duplicate step id "${id}".`);
    } else {
      ids.add(id);
    }

    const type = typeof step.type === 'string' ? step.type : '';
    if (!STEP_TYPES.has(type)) {
      errors.push(`${path}: invalid step type "${type}".`);
      return;
    }

    const params = toObject(step.params) || {};

    if (type === 'query') {
      if (typeof params.command !== 'string' || !params.command.trim()) {
        errors.push(`${path}: query step requires params.command.`);
      }
      if (typeof params.saveAs !== 'string' || !params.saveAs.trim()) {
        errors.push(`${path}: query step requires params.saveAs.`);
      }
      if (typeof params.command === 'string' && params.command.trim()) {
        scpiToVerify.push({ command: params.command, mode: 'scpi' });
      }
    }

    if (type === 'write' || type === 'set_and_query') {
      if (typeof params.command !== 'string' || !params.command.trim()) {
        errors.push(`${path}: ${type} step requires params.command.`);
      } else {
        scpiToVerify.push({ command: params.command, mode: 'scpi' });
      }
    }

    if (type === 'group') {
      if (!toObject(step.params)) {
        errors.push(`${path}: group step requires params:{}.`);
      }
      if (!Array.isArray(step.children)) {
        errors.push(`${path}: group step requires children:[].`);
      }
    }

    if (type === 'recall') {
      const recallType = typeof params.recallType === 'string' ? params.recallType.toUpperCase() : '';
      const filePath = typeof params.filePath === 'string' ? params.filePath : '';
      if (['FACTORY', 'SETUP', 'SESSION', 'WAVEFORM'].indexOf(recallType) === -1) {
        errors.push(`${path}: recallType must be FACTORY|SETUP|SESSION|WAVEFORM.`);
      }
      if (recallType === 'SETUP' && filePath && !hasFileExtension(filePath, '.set')) {
        errors.push(`${path}: SETUP recall requires .set filePath.`);
      }
      if (recallType === 'SESSION' && filePath && !hasFileExtension(filePath, '.tss')) {
        errors.push(`${path}: SESSION recall requires .tss filePath.`);
      }
      if (recallType === 'WAVEFORM' && filePath && !hasFileExtension(filePath, '.wfm')) {
        errors.push(`${path}: WAVEFORM recall requires .wfm filePath.`);
      }
    }

    if (type === 'tm_device_command') {
      if (typeof params.code !== 'string' || !params.code.trim()) {
        errors.push(`${path}: tm_device_command requires params.code.`);
      } else {
        scpiToVerify.push({
          command: params.code,
          mode: 'tm_devices',
          modelHint: typeof params.model === 'string' ? params.model : undefined,
        });
      }
    }
  });

  if (scpiToVerify.length) {
    const verified = await verifyScpiCommands(scpiToVerify, deps);
    verified.errors.forEach((e) => errors.push(e));
  }

  return { valid: errors.length === 0, errors, warnings };
}

function getDocumentWithFallback(xml: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xml, 'application/xml');
}

export function validateBlocklyXml(
  xml: string,
  options?: { backend?: string; requireRootCoordinates?: boolean }
): StrictValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const doc = getDocumentWithFallback(xml);
  if (doc.querySelector('parsererror')) {
    return { valid: false, errors: ['Invalid XML payload.'], warnings };
  }
  const root = doc.documentElement;
  if (!root || root.tagName !== 'xml') {
    return { valid: false, errors: ['Root <xml> element is required.'], warnings };
  }
  const ns = root.getAttribute('xmlns');
  if (ns !== 'https://developers.google.com/blockly/xml') {
    errors.push('Root xmlns must be https://developers.google.com/blockly/xml.');
  }

  const blocks = Array.from(doc.getElementsByTagName('block'));
  const ids = new Set<string>();
  blocks.forEach((block, idx) => {
    const id = block.getAttribute('id') || '';
    const type = block.getAttribute('type') || '';
    if (!id) errors.push(`block[${idx}] is missing id.`);
    else if (ids.has(id)) errors.push(`Duplicate block id "${id}".`);
    else ids.add(id);

    if (BLOCKLY_INVALID_TYPES.has(type)) {
      errors.push(`Block type "${type}" is JSON-only and invalid in Blockly XML.`);
    }
    if (!BLOCKLY_ALLOWED_TYPES.has(type)) {
      errors.push(`Block type "${type}" is not in the strict allowed list.`);
    }
  });

  const topBlocks = Array.from(root.children).filter((child) => child.tagName === 'block');
  if (topBlocks.length) {
    const first = topBlocks[0];
    if (options?.requireRootCoordinates !== false) {
      if (first.getAttribute('x') !== '20' || first.getAttribute('y') !== '20') {
        errors.push('Top-level root block must include x="20" and y="20".');
      }
    }
  }

  if (options?.backend?.toLowerCase() === 'tm_devices') {
    const nonTmCommandTypes = ['scpi_write', 'scpi_query', 'save', 'recall', 'save_waveform'];
    blocks.forEach((block) => {
      const type = block.getAttribute('type') || '';
      if (nonTmCommandTypes.includes(type)) {
        errors.push(`Backend tm_devices requires tm_devices_* command blocks. Found "${type}".`);
      }
    });
  }

  blocks.forEach((block) => {
    const type = block.getAttribute('type') || '';
    if (type === 'scpi_query') {
      const fields = Array.from(block.getElementsByTagName('field'));
      const variableField = fields.find((f) => f.getAttribute('name') === 'VARIABLE');
      if (!variableField || !normalizeWs(variableField.textContent || '')) {
        errors.push('scpi_query block requires non-empty VARIABLE field.');
      }
    }
  });

  return { valid: errors.length === 0, errors, warnings };
}
