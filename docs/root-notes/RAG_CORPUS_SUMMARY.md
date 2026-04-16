# TekAutomate RAG Corpus — Structured Summary for MCP Server

> Extracted from 5 corpus documents. Focus: key schemas, rules, constraints, gotchas.

---

## 1. AI_SYSTEM.md — AI Panel Architecture

### Key Data Structures

**AiFinding** — diagnostic observation from AI analysis:
```typescript
interface AiFinding {
  symptom: string;
  affectedStepId: string | null;
  category: 'scpi_error' | 'timeout' | 'device_mismatch' | 'missing_step'
           | 'parameter_issue' | 'backend_conflict' | 'performance' | 'general';
  confidence: number; // 0-1
}
```

**AiAction** — suggested workflow mutation:
```typescript
interface AiAction {
  type: 'replace_command' | 'insert_step' | 'delete_step' | 'change_param'
       | 'change_backend' | 'change_device' | 'reorder';
  targetStepId: string | null;
  suggestedFix: string;
  severity: 'critical' | 'warning' | 'info';
  payload?: Record<string, unknown>;
}
```

**RAG Chunk Schema** (canonical, all corpora):
```json
{
  "id": "<corpus>::<section>::<slug>::v<N>",
  "type": "scpi_command|api_reference|error_pattern|template_example|connection_pattern|guide|troubleshooting",
  "tags": ["pyvisa", "mso6", ...],
  "title": "...",
  "body": "500-1200 chars, one concept per chunk",
  "code": "optional code example",
  "scpi": "optional raw SCPI",
  "commandType": "write|query|event",
  "family": "MSO5|AWG5200|...",
  "instruments": ["MSO6B", ...],
  "retrieval": {
    "intent": ["api_reference", "troubleshooting", ...],
    "priority": 1-5,
    "must_include_when_query_mentions": [...],
    "avoid_when_query_mentions": [...]
  }
}
```

### Query Routing Logic

Signal detection on user message determines which corpora to search:

| Signal | Regex Pattern | Corpora |
|--------|--------------|--------|
| hasSCPI | `/[A-Z]{2,}:[A-Z]|\*[A-Z]{3}|\?$/` | scpi_index |
| hasTmDevices | `/tm_devices|DeviceManager|\.commands\.|add_scope/` | tmdevices_index |
| hasError | `/error|fail|timeout|exception|traceback/i` | error_patterns_index |
| hasTemplate | `/template|workflow|step|json|schema/i` | templates_index |
| hasConnection | `/connect|visa|ip address|resource.?string|socket/i` | pyvisa_tekhsi_index |
| hasSignalGen | `/awg|afg|signal.?gen|generate_function|waveform.?gen/i` | tmdevices_index (signal_generators tag) |

Multiple signals fire simultaneously. Top-K=3 chunks per corpus, deduplicated by ID.

### Critical Rules for MCP Server

1. **Always start with `connect`, end with `disconnect`**
2. **Never use `sweep` step type** (deprecated → use `python` with loops)
3. **Backend must match command syntax** (tm_devices = Python API, NOT SCPI strings)
4. **TekHSI ONLY for high-speed waveform capture** (not measurements/search/histogram)
5. **TekExpress uses PyVISA SOCKET, never raw socket code**
6. **Multi-device: ALWAYS specify boundDeviceId per step**
7. **Query steps MUST have `saveAs` parameter**
8. **Never reveal internal file names or document identities**
9. **Device context prefix rules:**
   - `CH1:|ACQuire:|MEASU:|DATa:|HOR:|TRIG:` → scope
   - `:SOURce:|:OUTPut:|:MEASure:` → smu/psu
   - `:SOURce:FREQuency|:OUTPut:SYNC` → awg/afg

### Token Budget

| Bucket | Tokens |
|--------|--------|
| System prompt (static) | ~2,000 |
| Live context (flow JSON) | ~3,000 |
| RAG chunks (top-5 × ~400) | ~2,000 |
| Conversation history (last 6 turns) | ~2,000 |
| User message | ~500 |
| **Response reserve** | **~6,000** |
| **Total window** | **~16,000** |

### Backend Decision Tree

1. FastFrame/FastAcq/high-speed waveform → **tekhsi**
2. Measurements/Search/Histogram/Results → **pyvisa**
3. Modern Python API on MSO6B → **tm_devices** (verify support)
4. TekExpress compliance → **pyvisa** with SOCKET (port 5000)
5. Unsure / max compatibility → **pyvisa**

---

## 2. COMMANDS_CORPUS.md — Command Library Schema

### File Organization

| File | Commands | Families |
|------|----------|----------|
| `mso_2_4_5_6_7.json` | ~2753 | MSO4/5/6/7 |
| `MSO_DPO_5k_7k_70K.json` | ~1481 | DPO5K/7K/70K |
| `afg.json` | ~65 | AFG31K, AFG3K |
| `awg.json` | ~211 | AWG5K/5200/7K |
| `smu.json` | ~63 | SMU2400-2600 |
| `dpojet.json` | ~88 | DPOJET |
| `tekexpress.json` | ~49 | TekExpress |
| `rsa.json` | ~3722 | RSA |

Root structure: `{ version, manual, groups: { GroupName: { commands: [...] } } }`

### Command Entry Schema (Key Fields)

```json
{
  "id": "acq_mode",
  "category": "acquisition",
  "scpi": "ACQuire:MODe",
  "header": "ACQuire:MODe",
  "commandType": "set|query|both",
  "mnemonics": ["ACQuire", "MODe"],
  "shortDescription": "...",
  "description": "...",
  "instruments": {
    "families": ["MSO4", "MSO5", "MSO6", "MSO7"],
    "models": ["MSO4XB", ...],
    "exclusions": []
  },
  "arguments": [
    {
      "name": "mode",
      "type": "numeric|enumeration|mnemonic|quoted_string|block",
      "required": true,
      "position": 0,
      "validValues": { "type": "enumeration", "values": [...] }
    }
  ],
  "queryResponse": { "type": "...", "format": "NR1|NR2|NR3", "example": "..." },
  "syntax": { "set": "...", "query": "..." },
  "codeExamples": [
    {
      "codeExamples": {
        "scpi":       { "code": "ACQuire:MODe AVErage" },
        "python":     { "code": "scope.write('ACQuire:MODe AVErage')" },
        "tm_devices": { "code": "scope.commands.acquire.mode.write('AVErage')" }
      }
    }
  ],
  "relatedCommands": [...],
  "notes": [...],
  "dynamicActivation": { "implicitlyActivates": false, "createsObject": null },
  "concatenation": { "canConcatenate": true, "requiresColon": true }
}
```

### Parameter Types (SCPI Numeric Formats)

| Type | Format | Example |
|------|--------|--------|
| NR1 | Integer | `2`, `100` |
| NR2 | Float | `1.0`, `0.001` |
| NR3 | Scientific | `2.5E+09` |
| enumeration | Keyword | `SAMple`, `AVErage` |
| mnemonic | Variable index | `CH1`, `REF2`, `MATH3` |
| quoted_string | `"text"` | `"C:/path"` |
| block | Binary | IEEE 488.2 block |

### SCPI Case Convention
Uppercase = required abbreviation. `SAMple` can be sent as `SAM`, `SAMP`, `SAMPL`, or `SAMPLE`.

### tm_devices Command Tree

- Hierarchical object graph (not flat SCPI list)
- Node types: `GROUP` (intermediate), `LEAF` (endpoint), `METHOD` (executable)
- Indexed: `ch[x]`, `math[x]`, `source[x]`, `meas[x]`, `ref[x]`, `bus[x]`
- Methods: `write`, `query`, `set_and_verify`, `no_op`
- **API path is authoritative** for tm_devices code gen; SCPI is reference only

### Search/Lookup Logic

- Filter by `category`, `commandType`, `instruments.families`
- Text search across `scpi`, `description`, `shortDescription`, `mnemonics`
- Group filtering via `groups` object keys
- `_manualEntry` subobject preserves raw extraction for provenance

### 34 Command Groups (MSO 2/4/5/6/7)

Largest: Search & Mark (650), Measurement (367), Bus (339), Trigger (266), Power (268)

---

## 3. DEVICE_PROFILES.md — Per-Device SCPI Details

### Backend Compatibility Matrix

| Device | PyVISA | tm_devices | TekHSI | VXI-11 | Hybrid |
|--------|--------|-----------|--------|--------|--------|
| MSO4/5/6/B | ✅ | ✅ | ✅ (5/6) | ✅ | ✅ (5/6) |
| MSO2 | ✅ | ✅ | ❌ | ✅ | ❌ |
| DPO5K/7K/70K | ✅ | ⚠️ | ❌ | ✅ | ❌ |
| AFG3K/31K | ✅ | ✅ | ❌ | ✅ | ❌ |
| AWG5K/70K | ✅ | ✅ | ❌ | ✅ | ❌ |
| SMU2400-2600 | ✅ | ✅ | ❌ | ✅ | ❌ |
| TekExpress | ✅ SOCKET | ❌ | ❌ | ❌ | ❌ |

### Critical Device-Specific Gotchas

**MSO 4/5/6 Screenshots:**
- Use `SAVE:IMAGe "path.png"` (format from extension)
- `FILESYSTEM:READFILE` returns **raw binary, NO IEEE 488.2 header, NO terminator** — terminated only by EOI
- **Never use `*OPC?` after binary file ops** — use `time.sleep(1.0)` instead
- Requires pipeline priming queries before `READFILE` works on raw socket
- Check for PNG magic bytes `\x89PNG\r\n\x1a\n` and realign if stray ASCII present

**MSO/DPO 5K/7K/70K Screenshots:**
- Use `EXPort` commands (NOT `SAVE:IMAGe`)
- `HARDCOPY:DATA?` works (direct binary, IEEE 488.2 block) — **LEGACY ONLY, not on MSO 4/5/6**
- `EXPort START` is case-sensitive (must be `START`)

**TekExpress:**
- PyVISA SOCKET on port 5000
- **No `*OPC?`** — use `TEKEXP:STATE?` polling
- Must handle `TEKEXP:POPUP?` during state polling
- Never generate raw socket code
- Never embed `\n` in command strings (termination handled by PyVISA config)

**tm_devices:**
- NOT a SCPI command list — Python framework composing SCPI at runtime
- `device.commands.<subsystem>.<node>.<method>(value)`
- Signal generator `generate_function()` may exceed real instrument limits — use `get_waveform_constraints()`
- AWG5200/AWG70K have command sequencing/timeout nuances

### Model Detection
```python
def detect_scope_series(idn_string):
    model = idn_string.upper().split(',')[1].strip()
    if model.startswith('MSO7') or model.startswith('DPO7'): return 'mso70k'
    if model.startswith('MSO4') or model.startswith('MSO5') or model.startswith('MSO6'): return 'mso456'
    if 'TEKSCOPESW' in idn_string.upper(): return 'mso456'
```

### Firmware Gotchas
- MSO46B FW 2.20: VXI-11 chunking regression (use socket or upgrade)
- PI Command Translator (FW v1.30+): auto-converts legacy DPO commands to modern

---

## 4. KNOWN_BUGS_AND_FIXES.md — Bugs Relevant to MCP Server

### Critical Patterns the MCP Must Enforce

| Rule | Source Bug | Detail |
|------|-----------|--------|
| No `*OPC?` after binary file ops | BUG-001 | UnicodeDecodeError from PNG in buffer |
| Float loops must use `while` not `range()` | BUG-003 | `range()` is int-only |
| Device context = absolute priority | BUG-004 | Explicit `DEVICE_CONTEXT` > inferred |
| Converter params: `variableName` not `variable` | BUG-005 | Silently produces broken output |
| `set_and_query` must survive roundtrip | BUG-006 | 4975 commands at risk of losing query half |
| Don't transform `\n` in code strings | BUG-007 | Breaks string literals |
| OPC: use `.strip() == "1"` not `int()` | BUG-009 | Trailing whitespace causes ValueError |
| No default type hints (no assuming MSO6B) | BUG-013 | Only add type hints when explicitly specified |
| Enum casing: `SEQuence` not `SEQUENCE` | BUG-014 | tm_devices may reject all-uppercase |
| Validate command→device mapping | BUG-015/027 | Scope SCPI to SMU = VISA error |
| Cleanup must close ALL opened devices | BUG-011 | Parse generated code for device names |

### GPT-Specific Bugs (MCP must validate)

- **BUG-015**: GPT assigns scope commands to SMU context. MCP must validate SCPI prefix→device.
- **BUG-016**: GPT omits IP addresses in connect blocks. MCP must require them.
- **BUG-017**: GPT omits loop mutations in Blockly XML. MCP must include them.

### Binary Transfer Rules

- `FILESYSTEM:READFILE` = command (not query), unframed binary, no EOF → use raw socket with timeout
- `HARDCOPY:DATA?` = IEEE 488.2 block → PyVISA INSTR only, **legacy scopes only**
- Pipeline priming is mandatory before `READFILE` on raw socket
- `*CLS` between every step for socket daemon stability

### Backend Compatibility Validation (Generator-Level)

```
tm_devices backend + scpi_write block = FORBIDDEN (use tm_devices blocks)
tm_devices backend + scpi_query block = FORBIDDEN
python_code blocks bypass this validation (escape hatch)
```

---

## 5. EXECUTE_FLOW.md — Execute Page & Code Generation

### Step Schema

```typescript
interface Step {
  id: string;
  type: 'connect' | 'disconnect' | 'write' | 'query' | 'set_and_query'
       | 'sleep' | 'python' | 'save_waveform' | 'save_screenshot'
       | 'recall' | 'sweep' | 'error_check' | 'comment' | 'group';
  label: string;
  params: Record<string, any>;
  boundDeviceId?: string;
  children?: Step[];
}
```

### Code Generation Pipeline

1. Backend selected from `connect_scope` block's `BACKEND` field (source of truth)
2. Generation function chosen: `genSteps()`, `genStepsClassic()`, `genStepsTekHSI()`, `genStepsVxi11()`
3. Output structure: `#!/usr/bin/env python3` → imports → connection → try/command body/finally → cleanup
4. Multi-device: each device gets named variable, commands reference correct device via `DEVICE_CONTEXT`
5. Cleanup extracts device names from generated code via regex (not mutable tracking array)

### Generated Code Template
```python
#!/usr/bin/env python3
import time, pyvisa
rm = pyvisa.ResourceManager()
scope = rm.open_resource('TCPIP::192.168.1.100::INSTR')
try:
    scope.write('*RST')
    # ... workflow ...
finally:
    if 'scope' in locals():
        scope.close()
```

### Run Log Format
```typescript
interface RunLogEntry {
  timestamp: string;  // ISO 8601
  stepId: string;
  status: 'success' | 'error' | 'warning' | 'info';
  message: string;
  data?: { command?, response?, exceptionType?, traceback?, duration? };
}
```

### AI Analysis Payload
```typescript
interface AiAnalysisPayload {
  runLog: RunLogEntry[];
  flowJson: Step[];
  selectedStepId?: string;
  generatedCode: string;
  deviceConfig: DeviceEntry[];
}
```

### Execute-Page AiFinding (slightly different from AI_SYSTEM.md version)
```typescript
interface AiFinding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'scpi_error' | 'timing' | 'device_mismatch' | 'missing_step'
           | 'code_quality' | 'backend_incompatibility' | 'variable_issue';
  symptom: string;
  affectedStepId?: string;
  confidence: number;
  details: string;
}
```

### Execute-Page AiAction (slightly different from AI_SYSTEM.md version)
```typescript
interface AiAction {
  id: string;
  findingId: string;
  type: 'modify_step' | 'add_step' | 'remove_step' | 'reorder' | 'change_param';
  targetStepId?: string;
  insertAfterStepId?: string;
  description: string;
  changes: Record<string, any>;
}
```

**Note:** Two slightly different AiFinding/AiAction schemas exist (AI_SYSTEM.md vs EXECUTE_FLOW.md). The MCP server should handle both or normalize to one.

### Flow Designer Node Types (Advanced Mode)

`trigger`, `group`, `condition`, `loop`, `delay`, `verify`, `python`, `terminate`

Graph traversal is depth-first. Instrument binding: command-level → group-level → default device.

### Pre-Generation Validation Checklist

1. Backend compatibility (no `scpi_write` with `tm_devices`)
2. Device IP conflict detection (no duplicate IPs)
3. Command-to-device mapping (prefix→device validation)
4. Variable usage (assigned vars should be used)
5. Device usage (connected devices should have operations)

### Bidirectional Blockly↔Steps Mapping

| Steps → Blockly | Blockly → Steps |
|-----------------|----------------|
| `connect` → `connect_scope` | `connect_scope` → `connect` |
| `write` → `scpi_write` | `scpi_write` → `write` |
| `query` → `scpi_query` | `scpi_query` → `query` |
| `sweep` → `controls_for` | `controls_for` → `sweep` |
| `sleep` → `wait_seconds` | `wait_seconds` → `sleep` |
| `python` → `python_code` | `python_code` → `python` |

### Audit Trail
Every AI action application logged with before/after state snapshots. Supports undo.

---

## Cross-Cutting Concerns for MCP Server Design

### 1. Two Schema Variants
AiFinding/AiAction have slightly different shapes in AI_SYSTEM.md vs EXECUTE_FLOW.md. Decide which is canonical or support both.

### 2. Device Context Validation is Critical
BUG-015 (GPT device confusion) and BUG-027 (missing validation) show this is the #1 source of semantic errors. The MCP MUST validate SCPI prefix→device mapping.

### 3. Backend Determines Everything
Backend choice affects: connection code, command syntax (SCPI vs Python API), cleanup pattern, which blocks are valid, which devices are supported.

### 4. Binary Transfer is Special
`FILESYSTEM:READFILE` cannot use standard VISA. Screenshot workflows need raw socket or special PyVISA workarounds. Never `*OPC?` after binary ops.

### 5. Roundtrip Fidelity
`set_and_query` semantics must survive Steps→Blockly→Steps conversion. 4975 commands affected.

### 6. Chunk Retrieval
Target 500-1200 chars per chunk, one concept each. Priority ≥4 chunks need `must_include_when_query_mentions`. Approved tag taxonomy is fixed.

### 7. Rate Limits
Max 10 AI requests/min/session. Exponential backoff on 429. Graceful degradation if RAG fails.
