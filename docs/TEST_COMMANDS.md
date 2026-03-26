# Test Commands Reference

All commands to run, what they do, how long they take, and where to find results.

---

## Unit Tests (Jest — no browser needed)

| Command | What it runs | Time | Output |
|---------|-------------|------|--------|
| `npm test` | All Jest suites (generators, validators, snapshots) | ~seconds | `test-report/report.html` |
| `npm run test:scpi` | SCPI command JSON structure + generated code validation | ~seconds | `test-report/scpi-report.html` |
| `npm run test:scpi-schema` | AJV schema: every param has an identifier, no orphaned `{param}` placeholders | ~seconds | terminal |
| `npm run test:product` | Every command from every JSON → step → Python, ~13k commands | ~minutes | terminal (grouped by family) |
| `npm run test:param-pipeline` | Every `{param}` resolves correctly through the pipeline, ~8k commands | ~minutes | terminal |
| `npm run test:generator` | `appGenerator.ts` function-level unit tests (verbose) | ~seconds | terminal |
| `npm run test:python-validate` | Generated Python passes `py_compile` and runs with mock PyVISA | ~seconds | terminal *(skips if Python not on PATH)* |
| `npm run test:ci` | Full CI sequence: unit → scpi → e2e | ~minutes | all of the above |

---

## E2E / Playwright Tests (requires dev server running)

> Start the dev server first in a separate terminal: `npm start`

| Command | What it runs | Time | Output |
|---------|-------------|------|--------|
| `npm run test:e2e` | All Playwright specs (export, variations, scenarios, corpus, regression) | ~minutes | `e2e-output/` |
| `npm run test:e2e:ui` | Same as above but opens the **Playwright GUI** (interactive test explorer) | ~minutes | GUI + `e2e-output/` |
| `npm run test:regression` | Regression scenarios only — most targeted test for generator changes | ~60s | `e2e-output/regression/*.py` |

---

## SCPI Corpus Tests (data-driven, subset of E2E)

The corpus builder adds write+query steps from every command JSON file, exports Python, and checks every SCPI string appears in the output.

| Command | Families covered | Groups | Est. time |
|---------|-----------------|--------|-----------|
| `npx playwright test scpi-corpus --reporter=line` | mso_4_5_6, mso_5k_7k (DPO), afg, awg, smu, dpojet, tekexpress | ~102 | ~15–20 min |
| `npx playwright test scpi-corpus --ui` | Same — opens **Playwright GUI** so you can inspect each group | ~102 | ~15–20 min |
| `$env:FULL_CORPUS="true"; npx playwright test scpi-corpus --reporter=line` | All of the above **+ RSA** (506 extra groups) | ~608 | ~85–100 min |

### After running — rebuild the report

If the summary test ran before all group tests finished writing their partial files (can happen with timing), regenerate the report manually:

```bash
node scripts/rebuild-corpus-report.js
```

Output files:

| Path | What's in it |
|------|-------------|
| `e2e-output/scpi-corpus/analysis.json` | Raw results array — every command, every param variation, pass/fail |
| `e2e-output/scpi-corpus/analysis-report.md` | Human-readable summary: total pass rate, per-group table, failed command list |
| `e2e-output/scpi-corpus/<family>/<group>.py` | The actual generated Python file for each group |
| `e2e-output/scpi-corpus/_partials/*.json` | Per-group partial results (intermediate files, safe to ignore) |

---

## Running a specific spec file or test

```bash
# Run one spec file
npx playwright test e2e/regression.spec.ts --reporter=line

# Run one spec file with GUI
npx playwright test e2e/regression.spec.ts --ui

# Run tests matching a name pattern
npx playwright test --grep "mso_4_5_6" --reporter=line

# Run RSA corpus groups only
$env:FULL_CORPUS="true"; npx playwright test scpi-corpus --grep "rsa" --reporter=line

# Run with headed browser (visible, no GUI window)
npx playwright test scpi-corpus --headed --reporter=line
```

---

## Playwright UI (`--ui`) vs `--reporter=line`

| | `--reporter=line` | `--ui` |
|---|---|---|
| What it does | Runs tests in terminal, one line per test | Opens a separate interactive GUI window |
| Re-run tests | Re-run whole command | Click individual tests to re-run |
| See traces/screenshots | Only on failure, in `test-results/` | Live timeline + trace viewer for every test |
| Best for | CI / scripted runs | Debugging a failing test |

---

## When to run what

| Situation | Command |
|-----------|---------|
| Quick check before committing | `npm test` |
| Changed generator / App.tsx logic | `npm run test:regression` |
| Changed a command JSON file | `npm run test:scpi` |
| Changed param binding | `npm run test:param-pipeline` |
| Debug a failing E2E test visually | `npm run test:e2e:ui` |
| Verify SCPI corpus coverage | `npx playwright test scpi-corpus --reporter=line` |
| Full coverage including RSA | `$env:FULL_CORPUS="true"; npx playwright test scpi-corpus --reporter=line` |
| Full pre-push check | `npm run test:ci` |

---

## Output files reference

| Path | Created by | What's in it |
|------|-----------|-------------|
| `test-report/report.html` | `npm test` | Jest HTML report |
| `test-report/scpi-report.html` | `npm run test:scpi` | SCPI validation by device family |
| `e2e-output/*.py` | E2E tests | Downloaded Python scripts |
| `e2e-output/regression/*.py` | Regression tests | Python for each regression scenario |
| `e2e-output/scpi-corpus/analysis-report.md` | Corpus tests | Pass rate per group, failed command list |
| `e2e-output/scpi-corpus/analysis.json` | Corpus tests | Full raw results (every command + variation) |
| `test-results/` | Playwright (on failure) | Traces, screenshots, error context |
