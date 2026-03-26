# E2E Coverage Matrix

Last updated: 2026-03-10

## Goal

Validate behavior in:

1. Steps-only mode.
2. Blockly-only mode.
3. Steps <-> Blockly fidelity.

## Covered now

### Steps-only

- Default step palette actions are visible.
- Save Waveform:
  - Source channel input.
  - Output filename.
  - Output format selection (CSV path).
  - Capture range selection.
  - Generated code validation.
- Save Screenshot:
  - Filename.
  - Scope type selection (legacy path).
  - Generated code validation.
- Recall:
  - Recall type selection (waveform path).
  - File path.
  - Reference target selection.
  - Generated code validation.

### Blockly-only

- Toolbar action visibility:
  - Import from Steps
  - Export to Steps
  - Browse Commands
  - Clear
- Browse Commands modal:
  - Command selection
  - Add to workspace
  - Export to Steps
  - Generated code validation

### Roundtrip/Fidelity

- Steps -> Blockly -> Steps for write/query flow.
- set_and_query preservation canary.

## Known gaps to close

1. Exhaustive option permutations for each step type (all branches, not one representative path).
2. Full Blockly block option permutations (not only Browse Commands path).
3. Dedicated test for Save Waveform full advanced options preservation across Steps <-> Blockly.
4. Multi-device binding permutations for save_screenshot/save_waveform/recall.
5. Negative-path UX assertions (disabled states, validation messages, malformed inputs).

## Test files

- `e2e/default-controls.spec.ts`
- `e2e/flow-fidelity.spec.ts`
- `e2e/set-and-query-canary.spec.ts`
- `e2e/regression.spec.ts`
- `e2e/scpi-corpus.spec.ts`
