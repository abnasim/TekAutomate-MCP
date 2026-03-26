# MCP Server Implementation Notes

## What I Know (from full code review)

### Command JSON Structure (8 files, 8430 commands)
- **mso_2_4_5_6_7.json**: 2753 cmds, ALL have _manualEntry, 843 empty syntax
- **MSO_DPO_5k_7k_70K.json**: 1479 cmds, ALL have _manualEntry, 8 empty syntax
- **rsa.json**: 3722 cmds, ALL have _manualEntry, 218 empty syntax
- **awg.json**: 211 cmds, NO _manualEntry, ALL empty syntax (simpler format)
- **afg.json**: 65 cmds, NO _manualEntry, 63 empty syntax
- **smu.json**: 63 cmds, NO _manualEntry, ALL empty syntax
- **dpojet.json**: 88 cmds, NO _manualEntry, ALL empty syntax
- **tekexpress.json**: 49 cmds, NO _manualEntry, 0 empty syntax, HAS instruments field

### Two Command Shapes
1. **Rich (MSO/DPO/RSA)**: Has _manualEntry with structured syntax {set, query}, 
   codeExamples {scpi, python, tm_devices}, mnemonics[], relatedCommands[]
2. **Simple (AWG/AFG/SMU/DPOJET)**: Only has scpi, description, params[], example
   No _manualEntry. Must use top-level fields directly.

### Bug 1 Fix: familyMatches() → always return true
- Zero files have per-command instruments.families (except tekexpress)
- Family is file-level only. Filter by file selection, not command metadata.

### Bug 2 Fix: toCommandRecord() extraction priority
- IF _manualEntry exists → use its header, commandType, syntax, examples, mnemonics, relatedCommands, notes
- ELSE → use top-level scpi as header, infer commandType from scpi/?/params, use top-level examples
- _manualEntry.syntax is already {set, query} object (not array)
- _manualEntry.examples[].codeExamples.scpi.code → actual SCPI string
- Top-level syntax is string[] (often unparseable "set query" concatenated)

### Bug 3 Fix: Empty syntax fallback
- 843 commands in MSO file have syntax: [] but _manualEntry.syntax has correct data
- If after extraction syntax.set AND syntax.query still empty:
  - If scpi ends with ? → syntax.query = scpi
  - Else → syntax.set = scpi, syntax.query = scpi + '?'

### Client-Side Action Contract (from aiActions.ts)
Valid action types: set_step_param, insert_step_after, remove_step, 
  add_error_check_after_step, replace_sleep_with_opc_query
Action shape: { id, action_type, target_step_id?, confidence?, reason?, payload? }

### Valid Step Types (from project summary)
connect, disconnect, write, query, set_and_query, sleep, python, comment,
save_waveform, save_screenshot, recall, sweep, error_check, group, tm_device_command

### RAG Corpus
- 254 chunks across 5 corpora (scpi: 90, tmdevices: 43, errors: 47, templates: 36, pyvisa: 38)
- Plus 6 thin tm_devices_chunks.jsonl entries (need expansion to 200-400)
- Chunk schema: {id, type, tags, title, body, code?, scpi?, family?, retrieval?}

### TekAcademy
- 51 articles across 5 categories
- Key knowledge: backend decision tree, SCPI patterns, connection types, error handling
- All code examples use real SCPI commands and real Python patterns

### Backend Rules
- pyvisa = default for all standard SCPI
- tm_devices = Python object API, never raw SCPI strings
- TekHSI = ONLY for high-speed waveform capture, user must explicitly request
- Socket NOT supported with tm_devices
- TekExpress = SCPI over PyVISA SOCKET (port 5000), no *OPC? → use TEKEXP:STATE? polling
