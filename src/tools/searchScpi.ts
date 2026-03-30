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
    // Keep original-case tokens for SCPI mnemonic matching
    const headerTokensRaw = cmd.header.replace(/[{}<>?|]/g, '').split(/[:\s]+/).filter(Boolean);
    const headerTokens = headerTokensRaw.map(t => t.toLowerCase());

    // Also extract SCPI argument names/values from the command record
    const argNames = (cmd.arguments || []).map(a => a.name.toLowerCase());
    const argDescriptions = (cmd.arguments || []).map(a => a.description.toLowerCase()).join(' ');

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

    // ── 2. SCPI mnemonic-aware token matching ──
    // SCPI uses mixed-case mnemonics: LEVel, SLOpe, SOUrce, FREQuency
    // The uppercase part is the abbreviation. We match query words against:
    //   - Full token lowercase: "level" matches "level" in "LEVel"
    //   - SCPI abbreviation: extract uppercase chars → "LEV" from "LEVel"
    //   - startsWith in both directions
    // This is a BIG improvement — "level" now matches LEVel in TRIGger:A:LEVel
    // even when the BM25 raw header is "trigger:a:level:ch<x>"

    const scpiAbbreviations = headerTokensRaw.map(t => {
      // Extract uppercase letters as the SCPI abbreviation
      const upper = t.replace(/[^A-Z]/g, '');
      return upper.length >= 2 ? upper.toLowerCase() : t.toLowerCase();
    });

    let tokenMatchCount = 0;
    for (const word of queryWords) {
      const matched = headerTokens.some(t => t === word || t.startsWith(word) || word.startsWith(t))
        || scpiAbbreviations.some(a => a === word || a.startsWith(word) || word.startsWith(a))
        || argNames.some(a => a === word || a.startsWith(word));
      if (matched) {
        score += 10;
        tokenMatchCount++;
      }
    }
    for (const word of subjectWords) {
      const wordLower = word.toLowerCase();
      const matched = headerTokens.some(t => t === wordLower || t.startsWith(wordLower) || wordLower.startsWith(t))
        || scpiAbbreviations.some(a => a === wordLower || a.startsWith(wordLower) || wordLower.startsWith(a));
      if (matched) {
        score += 15;
        tokenMatchCount++;
      }
    }
    // Bonus for matching MULTIPLE query words (compound match = better fit)
    if (tokenMatchCount >= 3) score += 12;
    else if (tokenMatchCount >= 2) score += 6;

    // ── Focus word boost ──
    // The last meaningful word in the query is usually the most specific part.
    // "edge trigger level" → focus is "level", not "edge" or "trigger"
    // "save waveform to usb" → focus is "waveform" (skip stop words like "to", "usb")
    const focusWord = queryWords.filter(w => !['to', 'the', 'a', 'an', 'on', 'in', 'for', 'of', 'with'].includes(w)).pop();
    if (focusWord) {
      const focusMatched = headerTokens.some(t => t === focusWord || t.startsWith(focusWord) || focusWord.startsWith(t))
        || scpiAbbreviations.some(a => a === focusWord || a.startsWith(focusWord) || focusWord.startsWith(a));
      if (focusMatched) {
        score += 12;  // Strong boost for matching the focus word
      }
    }

    // ── 3. Header depth/simplicity preference ──
    // Shorter headers are usually the primary command, longer ones are sub-settings.
    // Graduated bonus: fewer tokens = more likely to be the main command.
    const tokenBonus = Math.max(0, 12 - headerTokens.length * 2);  // 2 tokens=+8, 3=+6, 4=+4, 5=+2, 6+=0
    score += tokenBonus;

    // ── 4. Prefer TRIGger:A over TRIGger:B and RESET variants ──
    if (intent.intent === 'trigger') {
      if (headerLower.includes('trigger:a:') || headerLower.includes('trigger:{a|b}')) {
        score += 10;  // Primary trigger
      }
      if (headerLower.includes('trigger:b:') && !headerLower.includes('{a|b}')) {
        score -= 15;  // Secondary trigger — user almost never means B specifically
      }
      if (headerLower.includes(':reset:')) {
        score -= 20;  // RESET is a sub-variant of trigger B, rarely wanted
      }
    }

    // ── 5. Prefer STATE/enable commands for feature queries ──
    if (headerTokens.some(t => t === 'state' || t === 'enable')) {
      score += 5;
    }

    // ── 5b. Subject-specific header boosts ──
    // zone_trigger → VISual:* commands, not SEARCH:* or TRIGger:*
    // This needs to be DOMINANT because BM25 scores for CPHY/bus commands are very high
    if (intent.subject === 'zone_trigger') {
      if (headerLower.startsWith('visual')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // trigger_level → commands with LEVel in header
    if (intent.subject === 'trigger_level') {
      if (headerTokens.some(t => t === 'level' || t.startsWith('lev'))) {
        score += 20;
      }
    }
    // trigger_slope → commands with SLOpe in header
    if (intent.subject === 'trigger_slope') {
      if (headerTokens.some(t => t === 'slope' || t.startsWith('slo'))) {
        score += 20;
      }
    }

    // spectrum_view → SV:* commands
    if (intent.subject === 'spectrum_view') {
      if (headerLower.startsWith('sv:') || headerLower.includes(':sv:')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // eye_diagram → Measurement eye/jitter commands, not RSA/audio
    if (intent.subject === 'eye_diagram') {
      if (headerLower.includes('measurement') || headerLower.includes('eyemask')) {
        score += 20;
      }
      // Penalize RSA/audio/DPX commands
      if (headerLower.includes('fetch:') || headerLower.includes('read:') || headerLower.includes('audio')) {
        score -= 50;
      }
    }
    // power_harmonics → POWer:* HARMONICS commands, not audio THD
    if (intent.subject === 'power_harmonics') {
      if (headerLower.includes('power') && headerLower.includes('harmonics')) {
        score += 40;
      } else if (headerLower.startsWith('power:')) {
        score += 15;
      }
      if (headerLower.includes('audio') || headerLower.includes('fetch:')) {
        score -= 50;
      }
    }

    // power_soa → POWer:*:SOA commands
    if (intent.subject === 'power_soa') {
      if (headerLower.includes('soa')) {
        score += 60;
      } else if (headerLower.startsWith('power:')) {
        score += 10;
      } else {
        score -= 30;
      }
    }
    // afg → AFG:* commands, not measurement frequency
    if (intent.subject === 'afg') {
      if (headerLower.startsWith('afg:')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // histogram_box → HIStogram:BOX commands
    if (intent.subject === 'histogram_box') {
      if (headerLower.includes('histogram') || headerLower.includes('hist')) {
        score += 40;
      } else {
        score -= 20;
      }
    }

    // dvm → DVM:* commands, not measurement RMS
    if (intent.subject === 'dvm') {
      if (headerLower.startsWith('dvm')) {
        score += 80;
      } else {
        score -= 40;
      }
    }
    // dphy/cphy → BUS:B<x>:DPHY/CPHY commands
    if (intent.subject === 'dphy' || intent.subject === 'cphy') {
      const proto = intent.subject.toUpperCase();
      if (headerLower.includes(proto.toLowerCase())) {
        score += 40;
      }
      if (headerLower.startsWith('bus:')) {
        score += 15;
      }
    }
    // rise_time → measurement commands, penalize SEARCH timeout
    if (intent.subject === 'rise_time') {
      if (headerLower.includes('measurement') || headerLower.includes('addmeas')) {
        score += 20;
      }
      if (headerLower.startsWith('search:')) {
        score -= 20;
      }
    }

    // statistics + "badge" in query → DISPlaystat commands
    if (intent.subject === 'statistics' && /badge/i.test(queryLower)) {
      if (headerLower.includes('displaystat')) {
        score += 40;
      }
    }

    // bus intent → prefer TRIGger:A:BUS over SEARCH:SEARCH<x>:TRIGger:A:BUS
    if (intent.intent === 'bus') {
      if (headerLower.startsWith('trigger:') || headerLower.startsWith('trigger:{')) {
        score += 10;
      }
      if (headerLower.startsWith('search:search')) {
        score -= 10;
      }
      if (headerLower.startsWith('bus:')) {
        score += 15;
      }
    }

    // waveform_transfer → WFMOutpre/DATa/CURVe commands, not trigger
    if (intent.subject === 'waveform_transfer') {
      if (headerLower.includes('wfmoutpre') || headerLower.includes('data:') || headerLower.startsWith('curve')) {
        score += 40;
      }
      if (headerLower.includes('trigger')) {
        score -= 30;
      }
    }
    // dpm → DPM-specific measurement commands
    if (intent.subject === 'dpm') {
      if (headerLower.includes('dpm')) {
        score += 30;
      }
    }

    // ── 6. Exact SCPI-style match boost ──
    if (queryLower.includes(':') && headerLower.includes(queryLower.replace(/\?$/, ''))) {
      score += 50;
    }

    // ── 7. POWer:ADDNew specific penalty ──
    if (headerLower === 'power:addnew' && !wantsPower) {
      score -= 40;
    }

    // ── 8. RSA/Audio command penalty ──
    // RSA spectrum analyzer and audio commands pollute scope queries.
    // Only show them when explicitly asked for RSA/audio.
    const wantsRsa = /\b(rsa|audio|spectrum\s*anal)/i.test(queryLower);
    if (!wantsRsa) {
      const isRsaAudio = headerLower.startsWith('fetch:') || headerLower.startsWith('read:')
        || headerLower.startsWith('[sense]') || headerLower.includes(':audio:')
        || headerLower.includes(':ofdm:') || headerLower.includes(':dpx:');
      if (isRsaAudio) {
        score -= 60;
      }
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

  // ── Query expansion for terms that don't match SCPI keywords ──
  // "zone trigger" → SCPI uses "VISual" not "zone"
  // "screenshot" → SCPI uses "SAVe:IMAGe" not "screenshot"
  const QUERY_EXPANSIONS: Array<{ pattern: RegExp; expand: string }> = [
    { pattern: /\bzone\s*trigger/i, expand: 'VISual AREA trigger zone' },
    { pattern: /\bvisual\s*trigger/i, expand: 'VISual AREA trigger' },
    { pattern: /\bscreenshot/i, expand: 'SAVe IMAGe screenshot' },
    { pattern: /\bbaud\s*rate/i, expand: 'BITRate baud rate' },
    { pattern: /\brecord\s*length/i, expand: 'RECOrdlength horizontal record' },
    { pattern: /\bsample\s*rate/i, expand: 'SAMPLERate sample rate horizontal' },
    { pattern: /\barinc\s*429/i, expand: 'ARINC429A arinc bus' },
    { pattern: /\bmil.?std.?1553|mil.?1553/i, expand: 'MIL1553B mil bus' },
    { pattern: /\bstandard\s*dev/i, expand: 'STATIstics statistics STDDev measurement' },
    { pattern: /\bbadge\b.*\bstat/i, expand: 'DISPlaystat ENABle measurement badge statistics' },
    { pattern: /\bstat.*\bbadge/i, expand: 'DISPlaystat ENABle measurement badge statistics' },
    { pattern: /\bbadge/i, expand: 'DISPlaystat badge measurement display' },
  ];
  let expandedQuery = q;
  for (const { pattern, expand } of QUERY_EXPANSIONS) {
    if (pattern.test(q)) {
      expandedQuery = `${q} ${expand}`;
      break;
    }
  }

  // Fetch more candidates than needed so re-ranking has room to work
  const fetchLimit = Math.max(limit * 4, 30);
  // Search with both original and expanded queries
  let searchEntries = index.searchByQuery(expandedQuery, input.modelFamily, fetchLimit, input.commandType);
  if (expandedQuery !== q) {
    // Also search original to not lose direct matches
    const originalEntries = index.searchByQuery(q, input.modelFamily, fetchLimit, input.commandType);
    searchEntries = [...searchEntries, ...originalEntries];
  }

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

  // ── Intent-based header injection ──
  // When BM25 can't find the right commands (no keyword overlap between
  // natural language and SCPI headers), inject known headers directly.
  // This is extensible — add entries as you discover gaps.
  const INTENT_HEADER_INJECTIONS: Record<string, string[]> = {
    zone_trigger: [
      'VISual:ENABLE', 'VISual:AREA<x>:SHAPE', 'VISual:AREA<x>:SOUrce',
      'VISual:AREA<x>:HITType', 'VISual:AREA<x>:HEIGht', 'VISual:AREA<x>:VERTICES',
      'VISual:AREA<x>:RESET', 'VISual:AREA<x>:ROTAtion',
    ],
    spectrum_view: [
      'SV:CENTERFrequency', 'SV:SPAN', 'SV:RBW', 'SV:WINDOW',
      'SV:SPANRBWRatio', 'CH<x>:SV:STATE', 'CH<x>:SV:CENTERFrequency',
    ],
    eye_diagram: [
      'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN?',
      'MEASUrement:ADDMEAS', 'MEASUrement:ENABLEPjitter',
    ],
    power_harmonics: [
      'POWer:POWer<x>:TYPe', 'POWer:ADDNew',
      'POWer:POWer<x>:HARMONICS:CLASs', 'POWer:POWer<x>:HARMONICS:STANDard',
      'POWer:POWer<x>:HARMONICS:UNITs', 'POWer:POWer<x>:HARMONICS:FUNDamental',
    ],
    power_soa: [
      'POWer:POWer<x>:SOA:POINT<x>', 'POWer:POWer<x>:TYPe',
      'POWer:ADDNew',
    ],
    afg: [
      'AFG:FUNCtion', 'AFG:FREQuency', 'AFG:AMPLitude', 'AFG:OFFSet',
      'AFG:OUTPut:STATE', 'AFG:PERIod', 'AFG:SYMMetry', 'AFG:PHASe',
    ],
    dvm: [
      'DVM:MODe', 'DVM:AUTORange', 'DVM:SOUrce', 'DVM:MEASUrement:FREQuency?',
      'DVM:MEASUrement:VALue?',
    ],
    dphy: [
      'BUS:B<x>:DPHY:CLOCk:SOUrce', 'BUS:B<x>:DPHY:CLOCk:THRESHold',
      'BUS:B<x>:DPHY:LP:THRESHold', 'BUS:B<x>:DPHY:PROTocol:TYPe',
    ],
    cphy: [
      'BUS:B<x>:CPHY:A:SOUrce', 'BUS:B<x>:CPHY:A:THRESHold',
      'BUS:B<x>:CPHY:SUBTYPe',
    ],
    statistics: [
      'MEASUrement:MEAS<x>:DISPlaystat:ENABle', 'MEASUrement:STATIstics:CYCLEMode',
      'MEASUrement:STATIstics:COUNt', 'MEASUrement:STATIstics:MODe',
    ],
    rise_time: [
      'MEASUrement:ADDMEAS', 'MEASUrement:MEAS<x>:TYPe',
    ],
    histogram_box: [
      'HIStogram:BOX', 'HIStogram:BOXPcnt',
      'HIStogram:DISplay', 'HIStogram:MODe',
    ],
    waveform_transfer: [
      'WFMOutpre:ENCdg', 'DATa:ENCdg', 'DATa:SOUrce', 'DATa:STARt', 'DATa:STOP',
      'CURVe', 'WFMOutpre:BYT_Nr', 'WFMOutpre:XINcr', 'WFMOutpre:YMUlt',
    ],
    dpm: [
      'MEASUrement:MEAS<x>:DPM:TYPE',
    ],
    recall_setup: [
      'RECAll:SETUp', 'RECAll:SESsion',
    ],
    recall_session: [
      'RECAll:SESsion', 'RECAll:SETUp',
    ],
    recall_waveform: [
      'RECAll:WAVEform', 'RECAll:WAVEform:FILEPath',
    ],
    save_waveform: [
      'SAVe:WAVEform', 'SAVe:WAVEform:FILEFormat',
    ],
    trigger_level: [
      'TRIGger:{A|B}:LEVel:CH<x>', 'TRIGger:A:LEVel:CH<x>',
    ],
    screenshot: [
      'SAVe:IMAGe', 'SAVe:IMAGe:FILEFormat',
    ],
    horizontal_scale: [
      'HORizontal:SCAle', 'HORizontal:POSition', 'HORizontal:MODe',
    ],
    fastframe: [
      'HORizontal:FASTframe:STATE', 'HORizontal:FASTframe:COUNt',
      'HORizontal:FASTframe:MAXFRames', 'HORizontal:FASTframe:SELECTED',
    ],
  };

  const intent = classifyIntent(q);
  const injectionHeaders = INTENT_HEADER_INJECTIONS[intent.subject] || [];
  for (const h of injectionHeaders) {
    const entry = index.getByHeader(h, input.modelFamily);
    if (entry) {
      const key = `${entry.sourceFile}:${entry.commandId}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
  }

  for (const entry of [...measurementDirectEntries, ...directEntries, ...measurementSearchEntries, ...searchEntries]) {
    const key = `${entry.sourceFile}:${entry.commandId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  // Re-rank using intent classification and group-aware scoring
  let reRanked = reRankWithIntent(merged, q);

  // For intents with injected headers, force them to the top.
  // BM25 scores can be so high that additive boosts can't overcome them.
  if (injectionHeaders.length > 0) {
    // Build set of injected headers for exact matching.
    // Also include the resolved form (e.g. "sv:span" from "SV:SPAN")
    const injectedSet = new Set<string>();
    for (const h of injectionHeaders) {
      injectedSet.add(h.toLowerCase());
      // Add the prefix before any placeholder as a fallback
      const stripped = h.replace(/<[^>]+>/g, '').replace(/:$/, '').toLowerCase();
      if (stripped !== h.toLowerCase()) injectedSet.add(stripped);
    }
    const isInjected = (cmd: CommandRecord) => {
      const hdr = cmd.header.toLowerCase();
      return injectedSet.has(hdr);
    };
    const top = reRanked.filter(isInjected);
    const rest = reRanked.filter(c => !isInjected(c));
    reRanked = [...top, ...rest];
  }

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
    debug: {
      intent: intent.intent,
      subject: intent.subject,
      groups: intent.groups,
      injected: injectionHeaders.length,
      expanded: expandedQuery !== q,
    },
  } as ToolResult<unknown[]>;
}
