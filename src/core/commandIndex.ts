import { promises as fs } from 'fs';
import * as path from 'path';
import { resolveCommandsDir } from './paths';
import { GROUP_DESCRIPTIONS } from './commandGroups';

export type CommandType = 'set' | 'query' | 'both';

export interface CommandSyntax {
  set?: string;
  query?: string;
}

export interface CommandArgument {
  name: string;
  type: string;
  required: boolean;
  description: string;
  validValues: Record<string, unknown>;
  defaultValue?: unknown;
}

export interface CommandCodeExample {
  description: string;
  scpi?: { code: string };
  python?: { code: string };
  tm_devices?: { code: string };
}

export interface ManualReference {
  section?: string;
  page?: number;
}

export interface CommandRecord {
  commandId: string;
  sourceFile: string;
  group: string;
  header: string;
  shortDescription: string;
  description: string;
  category: string;
  tags: string[];
  commandType: CommandType;
  families: string[];
  models: string[];
  syntax: CommandSyntax;
  arguments: CommandArgument[];
  queryResponse?: string;
  codeExamples: CommandCodeExample[];
  relatedCommands: string[];
  notes: string[];
  manualReference?: ManualReference;
  raw: Record<string, unknown>;
}

export interface SearchFilters {
  family?: string;
  commandType?: CommandType;
  limit?: number;
}

const DEFAULT_COMMAND_FILES = [
  'mso_2_4_5_6_7.json',
  'MSO_DPO_5k_7k_70K.json',
  'afg.json',
  'awg.json',
  'smu.json',
  'dpojet.json',
  'tekexpress.json',
  'rsa.json',
];

const SOURCE_FILE_FAMILY_HINTS: Record<string, string[]> = {
  'mso_2_4_5_6_7.json': ['MSO2', 'MSO4', 'MSO5', 'MSO6', 'MSO7'],
  'MSO_DPO_5k_7k_70K.json': ['MSO5000', 'DPO5000', 'DPO7000', 'DPO70000'],
  'afg.json': ['AFG'],
  'awg.json': ['AWG'],
  'smu.json': ['SMU'],
  'rsa.json': ['RSA'],
  'dpojet.json': ['DPOJET'],
  'tekexpress.json': ['TEKEXPRESS'],
};

function stripPlaceholders(token: string): string {
  // Remove {ch}, {n}, <x>, <y> etc from tokens
  return token.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '');
}

function normalizeToken(raw: string): string {
  const stripped = stripPlaceholders(raw);
  return stripped.replace(/[^A-Za-z0-9_*]/g, '').toUpperCase().trim();
}

function shortToken(raw: string): string {
  const cleaned = stripPlaceholders(raw).replace(/[^A-Za-z0-9_*]/g, '');
  if (!cleaned) return '';
  const star = cleaned.startsWith('*') ? '*' : '';
  const body = star ? cleaned.slice(1) : cleaned;
  const upperChars = body.split('').filter((ch) => ch >= 'A' && ch <= 'Z').join('');
  const short = upperChars || body.toUpperCase();
  return `${star}${short}`;
}

function tokenizeHeader(header: string): string[] {
  return header
    .replace(/\?/g, '')
    .replace(/,/g, ' ')
    .split(/[:\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function stripPlaceholdersFromKey(key: string): string {
  return key
    .split(':')
    .map((t) => stripPlaceholders(t))
    .filter(Boolean)
    .join(':');
}

function stripTrailingDigitsFromKey(key: string): string {
  return key
    .split(':')
    .map((t) => t.replace(/\d+$/g, ''))
    .filter(Boolean)
    .join(':');
}

function rootTokenForSafety(header: string): string {
  const root = tokenizeHeader(header)[0] || '';
  return normalizeToken(root.replace(/\d+$/g, ''));
}

function normalizeHeaderKey(header: string): string {
  const tokens = tokenizeHeader(header).map(normalizeToken).filter(Boolean);
  return tokens.join(':');
}

function expandHeaderKeys(header: string): string[] {
  const tokens = tokenizeHeader(header);
  if (!tokens.length) return [];
  const variants = tokens.map((t) => {
    const full = normalizeToken(t);
    const short = shortToken(t);
    return full && short && full !== short ? [full, short] : [full || short];
  });

  const keys: string[] = [];
  const walk = (idx: number, acc: string[]) => {
    if (idx >= variants.length) {
      const key = acc.filter(Boolean).join(':');
      if (key) keys.push(key);
      return;
    }
    variants[idx].forEach((v) => walk(idx + 1, [...acc, v]));
  };
  walk(0, []);
  return Array.from(new Set(keys));
}

function normalizeText(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_:.?]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 1);
}

function extractHeader(raw: Record<string, unknown>): string {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  if (typeof manual?.header === 'string' && manual.header.trim()) {
    return manual.header.trim();
  }
  const header =
    (typeof raw.header === 'string' && raw.header) ||
    '';
  if (header) return header.trim();

  const src = (typeof raw.command === 'string' && raw.command) || (typeof raw.scpi === 'string' && raw.scpi) || '';
  if (!src) return '';
  const base = src.split(/\s+/).slice(0, 2).join(' ').trim();
  return base.replace(/\?$/, '');
}

function extractShortDescription(raw: Record<string, unknown>): string {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  return (
    (typeof raw.shortDescription === 'string' && raw.shortDescription.trim()) ||
    (typeof manual?.shortDescription === 'string' && manual.shortDescription.trim()) ||
    (typeof raw.summary === 'string' && raw.summary.trim()) ||
    ''
  );
}

function extractSyntax(raw: Record<string, unknown>): CommandSyntax {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const manualSyntax = manual?.syntax;
  if (manualSyntax && typeof manualSyntax === 'object' && !Array.isArray(manualSyntax)) {
    const syn = manualSyntax as Record<string, unknown>;
    const setValue = typeof syn.set === 'string' ? syn.set.trim() : '';
    const queryValue = typeof syn.query === 'string' ? syn.query.trim() : '';
    if (setValue || queryValue) {
      return { set: setValue || undefined, query: queryValue || undefined };
    }
  }

  const syntax = raw.syntax;
  if (!syntax) return {};

  if (typeof syntax === 'object' && !Array.isArray(syntax)) {
    const syn = syntax as Record<string, unknown>;
    const setValue = typeof syn.set === 'string' ? syn.set.trim() : '';
    const queryValue = typeof syn.query === 'string' ? syn.query.trim() : '';
    return {
      set: setValue || undefined,
      query: queryValue || undefined,
    };
  }

  const candidates: string[] = [];
  if (typeof syntax === 'string') {
    candidates.push(syntax.trim());
  } else if (Array.isArray(syntax)) {
    syntax.forEach((item) => {
      if (typeof item === 'string' && item.trim()) candidates.push(item.trim());
    });
  }

  let setValue = '';
  let queryValue = '';
  const classify = (chunk: string) => {
    if (!chunk) return;
    if (chunk.includes('?')) {
      if (!queryValue) queryValue = chunk;
    } else if (!setValue) {
      setValue = chunk;
    }
  };

  candidates.forEach((candidate) => {
    const parts = candidate
      .split(/\s+(?=[A-Za-z*][A-Za-z0-9]*(?::[A-Za-z0-9]+)+)/g)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      classify(candidate);
      return;
    }
    parts.forEach(classify);
  });

  return {
    set: setValue || undefined,
    query: queryValue || undefined,
  };
}

function toValidValues(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function extractArguments(raw: Record<string, unknown>): CommandArgument[] {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const params = Array.isArray(raw.params) ? raw.params : [];
  const argsRaw = params.length
    ? params
    : Array.isArray(raw.arguments)
      ? raw.arguments
      : Array.isArray(manual?.arguments)
        ? (manual?.arguments as unknown[])
        : [];
  if (!Array.isArray(argsRaw)) return [];
  return argsRaw
    .filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === 'object')
    .map((arg) => ({
      name: typeof arg.name === 'string' ? arg.name : '',
      type: typeof arg.type === 'string' ? arg.type : '',
      required: Boolean(arg.required),
      description: typeof arg.description === 'string' ? arg.description : '',
      validValues: toValidValues(
        arg.validValues ||
          (Array.isArray(arg.options) ? { values: arg.options } : undefined) ||
          (typeof arg.min !== 'undefined' || typeof arg.max !== 'undefined' || typeof arg.default !== 'undefined'
            ? { min: arg.min, max: arg.max, default: arg.default }
            : undefined)
      ),
      defaultValue: arg.defaultValue,
    }))
    .filter((arg) => arg.name || arg.type || Object.keys(arg.validValues).length > 0);
}

function argumentHint(arg?: CommandArgument): string {
  if (!arg) return '<value>';
  const values = Array.isArray(arg.validValues?.values) ? (arg.validValues.values as unknown[]) : [];
  if (values.length) {
    const enums = values
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    if (enums.length) return `{${enums.join('|')}}`;
  }
  const t = (arg.type || '').toLowerCase();
  if (t.includes('int') || t.includes('nr1') || t.includes('integer')) return '<NR1>';
  if (t.includes('float') || t.includes('nrf') || t.includes('number')) return '<NRf>';
  return '<value>';
}

function extractCodeExamples(raw: Record<string, unknown>): CommandCodeExample[] {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const examplesRaw = Array.isArray(manual?.examples)
    ? (manual.examples as unknown[])
    : Array.isArray(raw.codeExamples)
      ? raw.codeExamples
      : [];
  if (!Array.isArray(examplesRaw)) return [];
  const result = examplesRaw
    .filter((ex): ex is Record<string, unknown> => !!ex && typeof ex === 'object')
    .map((ex) => {
      const nested =
        ex.codeExamples && typeof ex.codeExamples === 'object' && !Array.isArray(ex.codeExamples)
          ? (ex.codeExamples as Record<string, unknown>)
          : ex;
      const scpi = nested.scpi as Record<string, unknown> | undefined;
      const python = nested.python as Record<string, unknown> | undefined;
      const tmDevices = nested.tm_devices as Record<string, unknown> | undefined;
      const out: CommandCodeExample = {
        description: typeof ex.description === 'string' ? ex.description : '',
      };
      if (typeof scpi?.code === 'string' && scpi.code.trim()) {
        out.scpi = { code: scpi.code.trim() };
      }
      if (typeof python?.code === 'string' && python.code.trim()) {
        out.python = { code: python.code.trim() };
      }
      if (typeof tmDevices?.code === 'string' && tmDevices.code.trim()) {
        out.tm_devices = { code: tmDevices.code.trim() };
      }
      return out;
    })
    .filter((ex) => Boolean(ex.scpi?.code || ex.python?.code || ex.tm_devices?.code));

  // If no code examples extracted, try top-level example/examples
  if (result.length === 0) {
    // Try raw.examples array (MSO format: [{scpi: "CMD", description: "..."}])
    if (Array.isArray(raw.examples)) {
      raw.examples.forEach((ex: unknown) => {
        if (ex && typeof ex === 'object') {
          const exObj = ex as Record<string, unknown>;
          const scpiCode = typeof exObj.scpi === 'string' ? exObj.scpi.trim() : '';
          if (scpiCode) {
            result.push({
              description: typeof exObj.description === 'string' ? exObj.description : '',
              scpi: { code: scpiCode },
            });
          }
        }
      });
    }
    // Try raw.example string
    if (result.length === 0 && typeof raw.example === 'string' && raw.example.trim()) {
      result.push({
        description: '',
        scpi: { code: raw.example.trim() },
      });
    }
  }

  return result;
}

function extractStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function extractManualReference(raw: Record<string, unknown>): ManualReference | undefined {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const mrSource = manual?.manualReference || raw.manualReference;
  if (!mrSource || typeof mrSource !== 'object' || Array.isArray(mrSource)) {
    return undefined;
  }
  const mr = mrSource as Record<string, unknown>;
  const section = typeof mr.section === 'string' ? mr.section.trim() : '';
  const page = typeof mr.page === 'number' && Number.isFinite(mr.page) ? mr.page : undefined;
  if (!section && typeof page === 'undefined') return undefined;
  return {
    section: section || undefined,
    page,
  };
}

function extractCommandType(raw: Record<string, unknown>, header: string): CommandType {
  const explicit =
    (typeof raw.commandType === 'string' && raw.commandType) ||
    (typeof (raw._manualEntry as Record<string, unknown> | undefined)?.commandType === 'string'
      ? String((raw._manualEntry as Record<string, unknown>).commandType)
      : '');
  const normalized = explicit.toLowerCase();
  if (normalized === 'set' || normalized === 'query' || normalized === 'both') return normalized;

  const syntax = raw.syntax;
  if (syntax && typeof syntax === 'object' && !Array.isArray(syntax)) {
    const syn = syntax as Record<string, unknown>;
    const hasSet = typeof syn.set === 'string' && syn.set.trim().length > 0;
    const hasQuery = typeof syn.query === 'string' && syn.query.trim().length > 0;
    if (hasSet && hasQuery) return 'both';
    if (hasQuery) return 'query';
    if (hasSet) return 'set';
  }

  if (header.endsWith('?')) return 'query';
  return 'both';
}

function extractFamilyModel(raw: Record<string, unknown>, sourceFile: string): { families: string[]; models: string[] } {
  const instruments = raw.instruments as Record<string, unknown> | undefined;
  const families = Array.isArray(instruments?.families)
    ? (instruments?.families as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const models = Array.isArray(instruments?.models)
    ? (instruments?.models as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const hinted = SOURCE_FILE_FAMILY_HINTS[sourceFile] || [];
  return {
    families: Array.from(new Set([...families, ...hinted])),
    models: Array.from(new Set(models)),
  };
}

function extractTags(raw: Record<string, unknown>, group: string, sourceFile: string): string[] {
  const tags: string[] = [];
  if (Array.isArray(raw.mnemonics)) {
    raw.mnemonics.forEach((t) => {
      if (typeof t === 'string' && t.trim()) tags.push(t.trim());
    });
  }
  if (typeof raw.commandGroup === 'string' && raw.commandGroup.trim()) tags.push(raw.commandGroup.trim());
  if (group.trim()) tags.push(group.trim());
  tags.push(sourceFile.replace('.json', ''));
  return Array.from(new Set(tags));
}

class Bm25 {
  private readonly docs: string[];
  private readonly docLengths: number[];
  private readonly postings = new Map<string, Array<{ docIdx: number; tf: number }>>();
  private readonly avgDocLength: number;

  constructor(docs: string[]) {
    this.docs = docs;
    this.docLengths = new Array(docs.length).fill(0);
    let total = 0;
    docs.forEach((doc, docIdx) => {
      const tokens = normalizeText(doc);
      this.docLengths[docIdx] = tokens.length;
      total += tokens.length;
      const tf = new Map<string, number>();
      tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
      tf.forEach((count, token) => {
        const arr = this.postings.get(token) || [];
        arr.push({ docIdx, tf: count });
        this.postings.set(token, arr);
      });
    });
    this.avgDocLength = docs.length ? total / docs.length : 1;
  }

  search(query: string, limit: number): Array<{ index: number; score: number }> {
    const tokens = normalizeText(query);
    if (!tokens.length) return [];
    const N = this.docs.length || 1;
    const scores = new Map<number, number>();
    const k1 = 1.2;
    const b = 0.75;

    tokens.forEach((token) => {
      const posting = this.postings.get(token);
      if (!posting?.length) return;
      const df = posting.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      posting.forEach(({ docIdx, tf }) => {
        const dl = this.docLengths[docIdx] || 1;
        const numer = tf * (k1 + 1);
        const denom = tf + k1 * (1 - b + (b * dl) / this.avgDocLength);
        const score = idf * (numer / denom);
        scores.set(docIdx, (scores.get(docIdx) || 0) + score);
      });
    });

    return Array.from(scores.entries())
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));
  }
}

function familyMatches(entry: CommandRecord, family?: string): boolean {
  void entry;
  void family;
  return true;
}

function commandTypeMatches(entryType: CommandType, requested?: CommandType): boolean {
  if (!requested) return true;
  if (requested === 'both') return entryType === 'both';
  if (requested === 'set') return entryType === 'set' || entryType === 'both';
  if (requested === 'query') return entryType === 'query' || entryType === 'both';
  return true;
}

export class CommandIndex {
  private readonly entries: CommandRecord[];
  private readonly bm25: Bm25;
  private readonly byHeaderKey = new Map<string, number[]>();

  constructor(entries: CommandRecord[]) {
    this.entries = entries;
    const docs = entries.map((entry) =>
      [
        entry.header,
        entry.shortDescription,
        entry.shortDescription, // weight semantic intent heavier in BM25 ranking
        GROUP_DESCRIPTIONS[entry.group] || '',
        entry.description,
        entry.category,
        entry.tags.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
    );
    this.bm25 = new Bm25(docs);
    entries.forEach((entry, idx) => {
      const keys = expandHeaderKeys(entry.header);
      keys.forEach((key) => {
        const list = this.byHeaderKey.get(key) || [];
        list.push(idx);
        this.byHeaderKey.set(key, list);
      });
      const normalized = normalizeHeaderKey(entry.header);
      if (normalized) {
        const list = this.byHeaderKey.get(normalized) || [];
        if (!list.includes(idx)) list.push(idx);
        this.byHeaderKey.set(normalized, list);
      }
    });
  }

  getByHeader(header: string, family?: string): CommandRecord | null {
    const selectCandidate = (indexes: number[]): CommandRecord | null => {
      const candidates = indexes
        .map((idx) => this.entries[idx])
        .filter((entry) => familyMatches(entry, family))
        .sort((a, b) => `${a.sourceFile}:${a.commandId}`.localeCompare(`${b.sourceFile}:${b.commandId}`));
      return candidates[0] || null;
    };

    const exactKey = normalizeHeaderKey(header);
    const exact = selectCandidate(this.byHeaderKey.get(exactKey) || []);
    if (exact) return exact;

    const placeholderKey = stripPlaceholdersFromKey(exactKey);
    if (placeholderKey && placeholderKey !== exactKey) {
      const placeholder = selectCandidate(this.byHeaderKey.get(placeholderKey) || []);
      if (placeholder) return placeholder;
    }

    const digitKey = stripTrailingDigitsFromKey(placeholderKey || exactKey);
    if (digitKey && digitKey !== exactKey && digitKey !== placeholderKey) {
      const digitCandidates = (this.byHeaderKey.get(digitKey) || [])
        .map((idx) => this.entries[idx])
        .filter((entry) => familyMatches(entry, family))
        .sort((a, b) => `${a.sourceFile}:${a.commandId}`.localeCompare(`${b.sourceFile}:${b.commandId}`));
      const inputRoot = rootTokenForSafety(header);
      const safe = digitCandidates.find((candidate) => rootTokenForSafety(candidate.header) === inputRoot);
      if (safe) return safe;
    }

    return null;
  }
  searchByQuery(query: string, family?: string, limit = 10, commandType?: CommandType): CommandRecord[] {
    const scored = this.bm25.search(query, Math.max(limit * 4, 25));
    const q = query.toLowerCase();
    const wantsFastframeCount =
      q.includes('fastframe') && /(count|frames|frame|number)/.test(q);
    const reranked = scored
      .map((item) => {
        const entry = this.entries[item.index];
        if (!entry) return item;
        let bonus = 0;
        if (wantsFastframeCount) {
          const h = entry.header.toLowerCase();
          if (h.includes('fastframe:count')) bonus += 50;
          if (h.includes('sixteenbit')) bonus -= 8;
        }
        return { ...item, score: item.score + bonus };
      })
      .sort((a, b) => b.score - a.score);
    const results: CommandRecord[] = [];
    const seen = new Set<string>();
    for (const item of reranked) {
      const entry = this.entries[item.index];
      if (!entry) continue;
      if (!familyMatches(entry, family)) continue;
      if (!commandTypeMatches(entry.commandType, commandType)) continue;
      const key = `${entry.sourceFile}:${entry.commandId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(entry);
      if (results.length >= limit) break;
    }
    return results;
  }

  size(): number {
    return this.entries.length;
  }

  getAllHeaders(): string[] {
    return this.entries.map((e) => e.header);
  }

  getByHeaderPrefix(header: string, family?: string): CommandRecord | null {
    const h = header.toLowerCase();
    const candidate = this.entries.find((e) => e.header.toLowerCase().startsWith(h) && familyMatches(e, family));
    return candidate || null;
  }
}

function toCommandRecord(
  raw: Record<string, unknown>,
  sourceFile: string,
  group: string
): CommandRecord | null {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  let header = extractHeader(raw);
  if (!header) return null;
  const description =
    (typeof raw.description === 'string' && raw.description) ||
    (typeof manual?.description === 'string' && manual.description) ||
    (typeof raw.shortDescription === 'string' && raw.shortDescription) ||
    '';
  const shortDescription = extractShortDescription(raw);
  const category = (typeof raw.category === 'string' && raw.category) || group || 'general';
  const commandId =
    (typeof manual?.command === 'string' && manual.command) ||
    (typeof raw.id === 'string' && raw.id) ||
    (typeof manual?.header === 'string' && manual.header) ||
    (typeof raw.header === 'string' && raw.header) ||
    header;
  const { families, models } = extractFamilyModel(raw, sourceFile);
  const syntax = extractSyntax(raw);
  const args = extractArguments(raw);
  if (!syntax.set && !syntax.query) {
    const scpi = (typeof raw.scpi === 'string' && raw.scpi.trim()) || header;
    const hint = argumentHint(args[0]);
    if (scpi.endsWith('?')) {
      syntax.query = scpi;
    } else {
      syntax.set = args.length ? `${scpi} ${hint}` : scpi;
      syntax.query = `${scpi}?`;
    }
  }
  if (syntax.set && !/\s/.test(syntax.set) && args.length) {
    syntax.set = `${syntax.set} ${argumentHint(args[0])}`;
  }
  if (!header.includes(':')) {
    const candidate = (syntax.set || syntax.query || '')
      .match(/^[*A-Za-z][A-Za-z0-9:*]*\??/)?.[0]
      ?.trim();
    if (candidate && candidate.includes(':')) {
      header = candidate;
    }
  }
  const mnemonics = extractStringArray(manual?.mnemonics);
  return {
    commandId,
    sourceFile,
    group,
    header,
    shortDescription,
    description,
    category,
    tags: Array.from(new Set([...extractTags(raw, group, sourceFile), ...mnemonics])),
    commandType: extractCommandType((manual || raw) as Record<string, unknown>, header),
    families,
    models,
    syntax,
    arguments: args,
    queryResponse: typeof raw.queryResponse === 'string' ? raw.queryResponse : undefined,
    codeExamples: extractCodeExamples(raw),
    relatedCommands: extractStringArray(manual?.relatedCommands || raw.relatedCommands),
    notes: extractStringArray(manual?.notes || raw.notes),
    manualReference: extractManualReference(raw),
    raw,
  };
}

function parseGroupedCommands(sourceFile: string, root: Record<string, unknown>): CommandRecord[] {
  const out: CommandRecord[] = [];
  const groups = root.groups as Record<string, unknown> | undefined;
  if (!groups || typeof groups !== 'object') return out;
  Object.entries(groups).forEach(([groupName, groupRaw]) => {
    const groupObj = groupRaw as Record<string, unknown>;
    const commands = Array.isArray(groupObj?.commands) ? (groupObj.commands as unknown[]) : [];
    commands.forEach((cmd) => {
      if (!cmd || typeof cmd !== 'object') return;
      const rec = toCommandRecord(cmd as Record<string, unknown>, sourceFile, groupName);
      if (rec) out.push(rec);
    });
  });
  return out;
}

function parseSectionedCommands(sourceFile: string, root: Record<string, unknown>): CommandRecord[] {
  const out: CommandRecord[] = [];
  const sections = root.commands_by_section as Record<string, unknown> | undefined;
  if (!sections || typeof sections !== 'object') return out;
  Object.entries(sections).forEach(([sectionName, sectionRaw]) => {
    if (!Array.isArray(sectionRaw)) return;
    sectionRaw.forEach((cmd) => {
      if (!cmd || typeof cmd !== 'object') return;
      const rec = toCommandRecord(cmd as Record<string, unknown>, sourceFile, sectionName);
      if (rec) out.push(rec);
    });
  });
  return out;
}

function parseFlatCommands(sourceFile: string, root: unknown): CommandRecord[] {
  if (!Array.isArray(root)) return [];
  return root
    .filter((cmd): cmd is Record<string, unknown> => !!cmd && typeof cmd === 'object')
    .map((cmd) => toCommandRecord(cmd, sourceFile, 'general'))
    .filter((rec): rec is CommandRecord => rec !== null);
}

export async function loadCommandIndex(options?: {
  commandsDir?: string;
  files?: string[];
}): Promise<CommandIndex> {
  const commandsDir = options?.commandsDir || resolveCommandsDir();
  const files = options?.files && options.files.length ? options.files : DEFAULT_COMMAND_FILES;
  const all: CommandRecord[] = [];

  for (const file of files) {
    const fullPath = path.join(commandsDir, file);
    let rawText = '';
    try {
      rawText = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(rawText) as unknown;
    } catch {
      continue;
    }
    const grouped = parseGroupedCommands(file, json as Record<string, unknown>);
    if (grouped.length) {
      all.push(...grouped);
      continue;
    }
    const sectioned = parseSectionedCommands(file, json as Record<string, unknown>);
    if (sectioned.length) {
      all.push(...sectioned);
      continue;
    }
    const flat = parseFlatCommands(file, json);
    if (flat.length) {
      all.push(...flat);
    }
  }

  return new CommandIndex(all);
}

let _commandIndexPromise: Promise<CommandIndex> | null = null;

export function initCommandIndex(options?: {
  commandsDir?: string;
  files?: string[];
}): Promise<CommandIndex> {
  if (!_commandIndexPromise) {
    _commandIndexPromise = loadCommandIndex(options);
  }
  return _commandIndexPromise;
}

export async function getCommandIndex(): Promise<CommandIndex> {
  return initCommandIndex();
}

