# Live Level Benchmark Report

Date: 2026-03-18

Target:
- Fresh MCP instance on `http://localhost:8787`
- Health check: `GET /health -> {"ok":true,"status":"ready"}`

Command:

```powershell
cd mcp-server
npm run eval:levels
```

## Totals

- PASS: 40
- WARN: 0
- FAIL: 0

## Per-Case Results

| Case ID | Level | Status | toolCalls | iterations | applyable | actions | appliedSteps | totalMs |
|---|---|---|---:|---:|---|---:|---:|---:|
| `L1_BAS_01` | Level 1 - Basics | PASS | 0 | 0 | yes | 1 | 3 | 1 |
| `L1_BAS_02` | Level 1 - Basics | PASS | 0 | 0 | yes | 1 | 3 | 6 |
| `L1_BAS_03` | Level 1 - Basics | PASS | 0 | 0 | yes | 1 | 3 | 1 |
| `L1_BAS_04` | Level 1 - Basics | PASS | 0 | 0 | yes | 1 | 3 | 1 |
| `L1_BAS_05` | Level 1 - Basics | PASS | 0 | 0 | yes | 1 | 3 | 17 |
| `L2_MEA_01` | Level 2 - Measurements | PASS | 0 | 0 | yes | 1 | 4 | 92 |
| `L2_MEA_02` | Level 2 - Measurements | PASS | 0 | 0 | yes | 1 | 4 | 126 |
| `L2_MEA_03` | Level 2 - Measurements | PASS | 0 | 0 | yes | 1 | 5 | 226 |
| `L3_CHT_01` | Level 3 - Channel + Trigger | PASS | 0 | 0 | yes | 1 | 3 | 49 |
| `L3_CHT_02` | Level 3 - Channel + Trigger | PASS | 0 | 0 | yes | 1 | 4 | 67 |
| `L3_CHT_03` | Level 3 - Channel + Trigger | PASS | 0 | 0 | yes | 1 | 3 | 66 |
| `L3_CHT_04` | Level 3 - Channel + Trigger | PASS | 0 | 0 | yes | 1 | 4 | 37 |
| `L4_BUS_01` | Level 4 - Bus Decode | PASS | 0 | 0 | yes | 1 | 3 | 63 |
| `L4_BUS_02` | Level 4 - Bus Decode | PASS | 0 | 0 | yes | 1 | 3 | 62 |
| `L4_BUS_03` | Level 4 - Bus Decode | PASS | 0 | 0 | yes | 1 | 3 | 88 |
| `L4_BUS_04` | Level 4 - Bus Decode | PASS | 0 | 0 | yes | 1 | 3 | 112 |
| `L5_SAV_01` | Level 5 - Save / Recall | PASS | 0 | 0 | yes | 1 | 5 | 53 |
| `L5_SAV_02` | Level 5 - Save / Recall | PASS | 0 | 0 | yes | 1 | 4 | 26 |
| `L5_SAV_03` | Level 5 - Save / Recall | PASS | 0 | 0 | yes | 1 | 5 | 64 |
| `L6_TMD_01` | Level 6 - tm_devices | PASS | 0 | 0 | yes | 1 | 4 | 80 |
| `L6_TMD_02` | Level 6 - tm_devices | PASS | 0 | 0 | yes | 1 | 7 | 110 |
| `L7_CPX_01` | Level 7 - Complex Multi-step | PASS | 0 | 0 | yes | 1 | 10 | 245 |
| `L7_CPX_02` | Level 7 - Complex Multi-step | PASS | 0 | 0 | yes | 1 | 9 | 174 |
| `L7_CPX_03` | Level 7 - Complex Multi-step | PASS | 0 | 0 | yes | 1 | 8 | 63 |
| `L7_CPX_04` | Level 7 - Complex Multi-step | PASS | 0 | 0 | yes | 1 | 5 | 91 |
| `L8_ENG_01` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 6 | 254 |
| `L8_ENG_02` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 7 | 174 |
| `L8_ENG_03` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 3 | 94 |
| `L8_ENG_04` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 3 | 111 |
| `L8_ENG_05` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 3 | 55 |
| `L8_ENG_06` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 4 | 154 |
| `L8_ENG_07` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 4 | 145 |
| `L8_ENG_08` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 3 | 25 |
| `L8_ENG_09` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 4 | 38 |
| `L8_ENG_10` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 5 | 129 |
| `L8_ENG_11` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 4 | 232 |
| `L8_ENG_12` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 4 | 239 |
| `L8_ENG_13` | Level 8 - Engineering / Technical | PASS | 0 | 0 | yes | 1 | 7 | 1 |
| `AFG01` | Level 9 - AFG | PASS | 0 | 0 | yes | 1 | 6 | 77 |
| `SMU01` | Level 10 - SMU | PASS | 0 | 0 | yes | 1 | 7 | 87 |

## Notes

- All 40 cases passed with `toolCalls=0` and `iterations=0`.
- The suite reported no official WARN cases.
- Inline warning messages were printed for some passing cases about over-concatenated SCPI strings:
  - `L4_BUS_03`
  - `L8_ENG_03`
  - `L8_ENG_11`
  - `L8_ENG_12`
