# Set+Query Roundtrip Fix Backlog

Last updated: 2026-03-10

## Current status

- Canary result: **PASS** for Blockly roundtrip preservation.
- Evidence: `e2e-output/flow-fidelity/set_and_query_canary_report.md`
- Full coverage audit: `e2e-output/flow-fidelity/set_and_query_full_coverage.md`
- Full command list (machine-readable): `e2e-output/flow-fidelity/set_and_query_full_coverage.json`

## Impact summary

Commands at risk (set/query semantics can degrade to write-only after Steps -> Blockly -> Steps):

| Family | Total Commands | Set+Query Risk |
|---|---:|---:|
| MSO_DPO_5k_7k_70K | 1479 | 1229 |
| afg | 65 | 2 |
| awg | 211 | 0 |
| dpojet | 88 | 0 |
| mso_2_4_5_6_7 | 2753 | 2491 |
| rsa | 3722 | 1238 |
| smu | 63 | 0 |
| tekexpress | 49 | 15 |

Total at-risk commands in catalog scan: **4975**

## Root cause

- In `stepToBlock`, `set_and_query` is converted to `scpi_write`, dropping the query half.
- During `Export to Steps`, block conversion returns `write`, not `set_and_query`.

## Implemented fix

1. Preserve `set_and_query` metadata on imported `scpi_write` Blockly blocks.
2. Restore `set_and_query` type and params during Blockly -> Steps export.
3. Generate write+query from Blockly when preserved `set_and_query` metadata is present.
4. Keep canary test gating this behavior:
   - `e2e/set-and-query-canary.spec.ts`

## Remaining follow-up

1. Add per-family set+query spot checks so full-catalog regression is continuously covered.
