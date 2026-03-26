import { getCommandIndex, type CommandType } from '../core/commandIndex';
import { buildMeasurementSearchPlan } from '../core/measurementCatalog';
import type { ToolResult } from '../core/schemas';
import { serializeCommandResult } from './commandResultShape';

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
  candidates.add(q.replace(/\bCH\d+_D\d+\b/gi, 'CH<x>_D<x>'));
  candidates.add(q.replace(/\bCH\d+\b/gi, 'CH<x>'));
  candidates.add(q.replace(/\bREF\d+\b/gi, 'REF<x>'));
  candidates.add(q.replace(/\bMATH\d+\b/gi, 'MATH<x>'));
  candidates.add(q.replace(/\bBUS\d+\b/gi, 'BUS<x>'));
  candidates.add(q.replace(/:MEAS\d+/gi, ':MEAS<x>'));
  candidates.add(q.replace(/\bMEAS\d+\b/gi, 'MEAS<x>'));
  candidates.add(q.replace(/:SOURCE\d+/gi, ':SOURCE'));
  candidates.add(q.replace(/\bSOURCE\d+\b/gi, 'SOURCE'));
  candidates.add(q.replace(/\bEDGE\d+\b/gi, 'EDGE'));
  candidates.add(q.replace(/\bREFLEVELS\d+\b/gi, 'REFLevels'));
  candidates.add(q.replace(/:RESUlts\d+/gi, ':RESUlts'));
  return Array.from(candidates).filter(Boolean);
}

export async function searchScpi(input: SearchScpiInput): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getCommandIndex();
  const limit = input.limit || 10;
  const measurementPlan = buildMeasurementSearchPlan(q);
  const searchEntries = index.searchByQuery(q, input.modelFamily, limit, input.commandType);

  const headerLike = q.includes(':') || q.startsWith('*');
  const directEntries = headerLike
    ? headerCandidates(q)
        .map((h) => index.getByHeader(h, input.modelFamily))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
    : [];
  const measurementDirectEntries = measurementPlan
    ? measurementPlan.exactHeaders
        .map((h) => index.getByHeader(h, input.modelFamily))
        .filter((v): v is NonNullable<typeof v> => Boolean(v))
    : [];
  const measurementSearchEntries = measurementPlan
    ? measurementPlan.searchTerms.flatMap((term) => index.searchByQuery(term, input.modelFamily, 4, input.commandType))
    : [];

  const merged: typeof searchEntries = [];
  const seen = new Set<string>();
  for (const entry of [...measurementDirectEntries, ...directEntries, ...measurementSearchEntries, ...searchEntries]) {
    const key = `${entry.sourceFile}:${entry.commandId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
    if (merged.length >= limit) break;
  }

  return {
    ok: true,
    data: merged.map((e) => serializeCommandResult(e)),
    sourceMeta: merged.map((e) => ({
      file: e.sourceFile,
      commandId: e.commandId,
      section: e.group,
    })),
    warnings: merged.length ? [] : ['No commands matched query'],
  };
}
