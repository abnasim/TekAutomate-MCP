import { getCommandIndex, type CommandType } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface SearchScpiInput {
  query: string;
  modelFamily?: string;
  limit?: number;
  commandType?: CommandType;
}

function headerCandidates(raw: string): string[] {
  const q = raw.trim();
  if (!q) return [];
  const candidates = new Set<string>([q]);
  candidates.add(q.replace(/\?$/, ''));
  candidates.add(q.replace(/:MEAS\d+/gi, ':MEAS<x>'));
  candidates.add(q.replace(/:SOURCE\d+/gi, ':SOURCE'));
  candidates.add(q.replace(/:RESUlts\d+/gi, ':RESUlts'));
  return Array.from(candidates).filter(Boolean);
}

function thinResult(entry: {
  commandId: string;
  sourceFile: string;
  header: string;
  commandType: CommandType;
  shortDescription: string;
  syntax: { set?: string; query?: string };
  codeExamples: Array<{
    scpi?: { code: string };
    python?: { code: string };
    tm_devices?: { code: string };
  }>;
  arguments: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    validValues: Record<string, unknown>;
    defaultValue?: unknown;
  }>;
  notes: string[];
}) {
  const ex = entry.codeExamples?.[0];
  const firstValidValues = entry.arguments?.[0]?.validValues as Record<string, unknown> | undefined;
  const normalizedValues =
    (Array.isArray(firstValidValues?.values) ? (firstValidValues.values as unknown[]) : undefined) ||
    (Array.isArray(firstValidValues?.options) ? (firstValidValues.options as unknown[]) : undefined);
  const argumentsPreview = Array.isArray(entry.arguments)
    ? entry.arguments.slice(0, 6).map((arg) => ({
        name: arg.name,
        type: arg.type,
        required: arg.required,
        description: arg.description,
        defaultValue: arg.defaultValue,
        validValues: arg.validValues,
      }))
    : [];
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: entry.shortDescription,
    syntax: entry.syntax,
    example: ex
      ? {
          scpi: ex.scpi?.code,
          python: ex.python?.code,
          tm_devices: ex.tm_devices?.code,
        }
      : undefined,
    validValues: normalizedValues
      ? normalizedValues.filter((v): v is string => typeof v === 'string')
      : undefined,
    validValuesRaw: firstValidValues,
    arguments: argumentsPreview.length ? argumentsPreview : undefined,
    notes: entry.notes?.length ? entry.notes : undefined,
  };
}

export async function searchScpi(input: SearchScpiInput): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getCommandIndex();
  const limit = input.limit || 10;
  const searchEntries = index.searchByQuery(q, input.modelFamily, limit, input.commandType);

  const headerLike = q.includes(':') || q.startsWith('*');
  const directEntries = headerLike
    ? headerCandidates(q)
        .map((h) => index.getByHeader(h, input.modelFamily))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
    : [];

  const merged: typeof searchEntries = [];
  const seen = new Set<string>();
  for (const entry of [...directEntries, ...searchEntries]) {
    const key = `${entry.sourceFile}:${entry.commandId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
    if (merged.length >= limit) break;
  }

  return {
    ok: true,
    data: merged.map((e) => thinResult(e)),
    sourceMeta: merged.map((e) => ({
      file: e.sourceFile,
      commandId: e.commandId,
      section: e.group,
    })),
    warnings: merged.length ? [] : ['No commands matched query'],
  };
}
