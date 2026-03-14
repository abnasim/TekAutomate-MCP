# Backend Taxonomy Policy v1

## Backend Defaults
- Default backend is `pyvisa` unless user explicitly requests another backend.
- Preserve backend already present in flow context when available.

## TekHSI Containment
- TekHSI is explicit opt-in only.
- Do not switch to TekHSI for waveform/fastframe requests unless user says `tekhsi` or `grpc`.
- If backend is non-TekHSI, avoid TekHSI-only advice/steps.

## tm_devices Rules
- Prefer `tm_device_command` and `tm_devices_*` block families.
- Avoid raw `write/query/save_screenshot/save_waveform` in tm_devices mode by default.
- Socket backend is not valid for tm_devices workflows.

## Hybrid Semantics
- `hybrid` is multi-backend orchestration mode, not an independent command API.

## Probe/Executor Context
- Live probing uses existing `code_executor` endpoint (`POST /run`, `action: run_python`).
- Treat executor output as buffered stdout/stderr (non-streaming).
