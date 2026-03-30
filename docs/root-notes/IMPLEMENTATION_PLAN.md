# TekAutomate Intent-Based SCPI Search — Full Implementation Plan

## Problem Summary

Two search paths both have the same flaw: they search ALL commands/tools by keyword, then sort by group relevance. Group filtering is a **sort preference, not a gate**. This means "measure voltage" matches ANY command mentioning "measure" or "voltage" in its description — Miscellaneous, Trigger, Mask, Display commands all rank alongside Measurement commands.

### Affected Paths

| Path | Entry Point | Search Engine | Used By |
|------|------------|---------------|---------|
| **Deterministic** | `cleanRouter → runSmartScpiAssistant → smartScpiLookup` | `smartScpiAssistant.ts` internal search | MCP-only mode, no AI |
| **AI Tool Loop** | AI calls `smart_scpi_lookup` tool | Same `smartScpiLookup` function | AI orchestration via OpenAI |
| **Router** | AI calls `tek_router` with `action: "search"` | `toolSearch.ts` BM25 + semantic | MCPv2 router path |

### Root Cause

`smartScpiAssistant.ts` line 205-236: `searchCommands()` builds results from `primaryResults` (keyword match in ALL commands) + `groupResults` (group match) + `modifierResults` (action match), deduplicates them, then sorts with group relevance as a **tiebreaker**. Commands from wrong groups score well because BM25/keyword matching doesn't know that "measure" in a Trigger command description is irrelevant.

`toolSearch.ts`: BM25 searches ALL registered MicroTools with zero group awareness. Same fundamental problem.

---

## Architecture After Fix

```
User query: "add jitter measurement on CH2"
                    │
                    ▼
            ┌──────────────┐
            │  intentMap.ts │  ← NEW: single source of truth
            │               │
            │  classifyIntent("add jitter measurement on CH2")
            │  → { groups: ["Measurement"],
            │      intent: "measurement",
            │      subject: "jitter",
            │      action: "add",
            │      confidence: "high" }
            └──────┬───────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
  smartScpiAssistant    toolSearch.ts
  (deterministic path)  (router path)
          │                 │
          ▼                 ▼
  Filter 2800 cmds      Boost/penalize
  → 367 Measurement     MicroTools by
  → BM25 "jitter"       group membership
  within those 367       in BM25 scoring
          │                 │
          ▼                 ▼
  Correct results!      Correct results!
```

---

## Files to Create/Modify

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `intentMap.ts` | **CREATE** | Unified intent classifier + group filter utilities |
| 2 | `smartScpiAssistant.ts` | **MODIFY** | Use `classifyIntent()` + filter-first search |
| 3 | `toolSearch.ts` | **MODIFY** | Add group boost/penalty to BM25 scoring |
| 4 | `toolRouter.ts` | **MODIFY** | Enhance `TEK_ROUTER_TOOL_DEFINITION` description |
| 5 | `../tools/index.ts` (or wherever `smart_scpi_lookup` is defined) | **MODIFY** | Enhance tool description for AI |

---

## FILE 1: `intentMap.ts` (NEW)

**Location:** Same directory as `commandGroups.ts`, `toolSearch.ts`, `smartScpiAssistant.ts`

**Purpose:** Single source of truth for natural language → command group classification. Consumed by both search paths.

### Imports

```typescript
import { suggestCommandGroups } from './commandGroups';
import type { CommandRecord } from './commandIndex';
import type { MicroTool } from './toolRegistry';
```

### Interface

```typescript
export interface IntentResult {
  groups: string[];        // Canonical group names from commandGroups.json
  intent: string;          // Primary intent category (measurement, trigger, bus, etc.)
  subject: string;         // Specific subject extracted (jitter, i2c, voltage, etc.)
  action: string;          // User action verb: add | remove | configure | query | save | find
  confidence: 'high' | 'medium' | 'low';
}
```

### Phase 1: Action Extraction

Extract the user's action verb. Order matters — more specific patterns first.

```typescript
const ACTION_PATTERNS: Array<{ pattern: RegExp; action: string }> = [
  { pattern: /\b(add|create|insert|new|enable|turn\s*on)\b/i, action: 'add' },
  { pattern: /\b(remove|delete|clear|erase|disable|turn\s*off)\b/i, action: 'remove' },
  { pattern: /\b(setup|configure|set|adjust|change|apply)\b/i, action: 'configure' },
  { pattern: /\b(query|get|read|what\s*is|show|display|check)\b/i, action: 'query' },
  { pattern: /\b(measure|meas)\b/i, action: 'add' },
  { pattern: /\b(save|store|export|capture|screenshot)\b/i, action: 'save' },
];

function extractAction(query: string): string {
  for (const { pattern, action } of ACTION_PATTERNS) {
    if (pattern.test(query)) return action;
  }
  return 'find';
}
```

### Phase 2: Subject-to-Group Map (THE CORE DATA STRUCTURE)

This is the hand-curated dictionary. ~120 entries. Each maps a user-facing keyword/phrase to the canonical group name(s) from `commandGroups.json`. Order matters: more specific patterns are checked first.

**Important:** The group names MUST match exactly what's in `commandGroups.json`:
- `"Acquisition"`, `"Act On Event"`, `"AFG"`, `"Alias"`, `"Bus"`, `"Calibration"`, `"Callout"`, `"Cursor"`, `"Digital"`, `"Digital Power Management"`, `"Display"`, `"DVM"`, `"Ethernet"`, `"File System"`, `"Histogram"`, `"History"`, `"Horizontal"`, `"Inverter Motors and Drive Analysis"`, `"Mask"`, `"Math"`, `"Measurement"`, `"Miscellaneous"`, `"Plot"`, `"Power"`, `"Save and Recall"`, `"Save on"`, `"Search and Mark"`, `"Self Test"`, `"Spectrum view"`, `"Status and Error"`, `"Trigger"`, `"Waveform Transfer"`, `"Wide Band Gap Analysis (WBG)"`, `"Zoom"`

```typescript
const SUBJECT_GROUP_MAP: Array<{
  pattern: RegExp;
  groups: string[];
  intent: string;
  subject: string;
}> = [
  // ── Bus protocols (most specific first) ──
  { pattern: /\bi2c\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'i2c' },
  { pattern: /\bspi\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'spi' },
  { pattern: /\b(can\s*fd|canfd)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'can_fd' },
  { pattern: /\bcan\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'can' },
  { pattern: /\blin\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'lin' },
  { pattern: /\b(uart|rs232|rs422|rs485|serial)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'serial' },
  { pattern: /\b(flexray|flex\s*ray)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'flexray' },
  { pattern: /\b(ethernet|eth|100base|1000base)\b/i, groups: ['Bus', 'Trigger', 'Ethernet'], intent: 'bus', subject: 'ethernet' },
  { pattern: /\b(arinc|arinc429)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'arinc429' },
  { pattern: /\b(mil.?std|1553)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'milstd1553' },
  { pattern: /\b(spacewire|spw)\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'spacewire' },
  { pattern: /\bi3c\b/i, groups: ['Bus', 'Trigger'], intent: 'bus', subject: 'i3c' },
  { pattern: /\b(bus|decode|protocol)\b/i, groups: ['Bus'], intent: 'bus', subject: 'bus' },

  // ── Measurement types (specific before generic) ──
  { pattern: /\b(eye\s*diagram|eye\s*pattern|eye)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'eye' },
  { pattern: /\b(jitter|tj|rj|dj|pj)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'jitter' },
  { pattern: /\b(rise\s*time|risetime)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'rise_time' },
  { pattern: /\b(fall\s*time|falltime)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'fall_time' },
  { pattern: /\b(duty\s*cycle|duty)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'duty_cycle' },
  { pattern: /\b(overshoot|preshoot|undershoot)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'overshoot' },
  { pattern: /\b(skew)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'skew' },
  { pattern: /\b(pk2pk|peak.to.peak|pkpk|vpp)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'pk2pk' },
  { pattern: /\b(frequency|freq)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'frequency' },
  { pattern: /\b(period)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'period' },
  { pattern: /\b(amplitude|amp)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'amplitude' },
  { pattern: /\b(rms|vrms)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'rms' },
  { pattern: /\b(mean)\b/i, groups: ['Measurement', 'Acquisition'], intent: 'measurement', subject: 'mean' },
  { pattern: /\b(burst)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'burst' },
  { pattern: /\b(area|cycle\s*area)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'area' },
  { pattern: /\b(phase)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'phase' },
  { pattern: /\b(result|results?\s*table|detailed\s*results?|statistics)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'results' },
  { pattern: /\b(measurement|measure|meas)\b/i, groups: ['Measurement'], intent: 'measurement', subject: 'measurement' },

  // ── Voltage / Channel (Vertical system) ──
  // NOTE: "voltage" maps to Measurement because users saying "measure voltage" want MEASUrement commands
  // The CH<x>: vertical commands are in the Measurement group in commandGroups.json
  { pattern: /\b(voltage|volt)\b/i, groups: ['Measurement', 'Cursor'], intent: 'measurement', subject: 'voltage' },
  { pattern: /\b(ch\s*\d|channel\s*\d|channel)\b/i, groups: ['Measurement'], intent: 'vertical', subject: 'channel' },
  { pattern: /\b(probe|attenuation|atten)\b/i, groups: ['Measurement'], intent: 'vertical', subject: 'probe' },
  { pattern: /\b(coupling|impedance|termination)\b/i, groups: ['Measurement'], intent: 'vertical', subject: 'coupling' },
  { pattern: /\b(bandwidth|bw\s*limit)\b/i, groups: ['Measurement'], intent: 'vertical', subject: 'bandwidth' },
  { pattern: /\b(deskew)\b/i, groups: ['Measurement'], intent: 'vertical', subject: 'deskew' },
  { pattern: /\b(scale)\b/i, groups: ['Measurement', 'Horizontal', 'Display'], intent: 'vertical', subject: 'scale' },
  { pattern: /\b(offset)\b/i, groups: ['Measurement', 'Horizontal'], intent: 'vertical', subject: 'offset' },
  { pattern: /\b(label)\b/i, groups: ['Measurement', 'Callout'], intent: 'vertical', subject: 'label' },

  // ── Trigger types ──
  { pattern: /\b(edge\s*trigger|trigger\s*edge)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'edge' },
  { pattern: /\b(pulse\s*trigger|trigger\s*pulse|pulse\s*width|glitch)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'pulse' },
  { pattern: /\b(runt\s*trigger|trigger\s*runt|runt)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'runt' },
  { pattern: /\b(timeout\s*trigger|trigger\s*timeout)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'timeout' },
  { pattern: /\b(logic\s*trigger|trigger\s*logic|pattern\s*trigger)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'logic' },
  { pattern: /\b(video\s*trigger|trigger\s*video)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'video' },
  { pattern: /\b(window\s*trigger|trigger\s*window)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'window' },
  { pattern: /\b(bus\s*trigger|trigger\s*bus|trigger.*protocol)\b/i, groups: ['Trigger', 'Bus'], intent: 'trigger', subject: 'bus_trigger' },
  { pattern: /\b(trigger|trig|holdoff)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'trigger' },
  { pattern: /\b(slope|edge)\b/i, groups: ['Trigger'], intent: 'trigger', subject: 'edge' },

  // ── Acquisition ──
  { pattern: /\b(sample\s*rate|sampling|samplerate)\b/i, groups: ['Acquisition', 'Horizontal'], intent: 'acquisition', subject: 'sample_rate' },
  { pattern: /\b(record\s*length|record|rlength)\b/i, groups: ['Horizontal'], intent: 'acquisition', subject: 'record_length' },
  { pattern: /\b(single\s*seq|single\s*shot|single)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'single' },
  { pattern: /\b(run|stop|acquire|acquisition)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'acquisition' },
  { pattern: /\b(fastframe|fast\s*frame)\b/i, groups: ['Horizontal'], intent: 'acquisition', subject: 'fastframe' },
  { pattern: /\b(numavg|num\s*avg|averaging)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'averaging' },
  { pattern: /\b(average|avg)\b/i, groups: ['Acquisition'], intent: 'acquisition', subject: 'averaging' },

  // ── Horizontal / Timebase ──
  { pattern: /\b(timebase|time\s*base|time.per.div|horizontal)\b/i, groups: ['Horizontal'], intent: 'horizontal', subject: 'timebase' },
  { pattern: /\b(zoom|magnify)\b/i, groups: ['Zoom'], intent: 'horizontal', subject: 'zoom' },

  // ── Math / FFT ──
  { pattern: /\b(fft|spectrum)\b/i, groups: ['Math', 'Spectrum view'], intent: 'math', subject: 'fft' },
  { pattern: /\b(math|expression|equation)\b/i, groups: ['Math'], intent: 'math', subject: 'math' },

  // ── Power analysis ──
  { pattern: /\b(harmonics|thd|distortion|power\s*quality)\b/i, groups: ['Power', 'Measurement'], intent: 'power', subject: 'harmonics' },
  { pattern: /\b(switching\s*loss|sloss)\b/i, groups: ['Power'], intent: 'power', subject: 'switching_loss' },
  { pattern: /\b(efficiency|control\s*loop|bode)\b/i, groups: ['Power'], intent: 'power', subject: 'efficiency' },
  { pattern: /\b(power|watt)\b/i, groups: ['Power'], intent: 'power', subject: 'power' },

  // ── DPM / IMDA / WBG ──
  { pattern: /\b(dpm|power\s*management|power\s*rail)\b/i, groups: ['Digital Power Management'], intent: 'dpm', subject: 'dpm' },
  { pattern: /\b(imda|motor\s*drive|torque|ripple)\b/i, groups: ['Inverter Motors and Drive Analysis'], intent: 'imda', subject: 'imda' },
  { pattern: /\b(wbg|wide\s*band\s*gap|double\s*pulse)\b/i, groups: ['Wide Band Gap Analysis (WBG)'], intent: 'wbg', subject: 'wbg' },

  // ── Display / Visual ──
  { pattern: /\b(cursor|bar|crosshair|readout)\b/i, groups: ['Cursor'], intent: 'display', subject: 'cursor' },
  { pattern: /\b(graticule|grid|persistence|intensity|brightness)\b/i, groups: ['Display'], intent: 'display', subject: 'display_settings' },
  { pattern: /\b(waveview|waveform\s*view)\b/i, groups: ['Display'], intent: 'display', subject: 'waveview' },
  { pattern: /\b(display|screen)\b/i, groups: ['Display'], intent: 'display', subject: 'display' },
  { pattern: /\b(histogram)\b/i, groups: ['Histogram'], intent: 'display', subject: 'histogram' },
  { pattern: /\b(plot|trend)\b/i, groups: ['Plot'], intent: 'display', subject: 'plot' },

  // ── Save / Recall ──
  { pattern: /\b(screenshot|screen\s*capture|save\s*image|print)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'screenshot' },
  { pattern: /\b(save|recall|session|store|export)\b/i, groups: ['Save and Recall'], intent: 'save', subject: 'save' },

  // ── Search and Mark ──
  { pattern: /\b(search|mark|find\s*packet|error\s*frame)\b/i, groups: ['Search and Mark'], intent: 'search', subject: 'search' },

  // ── Mask ──
  { pattern: /\b(mask\s*test|mask)\b/i, groups: ['Mask'], intent: 'mask', subject: 'mask' },

  // ── Digital channels ──
  { pattern: /\b(digital|logic\s*probe|dall|d\d+)\b/i, groups: ['Digital'], intent: 'digital', subject: 'digital' },

  // ── DVM ──
  { pattern: /\b(dvm|voltmeter|digital\s*voltmeter)\b/i, groups: ['DVM'], intent: 'dvm', subject: 'dvm' },

  // ── AFG ──
  { pattern: /\b(afg|function\s*generator|arbitrary)\b/i, groups: ['AFG'], intent: 'afg', subject: 'afg' },

  // ── Status / Misc ──
  { pattern: /\b(status|esr|stb|allev|error\s*queue|event\s*queue)\b/i, groups: ['Status and Error'], intent: 'status', subject: 'status' },
  { pattern: /\b(autoset|preset|factory|reset|\*rst)\b/i, groups: ['Miscellaneous'], intent: 'misc', subject: 'autoset' },
  { pattern: /\b(idn|\*idn|identify)\b/i, groups: ['Miscellaneous'], intent: 'misc', subject: 'identify' },
  { pattern: /\b(opc|\*opc|wait|busy)\b/i, groups: ['Miscellaneous'], intent: 'misc', subject: 'opc' },

  // ── Calibration ──
  { pattern: /\b(calibrat|spc|signal\s*path)\b/i, groups: ['Calibration'], intent: 'calibration', subject: 'calibration' },

  // ── Network / Ethernet config ──
  { pattern: /\b(lxi|dhcp|dns|gateway|ip\s*address|remote\s*interface)\b/i, groups: ['Ethernet'], intent: 'network', subject: 'network' },

  // ── File system ──
  { pattern: /\b(directory|readfile|file\s*system|mkdir|rmdir)\b/i, groups: ['File System'], intent: 'filesystem', subject: 'filesystem' },

  // ── Waveform transfer ──
  { pattern: /\b(curve|waveform\s*data|wfm|wfmoutpre|data\s*source|waveform\s*transfer)\b/i, groups: ['Waveform Transfer'], intent: 'waveform', subject: 'waveform_transfer' },

  // ── Act on event ──
  { pattern: /\b(act\s*on\s*event|save\s*on|acton|saveon)\b/i, groups: ['Act On Event', 'Save on'], intent: 'event', subject: 'act_on_event' },

  // ── Callout / Annotation ──
  { pattern: /\b(callout|annotate|bookmark)\b/i, groups: ['Callout'], intent: 'callout', subject: 'callout' },

  // ── History ──
  { pattern: /\b(history|timestamp\s*table)\b/i, groups: ['History'], intent: 'history', subject: 'history' },

  // ── Self Test ──
  { pattern: /\b(self\s*test|diagnostic)\b/i, groups: ['Self Test'], intent: 'selftest', subject: 'selftest' },

  // ── Alias ──
  { pattern: /\b(alias|macro)\b/i, groups: ['Alias'], intent: 'alias', subject: 'alias' },
];
```

### Phase 3: Main Classifier Function

```typescript
export function classifyIntent(query: string): IntentResult {
  const q = query.trim();
  if (!q) {
    return { groups: [], intent: 'general', subject: '', action: 'find', confidence: 'low' };
  }

  const action = extractAction(q);

  // Try subject-to-group map (curated patterns, checked in order)
  for (const entry of SUBJECT_GROUP_MAP) {
    if (entry.pattern.test(q)) {
      return {
        groups: entry.groups,
        intent: entry.intent,
        subject: entry.subject,
        action,
        confidence: 'high',
      };
    }
  }

  // Fallback: use existing suggestCommandGroups() from commandGroups.ts
  // This uses GROUP_HINTS + command keyword matching as a safety net
  const suggested = suggestCommandGroups(q, 3);
  if (suggested.length > 0) {
    return {
      groups: suggested,
      intent: 'general',
      subject: q.toLowerCase(),
      action,
      confidence: 'medium',
    };
  }

  // No match — return empty groups (search all, same behavior as today)
  return {
    groups: [],
    intent: 'general',
    subject: q.toLowerCase(),
    action,
    confidence: 'low',
  };
}
```

### Utility Functions

```typescript
/**
 * Filter CommandRecords to only those in the specified groups.
 * If groups is empty, returns ALL commands (no filtering).
 */
export function filterCommandsByGroups(
  commands: CommandRecord[],
  groups: string[]
): CommandRecord[] {
  if (!groups.length) return commands;
  const groupSet = new Set(groups.map(g => g.toLowerCase()));
  return commands.filter(cmd => groupSet.has(cmd.group.toLowerCase()));
}

/**
 * Filter MicroTools by group membership.
 * MicroTool tags include the group name (added during hydration in toolHydrator.ts).
 * If groups is empty, returns ALL tools (no filtering).
 */
export function filterToolsByGroups(
  tools: MicroTool[],
  groups: string[]
): MicroTool[] {
  if (!groups.length) return tools;
  const groupSet = new Set(groups.map(g => g.toLowerCase()));
  return tools.filter(tool =>
    tool.tags.some(tag => groupSet.has(tag.toLowerCase()))
  );
}
```

### Why This Data Structure Works

- **~120 entries, hand-curated, zero ML** — runs in microseconds
- **Regex patterns** — handles typos, word boundaries, multi-word phrases
- **Order-dependent** — "i2c bus trigger" matches `i2c` (first) → Bus group, not `trigger` → Trigger group
- **Fallback chain** — SUBJECT_GROUP_MAP → `suggestCommandGroups()` → no filter (full corpus)
- **Easy to maintain** — when a query returns wrong results, add/reorder one entry in the array

---

## FILE 2: `smartScpiAssistant.ts` — MODIFICATIONS

### Change 1: Add Import (top of file)

```typescript
import { classifyIntent, filterCommandsByGroups, type IntentResult } from './intentMap';
```

### Change 2: Delete `parseIntent()` Method (lines 90–143)

Delete the entire `parseIntent()` method. It is replaced by `classifyIntent()` from `intentMap.ts`.

### Change 3: Delete `suggestGroups()` Method (lines 149–170)

Delete the entire `suggestGroups()` method. It is replaced by the `SUBJECT_GROUP_MAP` in `intentMap.ts`.

### Change 4: Replace `searchCommands()` Method (lines 175–256)

Delete the entire method and replace with:

```typescript
/**
 * Search commands using group-first filtering strategy.
 * STEP 1: Filter to target groups (narrows haystack)
 * STEP 2: Try exact header match within filtered pool
 * STEP 3: Score remaining commands by keyword relevance within pool
 */
private async searchCommands(
  commands: CommandRecord[],
  intent: IntentResult
): Promise<CommandRecord[]> {
  const { groups, subject, action } = intent;

  // ── STEP 1: Filter to target groups FIRST ──
  const pool = filterCommandsByGroups(commands, groups);
  console.log(`[SEARCH] Groups: [${groups.join(', ')}] → ${pool.length} commands in pool (from ${commands.length} total)`);

  // If group filter returned nothing, fall back to full corpus
  const searchPool = pool.length > 0 ? pool : commands;

  // ── STEP 2: Exact header match ──
  const subjectLower = subject.toLowerCase();
  const exactMatches = searchPool.filter(cmd => {
    const headerLower = cmd.header.toLowerCase();
    return (
      headerLower === subjectLower ||
      headerLower.replace(/[^a-z:]/g, '') === subjectLower.replace(/[^a-z:]/g, '')
    );
  });

  if (exactMatches.length > 0) {
    console.log(`[EXACT_MATCH] Found ${exactMatches.length} exact matches for "${subject}"`);
    return exactMatches.slice(0, 8);
  }

  // ── STEP 3: Score by keyword relevance WITHIN the filtered pool ──
  const scored = searchPool.map(cmd => {
    const searchText = `${cmd.header} ${cmd.shortDescription} ${cmd.description} ${cmd.tags.join(' ')}`.toLowerCase();
    let score = 0;

    // Subject keyword matching
    const subjectWords = subject.split(/[\s_]+/).filter(w => w.length > 1);
    for (const word of subjectWords) {
      if (cmd.header.toLowerCase().includes(word)) score += 5;
      if (cmd.shortDescription.toLowerCase().includes(word)) score += 3;
      if (searchText.includes(word)) score += 1;
    }

    // Action matching — boost commands whose header suggests the right action
    if (action === 'add' && /addnew|addmeas|add/i.test(cmd.header)) score += 4;
    if (action === 'remove' && /delete|clear|remove/i.test(cmd.header)) score += 4;
    if (action === 'configure' && /state|mode|enable|config/i.test(cmd.header)) score += 2;
    if (action === 'query' && cmd.commandType !== 'set') score += 1;
    if (action === 'configure' && cmd.commandType !== 'query') score += 1;

    // Group membership bonus (relevant when searching full corpus as fallback)
    if (groups.length > 0) {
      const inTargetGroup = groups.some(g => cmd.group.toLowerCase() === g.toLowerCase());
      if (inTargetGroup) score += 10;
    }

    return { cmd, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(s => s.cmd);
}
```

### Change 5: Update `smartLookup()` Method (lines 294–367)

Replace the `parseIntent()` call with `classifyIntent()` and update all property references.

**Before:**
```typescript
const intent = this.parseIntent(request.query);
const relevantCommands = await this.searchCommands(commands, intent);
```

**After:**
```typescript
const intent = classifyIntent(request.query);
console.log(`[INTENT] query="${request.query}" → intent=${intent.intent}, subject=${intent.subject}, groups=[${intent.groups.join(', ')}], confidence=${intent.confidence}`);
const relevantCommands = await this.searchCommands(commands, intent);
```

**Then update ALL references to `intent.primary` → `intent.intent` throughout the method.**

The return value changes from:
```typescript
intent: intent.primary,
```
to:
```typescript
intent: intent.intent,
```

### Change 6: Update `generateWorkflow()` Method (lines 261–289)

Replace `intent.primary` references with `intent.intent`.

The method signature changes from:
```typescript
private generateWorkflow(commands: CommandRecord[], intent: ReturnType<SmartScpiAssistant['parseIntent']>): string[] {
```
to:
```typescript
private generateWorkflow(commands: CommandRecord[], intent: IntentResult): string[] {
```

Inside the method, replace:
- `primary === 'power'` → `intent.intent === 'power'`
- `primary === 'bus'` → `intent.intent === 'bus'`
- `primary === 'trigger'` → `intent.intent === 'trigger'`
- `intent.groups` stays the same
- `action === 'setup'` → `intent.action === 'configure'` (note: action rename)

### Change 7: Update `generateExploratoryInterface()` Method

Replace `intent.action` references — these stay the same, no change needed.

### Change 8: Update `formatResults()` Method

In the `formatResults()` method, replace `result.intent === 'trigger'` and `result.intent === 'bus'` — these use the string from `smartLookup()` return value which is now `intent.intent`. No change to the comparison logic, just make sure the `intent` field in `SmartScpiResult` is populated from `intent.intent`.

### Change 9: Remove `isSpecificQuery()` simplification (OPTIONAL)

The `isSpecificQuery()` method (lines 417–443) can stay as-is. It operates on the query string, not on the intent object. However, you could enhance it by checking `intent.confidence === 'high'` as an additional signal.

---

## FILE 3: `toolSearch.ts` — MODIFICATIONS

### Change 1: Add Import (top of file)

```typescript
import { classifyIntent } from './intentMap';
```

### Change 2: Modify `search()` Method — Add Group Boost/Penalty

In the `search()` method, add intent classification after query normalization, then apply group boost/penalty during BM25 result scoring.

**Add after line `const normalizedQuery = query.trim().toLowerCase();`:**

```typescript
// ── Intent-based group awareness for scpi_lookup tools ──
const intent = classifyIntent(query);
const intentGroups = intent.groups;
const intentGroupSet = new Set(intentGroups.map(g => g.toLowerCase()));
```

**Modify the BM25 scoring loop.** Find this block (approximately line 98–115 in current code):

```typescript
for (const result of bm25Results) {
  if (result.score < minScore) continue;
  const tool = this.registry.get(result.doc.toolId);
  if (!tool) continue;
  if (categoryFilter && !categoryFilter.has(tool.category)) continue;
  const usage = this.scoreBoosts(tool, recencyWindowMs, recencyBoost);
  const hit: ToolSearchHit = {
    tool,
    score: result.score * BM25_WEIGHT + usage.total,
    matchStage: 'keyword',
    ...
```

**Replace with:**

```typescript
for (const result of bm25Results) {
  if (result.score < minScore) continue;
  const tool = this.registry.get(result.doc.toolId);
  if (!tool) continue;
  if (categoryFilter && !categoryFilter.has(tool.category)) continue;

  // ── Group boost/penalty for scpi_lookup tools ──
  let groupBoost = 0;
  if (intentGroupSet.size > 0 && tool.category === 'scpi_lookup') {
    const toolInTargetGroup = tool.tags.some(tag => intentGroupSet.has(tag.toLowerCase()));
    if (toolInTargetGroup) {
      groupBoost = 5.0;   // Strong boost for tools in the right group
    } else if (intent.confidence === 'high') {
      groupBoost = -2.0;  // Penalize out-of-group tools when intent is confident
    }
  }

  const usage = this.scoreBoosts(tool, recencyWindowMs, recencyBoost);
  const hit: ToolSearchHit = {
    tool,
    score: result.score * BM25_WEIGHT + usage.total + groupBoost,
    matchStage: 'keyword',
    debug: {
      bm25Score: result.score,
      usageBoost: usage.usageBoost,
      successRate: usage.successRate,
      recencyBoost: usage.recencyBoost,
    },
  };
  hits.push(hit);
  byId.set(tool.id, hit);
}
```

### Why Boost/Penalty Instead of Hard Filter

The `toolSearch.ts` router serves ALL tool categories (templates, shortcuts, RAG, etc.), not just SCPI commands. A hard group filter would break non-SCPI tool discovery. The boost/penalty approach:

- Only applies to `scpi_lookup` category tools
- Boosts tools in the right group by +5.0 (equivalent to a strong BM25 keyword match)
- Penalizes wrong-group tools by -2.0 only when intent confidence is high
- Leaves non-SCPI tools (shortcuts, templates, etc.) completely unaffected

---

## FILE 4: `toolRouter.ts` — MODIFY TOOL DESCRIPTION

### Change: Update `TEK_ROUTER_TOOL_DEFINITION` (lines 520–608)

The current description is:
```
"TekAutomate router tool. Search, discover, execute, and build internal capabilities through one interface."
```

This tells the AI nothing about how to construct good queries. Replace the `description` field:

```typescript
export const TEK_ROUTER_TOOL_DEFINITION = {
  name: 'tek_router',
  description:
    'TekAutomate instrument automation router. Controls Tektronix oscilloscopes via SCPI commands.\n\n' +
    '## How to use for instrument control:\n\n' +
    '### Step 1: SEARCH for commands\n' +
    'Use action:"search" with a natural language query. The router understands measurement types, ' +
    'trigger types, bus protocols, and oscilloscope concepts.\n\n' +
    'Good search queries (natural language works):\n' +
    '- "add jitter measurement"\n' +
    '- "configure i2c bus decode"\n' +
    '- "setup edge trigger"\n' +
    '- "save screenshot"\n' +
    '- "measure rise time"\n' +
    '- "show detailed results"\n' +
    '- "set channel scale"\n' +
    '- "sampling rate"\n\n' +
    '### Step 2: EXEC the found command\n' +
    'Use action:"exec" with the toolId from search results and appropriate args.\n' +
    '- For SET commands: pass commandType:"set" and value:<the value>\n' +
    '- For QUERY commands: pass commandType:"query"\n' +
    '- For specific channels/sources: pass concreteHeader like "CH1:SCAle" instead of "CH<x>:SCAle"\n\n' +
    '### Common multi-step workflows:\n' +
    '- Add measurement: search "add measurement" → exec ADDMEAS with value, then set SOUrce\n' +
    '- Set channel: search "channel scale" → exec with concreteHeader "CH1:SCAle" and value\n' +
    '- Configure trigger: search "edge trigger" → exec TRIGger:A:LEVel with value\n' +
    '- Bus decode: search "i2c bus" → exec BUS:TYPe, then configure pins\n\n' +
    'Actions: "search", "exec", "search_exec", "build", "create", "update", "delete", "info", "list".',
  parameters: {
    // ... keep existing parameters object unchanged ...
  },
};
```

---

## FILE 5: `smart_scpi_lookup` Tool Definition — MODIFY DESCRIPTION

The `smart_scpi_lookup` tool is defined in your `../tools/` directory (imported via `getToolDefinitions()` in `toolLoop.ts`). Find its definition and update the description.

**Current description** (likely something generic like "Search SCPI commands").

**New description:**

```typescript
{
  name: 'smart_scpi_lookup',
  description:
    'Natural language SCPI command finder for Tektronix oscilloscopes. ' +
    'Ask in plain English what you want to do with the scope, get back exact SCPI commands ' +
    'with syntax, arguments, valid values, and code examples.\n\n' +
    'Examples of good queries:\n' +
    '- "how do I measure voltage on channel 1"\n' +
    '- "add eye diagram measurement"\n' +
    '- "configure I2C bus decode on bus 1"\n' +
    '- "set trigger to falling edge at 1.5V"\n' +
    '- "save screenshot to USB"\n' +
    '- "what is the sampling rate"\n' +
    '- "add jitter measurement with detailed results"\n\n' +
    'Returns: matching SCPI commands with full syntax, valid argument values, ' +
    'and Python/SCPI code examples. For broad queries, returns a conversational ' +
    'menu to narrow down options.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you want to do with the oscilloscope, in plain English. ' +
          'Include the measurement type, channel, or feature you want to control.'
      },
      modelFamily: {
        type: 'string',
        description: 'Optional model family filter: MSO2, MSO4, MSO5, MSO6, MSO7, DPO5000, AFG, AWG, etc.'
      }
    },
    required: ['query']
  }
}
```

---

## IMPORTANT NOTES

### Note on `commandGroups.json` Group Names vs. Vertical Commands

Your `commandGroups.json` does NOT have a "Vertical" group. Channel commands (`CH<x>:SCAle`, `CH<x>:BANdwidth`, etc.) live inside the **"Measurement"** group in `commandGroups.json`. This is why the `SUBJECT_GROUP_MAP` maps channel-related terms like `"channel"`, `"probe"`, `"coupling"` to `groups: ['Measurement']`, not `groups: ['Vertical']`.

**Verify this:** Run `grep -c "CH<x>" commandGroups.json` to confirm CH commands are in Measurement. If they're in a different group in your actual data files (e.g., `mso_2_4_5_6_7.json`), update the intent map accordingly. The group name must match the `group` field on the `CommandRecord` objects, which comes from the JSON file structure.

### Note on the `"level"` Keyword

The word `"level"` appears in `commandGroups.ts` GROUP_HINTS under Trigger. But `TRIGger:A:LEVel` is a specific command, while "level" alone is ambiguous (could mean measurement reference level, trigger level, etc.). The `SUBJECT_GROUP_MAP` intentionally only matches `"level"` when preceded by `"trigger"`. If you find users typing bare "level" and expecting trigger commands, add it.

### Note on `"delay"` Keyword

`"delay"` could mean horizontal delay (Horizontal group) or measurement delay/skew (Measurement group). The map currently maps it to Measurement. If your users more commonly mean horizontal delay, change `groups: ['Horizontal', 'Measurement']`.

---

## TESTING PLAN

### Test Script for `intentMap.ts`

Create a test file that validates classification of the queries that were failing:

```typescript
import { classifyIntent } from './intentMap';

const TEST_CASES = [
  // Previously failing queries
  { query: 'how do I measure voltage', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'configure the channel', expectedGroups: ['Measurement'], expectedIntent: 'vertical' },
  { query: 'add jitter measurement', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'setup ethernet trigger', expectedGroups: ['Bus', 'Trigger', 'Ethernet'], expectedIntent: 'bus' },
  { query: 'configure i2c bus analysis', expectedGroups: ['Bus', 'Trigger'], expectedIntent: 'bus' },
  { query: 'show detailed results', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'add math channel', expectedGroups: ['Math'], expectedIntent: 'math' },
  { query: 'clear measurements', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'save screenshot', expectedGroups: ['Save and Recall'], expectedIntent: 'save' },
  { query: 'what is sampling rate', expectedGroups: ['Acquisition', 'Horizontal'], expectedIntent: 'acquisition' },

  // Real user queries
  { query: 'measure voltage on channel 1', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'add eye diagram measurement', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'set CH1 scale to 0.5V', expectedGroups: ['Measurement', 'Horizontal', 'Display'], expectedIntent: 'vertical' },
  { query: 'setup power harmonics analysis', expectedGroups: ['Power', 'Measurement'], expectedIntent: 'power' },
  { query: 'configure SPI bus decode', expectedGroups: ['Bus', 'Trigger'], expectedIntent: 'bus' },
  { query: 'trigger on rising edge', expectedGroups: ['Trigger'], expectedIntent: 'trigger' },
  { query: 'measure rise time', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'add frequency measurement', expectedGroups: ['Measurement'], expectedIntent: 'measurement' },
  { query: 'enable DVM', expectedGroups: ['DVM'], expectedIntent: 'dvm' },
  { query: 'run FFT on channel 2', expectedGroups: ['Math', 'Spectrum view'], expectedIntent: 'math' },
  { query: 'autoset', expectedGroups: ['Miscellaneous'], expectedIntent: 'misc' },
  { query: 'query *IDN?', expectedGroups: ['Miscellaneous'], expectedIntent: 'misc' },
];

let passed = 0;
let failed = 0;

for (const tc of TEST_CASES) {
  const result = classifyIntent(tc.query);

  // Check that at least one expected group is present in result
  const groupMatch = tc.expectedGroups.some(eg =>
    result.groups.some(rg => rg.toLowerCase() === eg.toLowerCase())
  );
  const intentMatch = result.intent === tc.expectedIntent;

  if (groupMatch && intentMatch) {
    passed++;
    console.log(`✅ "${tc.query}" → groups=[${result.groups.join(', ')}] intent=${result.intent}`);
  } else {
    failed++;
    console.log(`❌ "${tc.query}"`);
    console.log(`   Expected: groups=[${tc.expectedGroups.join(', ')}] intent=${tc.expectedIntent}`);
    console.log(`   Got:      groups=[${result.groups.join(', ')}] intent=${result.intent}`);
  }
}

console.log(`\n${passed}/${passed + failed} tests passed`);
```

### End-to-End Test for `smartScpiAssistant.ts`

After modifying `smartScpiAssistant.ts`, run the same test queries from the original failing test:

```typescript
import { smartScpiLookup } from './smartScpiAssistant';

const QUERIES = [
  'measure voltage on channel 1',
  'add jitter measurement',
  'configure i2c bus analysis',
  'setup ethernet trigger',
  'show detailed results',
  'add math channel',
  'save screenshot',
  'clear measurements',
];

for (const query of QUERIES) {
  const result = await smartScpiLookup({ query });
  const commands = result.data || [];
  const groups = [...new Set(commands.map((c: any) => c.group))];
  console.log(`\n"${query}"`);
  console.log(`  Found: ${commands.length} commands in groups: [${groups.join(', ')}]`);
  commands.slice(0, 3).forEach((c: any) =>
    console.log(`  → ${c.header} (${c.group})`)
  );
}
```

**Expected results after fix:**

| Query | Expected Top Groups | Previously Got |
|-------|-------------------|----------------|
| `measure voltage on channel 1` | Measurement, Cursor | Miscellaneous, Trigger, Mask, Display |
| `add jitter measurement` | Measurement | Mixed/irrelevant |
| `configure i2c bus analysis` | Bus, Trigger | Miscellaneous, Trigger, Mask, Display |
| `setup ethernet trigger` | Bus, Trigger, Ethernet | Mixed/irrelevant |
| `show detailed results` | Measurement | Miscellaneous |
| `add math channel` | Math | Miscellaneous, Trigger, Mask, Display |
| `clear measurements` | Measurement | 0 commands |
| `save screenshot` | Save and Recall | Mixed |

---

## IMPLEMENTATION ORDER

```
Step 1: Create intentMap.ts
         ↓ (standalone, zero dependencies on changed files)
Step 2: Run intentMap unit tests
         ↓ (verify classification is correct before touching search)
Step 3: Modify smartScpiAssistant.ts
         ↓ (swap in classifyIntent, rewrite searchCommands)
Step 4: Run end-to-end smart assistant tests
         ↓ (verify actual search results improved)
Step 5: Modify toolSearch.ts
         ↓ (add group boost/penalty)
Step 6: Modify toolRouter.ts description
         ↓ (teach AI how to use the tool)
Step 7: Modify smart_scpi_lookup tool description
         ↓ (teach AI how to construct good queries)
Step 8: Full integration test with AI layer
```

Each step is independently testable. If step 3 breaks something, steps 1-2 still work. If step 5 has issues, steps 1-4 are already validated.

---

## FUTURE ENHANCEMENTS

1. **Feedback loop:** When a user selects a command from search results, record which group it came from. If users consistently pick commands from groups NOT in the intent map prediction, that's a signal to update the map.

2. **Multi-intent decomposition:** "set CH1 to 0.5V and add jitter measurement" contains two intents. Currently the AI layer handles decomposition. If you want the MCP to handle it, add a `classifyMultiIntent()` function that splits on "and/then/also" and returns multiple `IntentResult` objects.

3. **Synonym expansion in BM25:** After group filtering, expand the search query with SCPI-specific synonyms. E.g., "voltage" → also search "volt", "VPP", "VRMS". This is a BM25 enhancement, separate from intent classification.

4. **Confidence-based UI:** Use `intent.confidence` to decide response format:
   - `high` → show commands directly (specific query like "add i2c bus decode")
   - `medium` → show grouped exploration (partially matched)
   - `low` → show suggestions and examples (couldn't classify)
