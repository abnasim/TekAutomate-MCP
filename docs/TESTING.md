# TekAutomate — Test Suite Reference

Quick-reference for every npm test command, what it tests, how long it takes, and where to find results.

---

## Quick command cheat-sheet

```
npm test                    Unit tests (all Jest suites)
npm run test:scpi           SCPI command JSON structure + generated code
npm run test:scpi-schema    SCPI parameter exposure (AJV schema)
npm run test:product        Every command → step → Python  (~13k commands)
npm run test:param-pipeline Every {param} resolves through pipeline (~8k commands)
npm run test:generator      appGenerator.ts function-level unit tests
npm run test:python-validate Generated Python compiles + runs with mock PyVISA
npm run test:e2e            All Playwright E2E tests (requires dev server)
npm run test:regression     Regression scenarios only (Playwright, ~60s)
npm run test:ci             Full CI sequence: unit → scpi → e2e
```

Open the live Playwright UI runner (highlights pass/fail visually):
```
npm run test:e2e:ui
```

---

## Suite details

### `npm test` — Unit tests (Jest)

**~seconds. Run this before every commit.**

| File | What it covers |
|------|----------------|
| `src/generators/stepToPython.test.ts` | write, query, sleep, comment, python, set_and_query, groups, edge cases, connection types |
| `src/generators/appGenerator.test.ts` | 38 tests on the extracted `appGenerator.ts`: substituteSCPI, genStepsClassic, genStepsTekHSI, genStepsVxi11, multi-device, mutation checks |
| `src/generators/appGenerator.negative.test.ts` | 33 negative/edge-case tests: missing params, empty commands, null values, deeply nested groups |
| `src/generators/generatorSnapshots.test.ts` | Snapshot regression: generated Python frozen for known step sequences |
| `src/generators/generatorEdgeCases.test.ts` | Edge cases: connect steps emit no SCPI, empty groups, invalid command strings |
| `src/generators/paramBinding.test.ts` | Parameter exposure & binding: `{param}` → UI → generator → Python value |
| `src/generators/realGeneratorPaths.test.ts` | Replicates complex paths from App.tsx generate logic (TekHSI, Vxi11, multi-device) |
| `src/validation/scpiCommandValidator.test.ts` | Command JSON structure completeness per device family |
| `src/validation/scpiParameterExposure.test.ts` | AJV schema: every command has identifier; `{param}` commands declare arguments/params |
| `src/validation/generatedCodeValidator.test.ts` | The validator utility itself (validates valid/invalid Python scripts) |
| `src/generators/pythonRuntimeValidation.test.ts` | Generated script passes `py_compile` and runs with mock PyVISA *(skips if Python not on PATH)* |

Report: `test-report/report.html` — open it in any browser.

---

### `npm run test:scpi` — SCPI command JSON validation

**~seconds. Validates the raw command JSON files.**

Checks per command:
- Required fields present (Group, Syntax, Set/Query indicators, Arguments, Examples)
- Generated Python write step contains the expected SCPI string
- Results grouped by **device family** with a confidence score

Device families: `afg`, `awg`, `smu`, `rsa`, `tekexpress`, `dpojet`, `MSO_DPO_5k_7k_70K`, `mso_2_4_5_6_7`

Report: `test-report/scpi-report.html`

---

### `npm run test:scpi-schema` — SCPI parameter exposure (schema)

**~seconds. Validates JSON parameter definitions with AJV.**

- Every command has a unique identifier
- Commands with `{param}` in their SCPI string declare matching `arguments` or `params` entries
- No orphaned placeholders

---

### `npm run test:product` — Product validation pipeline

**~minutes. 13,225+ commands.**

Loads every command from every JSON file, builds a step, runs through the real generator, validates the Python output.

Per command it checks:
- Generator does not throw
- `scpi.write(` or `scpi.query(` present in output
- No unresolved `{param}` placeholders in write/query strings
- SCPI command header appears in output

Output: grouped by device family + command group with a confidence score (`X/Y passing`).

---

### `npm run test:param-pipeline` — Parameter pipeline

**~minutes. 8,793+ parameterized commands.**

For every command with `{param}` placeholders:
- Substitutes realistic test values
- Asserts the resolved value appears in the generated Python
- Asserts no `{param}` remains unresolved
- Reports which commands are partially or fully broken

---

### `npm run test:generator` — appGenerator unit tests

**~seconds. Function-level tests on the extracted generator.**

Runs `appGenerator.test.ts` + `appGenerator.negative.test.ts` in verbose mode so you see every individual test name. Useful for diagnosing generator regressions without running the full suite.

---

### `npm run test:python-validate` — Python compile + runtime

**~seconds. Requires Python on PATH.**

- Generates a script for a known step sequence
- Runs `python -m py_compile` on it (syntax check)
- Runs it with a mock PyVISA module (no hardware needed)
- Skips gracefully if Python is not installed

---

### `npm run test:e2e` — Full Playwright E2E suite

**~minutes. Requires `npm start` to be running in another terminal first.**

| File | Scenarios |
|------|-----------|
| `e2e/export-python.spec.ts` | Export Python from a fresh build; assert header, boilerplate, script name |
| `e2e/export-variations.spec.ts` | Multiple step/config combos: write, query, sleep, set_and_query, backends, multi-device |
| `e2e/e2e-scenarios.spec.ts` | Minimal sequence, multi-device flow, TekHSI steps, invalid command prevention |
| `e2e/scpi-corpus.spec.ts` | Data-driven: 100 SCPI commands from JSON files, parameter variations, collect all generated Python for analysis; outputs `e2e-output/analysis-report.md` |
| `e2e/regression.spec.ts` | All regression scenarios (see below) |

Artifacts: `e2e-output/` — every downloaded `.py` file plus `analysis-report.md`.

---

### `npm run test:regression` — Regression scenarios only

**~60 seconds. The most targeted test to run when you change the generator.**

Runs only `e2e/regression.spec.ts`. 14 named scenarios:

#### Group 1 — SCPI Command String Integrity

Does the exported file contain the correct, fully-resolved command string?

| ID | Device | Command | Param | What it catches |
|----|--------|---------|-------|-----------------|
| R1.1 | MSO | `CH1:SCAle` | `1.0` | `{value}` placeholder left unresolved |
| R1.2 | MSO | `SAVEONEVent:WAVEform:SOUrce` | CH3 | `{CH<x>...}` or `<x>` token leaking into output |
| R1.3 | AFG | `SOURce1:FREQuency:FIXed` | `1000` | `{ch}` / `{freq}` not substituted |
| R1.4 | AWG | `OUTPut1:STATe` | `ON` | Options string `{0\|1\|OFF\|ON}` appearing in output |
| R1.5 | SMU | `:MEASure:VOLTage:DC?` | — | Query commands silently dropped |
| R1.6 | RSA | `INITIATE:CONTINUOUS` | `OFF` | Enumeration value `{state}` not resolved |

#### Group 6 — set_and_query Roundtrip

Does Set+Query produce both the write AND the subsequent query?

| ID | Command | Value | What it catches |
|----|---------|-------|-----------------|
| R6.1 | `CH1:SCAle` | `2.0` | Both `write('CH1:SCAle 2.0')` and `query('CH1:SCAle?')` present |
| R6.2 | `ACQuire:MODe` | — | `write` always appears before `query` in the file |
| R6.3 | `CH1:COUPling` | *(empty)* | Header-only command does not crash; both write + query emitted |
| R6.4 | `CH1:SCAle` + `CH2:SCAle` | `0.5`, `1.0` | Two steps produce two independent pairs; no bleed-over |

#### Group 7 — Import/Template Load Regression

If a user saves a flow as JSON and re-imports it, does re-exporting produce identical Python?

| ID | Scenario | What it catches |
|----|----------|-----------------|
| R7.1 | Export → save flow JSON → import (replace) → re-export | Import must not mutate step data; Python is byte-identical |
| R7.2 | Import flow JSON → export Python | All commands survive the round-trip |
| R7.3 | Import in **append** mode | Existing steps + imported steps both present in output |
| R7.4 | Load Hello Scope **template** → export | `*IDN?`, `*OPT?` present; Python is valid |

---

## CI jobs (GitHub Actions)

| Job | Trigger | npm script | Artifact |
|-----|---------|------------|----------|
| `unit-tests` | push / PR | `npm test` | — |
| `scpi-validation` | push / PR | `npm run test:scpi` | `scpi-validation-report` → `scpi-report.html` |
| `scpi-schema` | push / PR | `npm run test:scpi-schema` | — |
| `python-validate` | push / PR | `npm run test:python-validate` | — |
| `product-validation` | push / PR | `npm run test:product` + `test:param-pipeline` | — |
| `e2e` | after unit-tests | `npm run test:e2e` | `e2e-output/` |
| `regression` | after unit-tests | `npm run test:regression` | `regression-output/` (all `.py` files) |

Download artifacts: **GitHub → Actions → (select run) → Artifacts section** at the bottom.

---

## When to run what

| Situation | Run this |
|-----------|----------|
| Quick sanity before commit | `npm test` |
| Changed generator logic | `npm run test:regression` |
| Changed a SCPI command JSON file | `npm run test:scpi` |
| Changed param binding / substitution | `npm run test:param-pipeline` |
| Changed App.tsx generate function | `npm run test:generator` then `npm run test:regression` |
| Changed import/export flow | `npm run test:regression` (covers R7.1–R7.4) |
| Full pre-push check | `npm run test:ci` |
| Debug a specific E2E failure visually | `npm run test:e2e:ui` |

---

## Reports and output files

| Path | What's in it |
|------|-------------|
| `test-report/report.html` | Jest HTML report — all unit test pass/fail |
| `test-report/scpi-report.html` | SCPI validation by device family |
| `e2e-output/*.py` | Every Python file downloaded during E2E tests |
| `e2e-output/regression/*.py` | Python files from each regression scenario |
| `e2e-output/analysis-report.md` | SCPI corpus analysis (commands found / not found in output) |
| `test-results/` | Playwright trace + screenshots on failure |
