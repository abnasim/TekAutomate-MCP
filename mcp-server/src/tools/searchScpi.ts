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

// ── Group affinity map ───────────────────────────────────────────────
// Maps intent → groups that SHOULD appear in results.
// Everything else gets penalized.
const GROUP_AFFINITY: Record<string, Set<string>> = {
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

// Groups that should NEVER appear for non-matching intents
const HARD_PENALIZED_GROUPS = new Set([
  'Power', 'Digital Power Management', 'Inverter Motors and Drive Analysis',
  'Wide Band Gap Analysis (WBG)', 'AFG',
]);

// Groups that are noisy — they contain "trigger" or "search" keywords
// but are NOT the primary Trigger or Search group
const NOISY_GROUPS_FOR_TRIGGER = new Set([
  'Search and Mark', 'Bus',
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
 *
 * The key insight: BM25 returns commands that mention query keywords anywhere
 * (header, description, tags). But "edge trigger level" should return
 * TRIGger:A:EDGE:LEVel, not SEARCH:SEARCH<x>:TRIGger:A:BUS:CPHY:...
 * even though both mention "trigger" in their header.
 *
 * We fix this by:
 * 1. Boosting commands in the correct group (+25)
 * 2. Hard-penalizing commands from wrong specialty groups (-60)
 * 3. Penalizing noisy cross-group matches (-30 for Search/Bus when intent is Trigger)
 * 4. Boosting header TOKEN matches (not just substring) for query words
 * 5. Penalizing deeply nested headers (SEARCH:SEARCH<x>:TRIGger:A:BUS:CPHY:... is 8 tokens deep)
 */
function reRankWithIntent(
  results: CommandRecord[],
  query: string,
): CommandRecord[] {
  if (results.length <= 1) return results;

  const intent = classifyIntent(query);
  const affinityGroups = GROUP_AFFINITY[intent.intent];
  const queryLower = query.toLowerCase();
  const wantsPower = /\b(power|wbg|dpm|switching|inductance|magnetic|efficiency|harmonics|soa)\b/i.test(queryLower);

  // Split query into meaningful words for token matching
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  const subjectWords = intent.subject.split(/[_\s]+/).filter(w => w.length > 1);

  const scored = results.map((cmd) => {
    let score = 0;
    const cmdGroup = cmd.group || '';
    const headerLower = cmd.header.toLowerCase();
    const headerTokens = headerLower.replace(/[{}<>?|]/g, '').split(/[:\s]+/).filter(Boolean);

    // ── 1. Group affinity ──
    if (affinityGroups) {
      if (affinityGroups.has(cmdGroup)) {
        score += 25;  // Right group
      } else if (HARD_PENALIZED_GROUPS.has(cmdGroup) && !wantsPower) {
        score -= 60;  // Specialty group, definitely wrong
      } else if (intent.intent === 'trigger' && NOISY_GROUPS_FOR_TRIGGER.has(cmdGroup)) {
        score -= 30;  // Search/Bus commands with "trigger" in path — noisy
      } else {
        score -= 15;  // Wrong group, mild penalty
      }
    }

    // ── 2. Header TOKEN matching (not just substring) ──
    // "edge" matching "EDGE" as a token in TRIGger:A:EDGE:SLOpe (+10)
    // vs "edge" as substring in some description (+0)
    for (const word of queryWords) {
      if (headerTokens.some(t => t === word || t.startsWith(word) || word.startsWith(t))) {
        score += 10;  // Direct header token match
      }
    }
    for (const word of subjectWords) {
      const wordLower = word.toLowerCase();
      if (headerTokens.some(t => t === wordLower || t.startsWith(wordLower) || wordLower.startsWith(t))) {
        score += 15;  // Subject token match (higher weight)
      }
    }

    // ── 3. Header depth penalty ──
    // Short headers like TRIGger:A:EDGE:LEVel (4 tokens) are more likely what the user wants
    // than SEARCH:SEARCH<x>:TRIGger:A:BUS:CPHY:DATa:VALue (8 tokens)
    if (headerTokens.length > 6) {
      score -= (headerTokens.length - 6) * 3;  // -3 per extra token beyond 6
    }

    // ── 4. Exact SCPI-style match boost ──
    if (queryLower.includes(':') && headerLower.includes(queryLower.replace(/\?$/, ''))) {
      score += 50;
    }

    // ── 5. POWer:ADDNew specific penalty ──
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
  const fetchLimit = Math.max(limit * 4, 30);
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
