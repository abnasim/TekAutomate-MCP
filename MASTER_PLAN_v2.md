# TekAutomate MCP — Master Implementation Plan v2

Everything discussed, consolidated into one document. No code — just detailed plans.

---

## TABLE OF CONTENTS

1. [Search Fix: intentMap.ts Compound Patterns](#1-search-fix-intentmapts-compound-patterns)
2. [Search Fix: Value Detection — Stop Showing Menus](#2-search-fix-value-detection)
3. [Search Fix: Exact Header Match Returns 1 Not 8](#3-search-fix-exact-header-match)
4. [Auto-Shortcut Creation via System Prompt](#4-auto-shortcut-creation)
5. [Shortcut Persistence Across Restarts](#5-shortcut-persistence)
6. [MicroTool Steps Field](#6-microtool-steps-field)
7. [AI Tool Descriptions](#7-ai-tool-descriptions)
8. [AI System Prompt Additions](#8-ai-system-prompt)
9. [Testing](#9-testing)
10. [Implementation Order](#10-implementation-order)

---

## 1. Search Fix: intentMap.ts Compound Patterns

### Problem
"set horizontal scale 10000" returns `intent: vertical` because bare `scale` matches
before `horizontal` in the SUBJECT_GROUP_MAP pattern order. The result says
"8 vertical Commands Found" — wrong group, too many results.

### Root Cause
In SUBJECT_GROUP_MAP, the bare keyword patterns are ordered:
1. `scale` → groups: ['Measurement', 'Horizontal', 'Display'], intent: 'vertical'
2. `horizontal` → groups: ['Horizontal'], intent: 'horizontal'

"set horizontal scale" hits `scale` first → wrong classification.

### Fix
Add compound two-word patterns BEFORE their bare keyword counterparts in
SUBJECT_GROUP_MAP. The rule: **compound before bare, always.**

### Patterns to Add (insert before existing bare patterns)

```
"horizontal scale"    → groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_scale'
"horizontal position" → groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_position'
"horizontal offset"   → groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_offset'
"horizontal delay"    → groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_delay'
"horizontal mode"     → groups: ['Horizontal'], intent: 'horizontal', subject: 'horizontal_mode'
"channel scale"       → groups: ['Measurement'], intent: 'vertical', subject: 'channel_scale'
"channel offset"      → groups: ['Measurement'], intent: 'vertical', subject: 'channel_offset'
"channel bandwidth"   → groups: ['Measurement'], intent: 'vertical', subject: 'channel_bandwidth'
"channel position"    → groups: ['Measurement'], intent: 'vertical', subject: 'channel_position'
"trigger level"       → groups: ['Trigger'], intent: 'trigger', subject: 'trigger_level'
"trigger slope"       → groups: ['Trigger'], intent: 'trigger', subject: 'trigger_slope'
"trigger holdoff"     → groups: ['Trigger'], intent: 'trigger', subject: 'trigger_holdoff'
"trigger mode"        → groups: ['Trigger'], intent: 'trigger', subject: 'trigger_mode'
"display scale"       → groups: ['Display'], intent: 'display', subject: 'display_scale'
```

### Test Cases
| Query | Before | After |
|-------|--------|-------|
| "set horizontal scale 10000" | intent=vertical, groups=[Measurement] | intent=horizontal, groups=[Horizontal] |
| "set channel scale 0.5" | intent=vertical, groups=[Measurement] | intent=vertical, groups=[Measurement] (same but explicit) |
| "set trigger level 1.5V" | intent=trigger, groups=[Trigger] | intent=trigger, groups=[Trigger] (explicit compound) |
| "scale" (bare) | still falls through to existing bare pattern | unchanged |

---

## 2. Search Fix: Value Detection

### Problem
User types "set horizontal scale 10000" — this is a specific SET command with a value.
The system returns 8 commands and a menu asking "Which command interests you?"
The user doesn't want a menu. They want the command set to 10000.

### Root Cause
`smartLookup()` treats every query the same — broad exploration with 8 results and
conversational prompts. No awareness of whether the user already provided the value.

### Fix
Add value detection at the top of `smartLookup()`. If the query contains a numeric
value or a "to VALUE" pattern, treat it as a specific SET request:

1. Detect embedded value via regex patterns:
   - Trailing number: `scale 10000`
   - "to" pattern: `set scale to 0.5`
   - Unit suffix: `0.5V`, `10ns`, `1MHz`

2. When value is detected:
   - Filter results to SET-capable commands only (commandType 'set' or 'both')
   - Return only top 1 command (not 8)
   - Generate a direct "here's your command" response, not an exploratory menu
   - Include the concrete command string with value filled in

### Value Regex Patterns
```
Trailing number:  /\b(\d+\.?\d*(?:e[+-]?\d+)?)\s*$/i
"to" pattern:     /\bto\s+(\d+\.?\d*(?:e[+-]?\d+)?)/i
With unit:        /\b(\d+\.?\d*)\s*(?:v|mv|ns|us|ms|s|hz|khz|mhz|ghz|db|dbm)\b/i
```

### Response Format (when value detected)
Instead of the 8-result menu with emoji headers, return:

```
**HORizontal:MODE:SCAle**
This command sets or queries the horizontal scale.

**Set:** `HORizontal:MODE:SCAle 10000`
**Query:** `HORizontal:MODE:SCAle?`

**Range:** <min> to <max> (if available from arguments)
**Families:** MSO5000, DPO5000, DPO7000, DPO70000
**Group:** Horizontal
```

### Where to Modify
`smartScpiAssistant.ts` → `smartLookup()` method, add value detection after
intent classification but before the `searchCommands()` result is processed.

Also add a new private method `generateSetCommandResponse()` that formats the
direct response (no menu, no "which command interests you").

### Test Cases
| Query | Before | After |
|-------|--------|-------|
| "set horizontal scale 10000" | 8 commands, menu | 1 command: `HORizontal:MODE:SCAle 10000` |
| "set channel scale 0.5" | 8 commands, menu | 1 command: `CH<x>:SCAle 0.5` |
| "horizontal scale" (no value) | 8 commands, menu | Still shows exploration (no value detected) |
| "set trigger level to 1.5V" | 8 commands | 1 command: `TRIGger:A:LEVel 1.5` |

---

## 3. Search Fix: Exact Header Match Returns 1 Not 8

### Problem
User types exact SCPI header `HORizontal:MODE:SCAle` and still gets 8 results.

### Root Cause
The exact match check in `searchCommands()` compares against `intent.subject`,
not the full query. The subject is "horizontal_scale" (derived from intent map),
not the literal header string. So exact match never fires.

Also, when exact match DOES fire, it returns `slice(0, 8)` — should be 1 for
a true exact match.

### Fix
Two changes in `searchCommands()`:

1. Check exact match against BOTH `intent.subject` AND the original `request.query`
   (pass the original query through to searchCommands, or check it in smartLookup before
   calling searchCommands)

2. When exact match fires, return `slice(0, 1)` not `slice(0, 8)`. If someone typed
   the exact header, they want that one command, not 8 relatives.

### Where to Modify
Option A: In `smartScpiAssistant.ts` → `smartLookup()`, add an exact header check
BEFORE calling `searchCommands()`:
- Try `commandIndex.getByHeader(request.query)` directly
- If found, return immediately with that 1 command, skip all search logic

Option B: In `searchCommands()`, pass the original query in addition to intent,
and try exact header match against it.

Option A is cleaner — fast path for exact headers, no unnecessary search.

### Test Cases
| Query | Before | After |
|-------|--------|-------|
| `HORizontal:MODE:SCAle` | 8 results | 1 exact result |
| `CH1:SCAle` | multiple results | 1 exact result |
| `ACQuire:STATE` | multiple results | 1 exact result |
| `measure voltage` (not a header) | search as normal | search as normal |

---

## 4. Auto-Shortcut Creation

### What Already Exists (Zero Code Needed)

| Component | Status | File |
|-----------|--------|------|
| `tek_router({ action: "create" })` | ✅ Works | toolRouter.ts → handleCreate() |
| `buildManagedTool()` | ✅ Works | toolRouter.ts |
| `buildTemplateHandler()` | ✅ Works | toolRouter.ts — creates handler from toolSteps |
| `validateTool()` | ✅ Works | toolValidation.ts |
| `registry.register()` | ✅ Works | toolRegistry.ts |
| `rebuildRouterIndexes()` | ✅ Works | toolRouter.ts — rebuilds BM25 + semantic |
| Trigger index for instant lookup | ✅ Works | toolRegistry.ts |

### The Flow (How It Works)

```
Step 1: AI completes a multi-step workflow
        (4-6 tek_router exec calls, all return ok:true)

Step 2: System prompt instructs AI to auto-save
        AI calls: tek_router({
          action: "create",
          toolId: "shortcut:jitter_test",
          toolName: "Jitter Test Setup",
          toolDescription: "Add TJ measurement on CH1 with results",
          toolTriggers: ["jitter test", "add jitter", "tj measurement"],
          toolTags: ["measurement", "jitter", "tj"],
          toolCategory: "shortcut",
          toolSteps: [
            { type: "write", params: { command: "MEASUrement:ADDMEAS TJ" } },
            { type: "write", params: { command: "MEASUrement:MEAS1:SOUrce CH1" } },
            { type: "write", params: { command: "MEASUrement:RESUlts:CURRentacq:ENABle ON" } }
          ]
        })

Step 3: MCP registers the shortcut
        handleCreate() → buildManagedTool() → validateTool() → registry.register()
        rebuildRouterIndexes() — BM25 + trigger index updated

Step 4: Shortcut is immediately searchable
        Next search for "jitter test" → trigger index match → score 3.0
        (higher than any BM25 result at ~1.2)

Step 5: AI executes shortcut in 1 call instead of 6
        tek_router({ action: "exec", toolId: "shortcut:jitter_test", args: {} })
        Handler runs all 3 SCPI commands as a batch
```

### What This Means for Token Cost

```
Without shortcut: 6 tool calls, ~940 tokens
With shortcut:    2 tool calls (search + exec), ~320 tokens
Savings:          ~65% fewer tokens, 3x fewer round trips
```

### Management (Already Works)

```
List all shortcuts:
  tek_router({ action: "list" })
  → filter where category === "shortcut"

Delete a bad shortcut:
  tek_router({ action: "delete", toolId: "shortcut:bad_one" })
  → removes from registry, rebuilds index

Update a shortcut:
  tek_router({ action: "update", toolId: "shortcut:jitter_test", toolSteps: [...] })
  → overwrites with new steps
```

---

## 5. Shortcut Persistence Across Restarts

### Problem
Runtime-created shortcuts live in memory only. Server restart = all auto-created
shortcuts are lost.

### Fix
Add persist/load functions in `routerIntegration.ts`, wired into the existing
5-minute timer that already persists usage stats.

### Data Model
```json
// File: data/runtime_shortcuts.json
[
  {
    "id": "shortcut:jitter_test",
    "name": "Jitter Test Setup",
    "description": "Add TJ measurement on CH1 with results",
    "triggers": ["jitter test", "add jitter", "tj measurement"],
    "tags": ["measurement", "jitter", "tj"],
    "category": "shortcut",
    "steps": [
      { "type": "write", "params": { "command": "MEASUrement:ADDMEAS TJ" } },
      { "type": "write", "params": { "command": "MEASUrement:MEAS1:SOUrce CH1" } },
      { "type": "write", "params": { "command": "MEASUrement:RESUlts:CURRentacq:ENABle ON" } }
    ],
    "createdAt": 1711900000000
  }
]
```

### Changes Required

#### routerIntegration.ts
1. Add `persistRuntimeShortcuts()` function
   - Gets all tools from registry where category === 'shortcut'
   - Excludes builtin shortcut IDs (screenshot, bus_decode, scpi_search, etc.)
   - Serializes to JSON and writes to `data/runtime_shortcuts.json`

2. Add `loadRuntimeShortcuts()` function
   - Reads `data/runtime_shortcuts.json` at boot
   - For each entry, creates a MicroTool using `buildTemplateHandler()` for the handler
   - Registers with `registry.register()`
   - Skips any that already exist (builtins loaded first)

3. Wire into `bootRouter()`
   - Call `loadRuntimeShortcuts()` after `hydrateAllTools()` completes
   - Add `persistRuntimeShortcuts()` to the existing 5-minute `setInterval` timer

#### Builtin Shortcut IDs to Exclude from Persistence
```
shortcut:screenshot
shortcut:save_waveform
shortcut:scpi_search
shortcut:validate_flow
shortcut:scpi_verify
shortcut:bus_decode
shortcut:status_decode
```
Any shortcut ID NOT in this list = runtime-created = should be persisted.

### Estimated Size
~80 lines of production code in routerIntegration.ts.

---

## 6. MicroTool Steps Field

### Problem
`buildTemplateHandler()` bakes `toolSteps` into a closure. When we persist runtime
shortcuts, we need the original steps back. Currently no way to get them from a
registered MicroTool.

### Fix
Add optional `steps` field to the `MicroTool` interface in `toolRegistry.ts`:

```
steps?: Array<Record<string, unknown>>
```

Then in `buildManagedTool()` in `toolRouter.ts`, store the steps:

```
steps: steps.length > 0 ? steps : existing?.steps
```

The persist function reads `tool.steps` to serialize. The load function passes
`steps` to `buildTemplateHandler()` to recreate the handler.

### Estimated Size
1 line in toolRegistry.ts (interface), 1 line in toolRouter.ts (assignment).

---

## 7. AI Tool Descriptions

### Problem
The AI doesn't know how to construct good search queries or chain search→exec calls.
Tool descriptions are too generic.

### Already Done (from IMPLEMENTATION_PLAN.md)
✅ `tek_router` description updated with usage instructions, examples, workflow patterns
✅ `smart_scpi_lookup` description updated with NL examples and return format

### Additional Enhancement: Workflow Patterns
The tool description teaches mechanics (how to search, how to exec).
But it doesn't teach domain workflows (what commands go together).

Add workflow examples to the `tek_router` description or to the system prompt:

```
Common workflows:
- Measurement: ADDMEAS <type> → MEAS:SOUrce <channel> → RESUlts:ENABle ON
- Channel setup: CH<x>:SCAle → CH<x>:OFFSet → CH<x>:BANdwidth
- Trigger: TRIGger:A:TYPe → TRIGger:A:LEVel → TRIGger:A:EDGE:SLOpe
- Acquisition: ACQuire:MODe → ACQuire:STOPAfter → ACQuire:STATE RUN
```

---

## 8. AI System Prompt Additions

### Auto-Shortcut Instruction
Add to whatever system prompt your AI chat layer uses:

```
## Auto-Save Successful Workflows

When you successfully complete a multi-step SCPI workflow (3 or more
sequential tek_router exec calls that all returned ok:true), save it
as a reusable shortcut by calling:

tek_router({
  action: "create",
  toolId: "shortcut:<descriptive_snake_case_name>",
  toolName: "<Human Readable Name>",
  toolDescription: "<What this workflow does>",
  toolTriggers: ["<phrase1>", "<phrase2>", "<phrase3>"],
  toolTags: ["<keyword1>", "<keyword2>"],
  toolCategory: "shortcut",
  toolSteps: [<the exact steps you just executed, in order>]
})

Rules for triggers:
- Include 3-5 natural language phrases
- Cover different phrasings: "jitter test", "add jitter", "measure jitter"
- Include abbreviations: "fft", "dvm", "spi"

After creating, confirm:
"Saved as a reusable shortcut. Next time just say '<trigger phrase>'."
```

### Workflow Knowledge
```
## Oscilloscope Workflow Patterns

When setting up a measurement:
1. ADDMEAS <type> (e.g., TJ, RISE, FREQuency, EYEHEIGHT)
2. Set source → MEAS:SOUrce <channel>
3. Optionally enable results → RESUlts:ENABle ON

When configuring a channel:
1. Scale → CH<x>:SCAle <value>
2. Offset → CH<x>:OFFSet <value>
3. Bandwidth → CH<x>:BANdwidth <value>

When starting acquisition:
1. Mode → ACQuire:MODe <SAMPLE|AVERAGE|ENVELOPE>
2. Stop after → ACQuire:STOPAfter <RUNSTop|SEQuence>
3. Run → ACQuire:STATE RUN
```

### Token Cost
~250 tokens total for both prompt additions. Negligible.

---

## 9. Testing

### Test Files (already provided)
- `test_intent_classification.js` — tests classifyIntent() regex patterns
- `test_smart_search_e2e.js` — tests full search returns right groups
- `test_router_search.js` — tests router path + shortcut create/search/exec/delete
- `run_all_tests.js` — runs all 3 in order, stops on first failure

### Additional Tests Needed for New Fixes

Add to `test_intent_classification.js`:
```
{ query: 'set horizontal scale 10000', expectGroups: ['Horizontal'], expectIntent: 'horizontal' }
{ query: 'set channel scale 0.5', expectGroups: ['Measurement'], expectIntent: 'vertical' }
{ query: 'set trigger level 1.5', expectGroups: ['Trigger'], expectIntent: 'trigger' }
{ query: 'horizontal mode', expectGroups: ['Horizontal'], expectIntent: 'horizontal' }
```

Add to `test_smart_search_e2e.js`:
```
{ query: 'set horizontal scale 10000',
  expectMaxResults: 1,   // value detected = single result
  expectGroups: ['Horizontal'] }
{ query: 'HORizontal:MODE:SCAle',
  expectMaxResults: 1,   // exact header = single result
  expectGroups: ['Horizontal'] }
```

---

## 10. Implementation Order

```
Phase 1: Search Fixes
══════════════════════
Step 1.1: Add compound patterns to intentMap.ts
          (horizontal scale, channel scale, trigger level, etc.)
          Test: run test_intent_classification.js

Step 1.2: Add exact header fast-path in smartLookup()
          (check commandIndex.getByHeader() before search)
          Test: "HORizontal:MODE:SCAle" returns 1 result

Step 1.3: Add value detection in smartLookup()
          (regex for trailing numbers, "to <value>", unit suffixes)
          Test: "set horizontal scale 10000" returns 1 result with value

Step 1.4: Add generateSetCommandResponse() method
          (clean response format for SET commands, no menu)
          Test: response shows concrete command, not 8-item menu

Phase 2: Auto-Shortcut System
══════════════════════════════
Step 2.1: Add steps field to MicroTool interface
          (1 line in toolRegistry.ts)

Step 2.2: Store steps in buildManagedTool()
          (1 line in toolRouter.ts)

Step 2.3: Add system prompt instruction
          (paste auto-save text + workflow patterns)
          Test: AI creates shortcut after successful workflow

Step 2.4: Add persistRuntimeShortcuts() to routerIntegration.ts
          (~40 lines)

Step 2.5: Add loadRuntimeShortcuts() to routerIntegration.ts
          (~40 lines)

Step 2.6: Wire persist/load into bootRouter() and timer
          (3 lines)
          Test: create shortcut → restart server → shortcut still searchable

Phase 3: Full Integration Test
══════════════════════════════
Step 3.1: Run all test scripts
Step 3.2: Manual test: ask AI to setup jitter test
          → verify 4-6 exec calls → auto-creates shortcut
Step 3.3: New conversation: say "jitter test"
          → verify finds shortcut via trigger match → 1 call
Step 3.4: Restart server → verify shortcut persisted
```

---

## Summary: All Changes by File

| File | Changes | Est. Lines |
|------|---------|------------|
| `intentMap.ts` | Add ~14 compound patterns to SUBJECT_GROUP_MAP | 14 |
| `smartScpiAssistant.ts` | Add exact header fast-path in smartLookup() | 10 |
| `smartScpiAssistant.ts` | Add value detection regex + early return | 20 |
| `smartScpiAssistant.ts` | Add generateSetCommandResponse() method | 25 |
| `toolRegistry.ts` | Add `steps?` field to MicroTool interface | 1 |
| `toolRouter.ts` | Store steps in buildManagedTool() | 1 |
| `routerIntegration.ts` | Add persistRuntimeShortcuts() | 40 |
| `routerIntegration.ts` | Add loadRuntimeShortcuts() | 40 |
| `routerIntegration.ts` | Wire into bootRouter() + timer | 3 |
| System prompt | Auto-save instruction + workflow patterns | ~30 lines prompt |
| Test files | Add new test cases for compound/value/exact | ~15 |
| **TOTAL** | | **~170 lines production code** |
