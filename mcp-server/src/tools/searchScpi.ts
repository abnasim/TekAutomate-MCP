import { getCommandIndex, type CommandType, type CommandRecord } from '../core/commandIndex';
import { classifyIntent } from '../core/intentMap';
import { buildMeasurementSearchPlan } from '../core/measurementCatalog';
import type { ToolResult } from '../core/schemas';
import { serializeCommandResult } from './commandResultShape';

interface SearchScpiInput {
  query: string;
  modelFamily?: string;
  limit?: number;
  commandType?: CommandType;
}

// ── Group-aware penalty ──────────────────────────────────────────────
// Penalize commands from groups that don't match the query's intent.
// Fixes POWer:ADDNew showing up for "edge trigger level", "FastFrame", etc.
const GROUP_PENALTY_MAP: Record<string, Set<string>> = {
  trigger: new Set(['Trigger']),
  measurement: new Set(['Measurement']),
  power: new Set(['Power', 'Digital Power Management']),
  bus: new Set(['Bus', 'Trigger']),
  vertical: new Set(['Vertical']),
  horizontal: new Set(['Horizontal', 'Acquisition']),
  display: new Set(['Display', 'Cursor']),
  save: new Set(['Save and Recall', 'File System', 'Save on']),
  acquisition: new Set(['Acquisition', 'Horizontal']),
  math: new Set(['Math', 'Spectrum view']),
  mask: new Set(['Mask']),
  search: new Set(['Search and Mark']),
  digital: new Set(['Digital']),
  dvm: new Set(['DVM']),
  dpm: new Set(['Digital Power Management']),
  imda: new Set(['Inverter Motors and Drive Analysis']),
  wbg: new Set(['Wide Band Gap Analysis (WBG)']),
  misc: new Set(['Miscellaneous', 'Status and Error']),
  status: new Set(['Status and Error', 'Miscellaneous']),
};

const STRONGLY_PENALIZED_GROUPS = new Set([
  'Power', 'Digital Power Management', 'Inverter Motors and Drive Analysis',
  'Wide Band Gap Analysis (WBG)', 'AFG',
]);

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

/**
 * Re-rank search results using intent classification and group-aware scoring.
 * Uses the same classifyIntent() as smart_scpi_lookup so both paths converge.
 */
function reRankWithIntent(
  results: CommandRecord[],
  query: string,
): CommandRecord[] {
  if (results.length <= 1) return results;

  const intent = classifyIntent(query);
  const intentGroups = GROUP_PENALTY_MAP[intent.intent];
  const queryLower = query.toLowerCase();
  const wantsPower = /\b(power|wbg|dpm|switching|inductance|magnetic|efficiency|harmonics|soa)\b/i.test(queryLower);

  const scored = results.map((cmd) => {
    let score = 0;
    const cmdGroup = cmd.group || '';

    // Group affinity boost/penalty
    if (intentGroups) {
      if (intentGroups.has(cmdGroup)) {
        score += 20;
      } else if (STRONGLY_PENALIZED_GROUPS.has(cmdGroup) && !wantsPower) {
        score -= 50;
      } else {
        score -= 10;
      }
    }

    // Header keyword matching
    const headerLower = cmd.header.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    for (const word of queryWords) {
      if (headerLower.includes(word)) score += 8;
    }

    // Subject matching
    const subjectWords = intent.subject.split(/[_\s]+/).filter(w => w.length > 1);
    for (const word of subjectWords) {
      if (headerLower.includes(word.toLowerCase())) score += 12;
    }

    // Exact SCPI-style match boost
    if (queryLower.includes(':') && headerLower.includes(queryLower.replace(/\?$/, ''))) {
      score += 50;
    }

    // POWer:ADDNew specific penalty for non-power queries
    if (headerLower === 'power:addnew' && !wantsPower) {
      score -= 40;
    }

    return { cmd, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.cmd);
}

export async function searchScpi(input: SearchScpiInput): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getCommandIndex();
  const limit = input.limit || 10;
  const measurementPlan = buildMeasurementSearchPlan(q);

  // Fetch more candidates than needed so re-ranking has room to work
  const fetchLimit = Math.max(limit * 3, 20);
  const searchEntries = index.searchByQuery(q, input.modelFamily, fetchLimit, input.commandType);

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

  // Merge and dedup all candidates
  const merged: CommandRecord[] = [];
  const seen = new Set<string>();
  for (const entry of [...measurementDirectEntries, ...directEntries, ...measurementSearchEntries, ...searchEntries]) {
    const key = `${entry.sourceFile}:${entry.commandId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  // Re-rank using intent classification and group-aware scoring
  const reRanked = reRankWithIntent(merged, q);
  const final = reRanked.slice(0, limit);

  return {
    ok: true,
    data: final.map((e) => serializeCommandResult(e)),
    sourceMeta: final.map((e) => ({
      file: e.sourceFile,
      commandId: e.commandId,
      section: e.group,
    })),
    warnings: final.length ? [] : ['No commands matched query'],
  };
}
