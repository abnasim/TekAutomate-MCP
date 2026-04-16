# TekAutomate RAG Corpus — Phase 1 (Static)

> Ships with app. Updated when docs change.

Built: 2026-03-13

## Structure

```
├── MEMORY.md                    Master knowledge document (1979 lines)
├── AI_SYSTEM.md                 AI integration reference (1240 lines)
├── BLOCKLY_SCHEMA.md            Block types, XML schema, validation (550 lines)
├── COMMANDS_CORPUS.md           SCPI & tm_devices knowledge base (1511 lines)
├── DEVICE_PROFILES.md           Device-specific knowledge (642 lines)
├── EXECUTE_FLOW.md              Execute page architecture (557 lines)
├── KNOWN_BUGS_AND_FIXES.md      Regression matrix & fixes (1315 lines)
│
└── corpus/
    ├── scpi/
    │   └── scpi_index.json      90 chunks — SCPI commands, syntax, patterns
    ├── tmdevices/
    │   └── tmdevices_index.json  43 chunks — tm_devices API reference
    ├── error_patterns/
    │   └── error_patterns_index.json  47 chunks — bugs, fixes, failure modes
    ├── templates/
    │   └── templates_index.json  36 chunks — template examples & patterns
    └── pyvisa_tekhsi/
        └── pyvisa_tekhsi_index.json  38 chunks — connection & protocol patterns
```

## Chunk Counts

| Corpus | Chunks | Size | Description |
|--------|--------|------|-------------|
| SCPI | 90 | 88K | Command syntax, params, family variants, screenshot patterns |
| tm_devices | 43 | 28K | API reference, connection, usage patterns, device classes |
| Error Patterns | 47 | 76K | Every documented bug with symptom/cause/fix |
| Templates | 36 | 68K | Golden examples, template rules, XML examples |
| PyVISA/TekHSI | 38 | 48K | Connection patterns, protocols, backend selection |
| **Total** | **254** | **308K** | |

## Markdown Documents

| Document | Lines | Purpose |
|----------|-------|---------|
| MEMORY.md | 1979 | Single source of truth — architecture, rules, all knowledge |
| AI_SYSTEM.md | 1240 | AI panel architecture, AiAction schema, query routing |
| BLOCKLY_SCHEMA.md | 550 | All block types, XML schema, DEVICE_CONTEXT rules, mutations |
| COMMANDS_CORPUS.md | 1511 | Command JSON schema, groups, extraction pipeline |
| DEVICE_PROFILES.md | 642 | Per-device SCPI, backends, firmware quirks |
| EXECUTE_FLOW.md | 557 | Execute page components, run log, step tracking |
| KNOWN_BUGS_AND_FIXES.md | 1315 | 28 bugs with code before/after, regression coverage |
| **Total** | **7794** | |

## Query Routing

```
User question → Signal detection → Corpus selection

hasSCPI?      → scpi_index + COMMANDS_CORPUS.md
hasTmDevices? → tmdevices_index + COMMANDS_CORPUS.md
hasError?     → error_patterns_index + KNOWN_BUGS_AND_FIXES.md
hasTemplate?  → templates_index + MEMORY.md
hasFlow?      → EXECUTE_FLOW.md + BLOCKLY_SCHEMA.md
hasDevice?    → DEVICE_PROFILES.md + pyvisa_tekhsi_index
hasAI?        → AI_SYSTEM.md

Always inject: current flow JSON + selected step (Phase 2 runtime)
```

## Usage in TekAutomate

### For Custom GPT
Upload all .md files + JSON indices as knowledge files.

### For Embedded RAG
1. Load JSON indices at app startup
2. On user query: detect signals → select corpora → retrieve top-N chunks
3. Assemble system prompt with retrieved chunks + live context
4. Send to LLM

### For Development Reference
Read MEMORY.md for complete app knowledge. Read KNOWN_BUGS_AND_FIXES.md before touching the generator.
