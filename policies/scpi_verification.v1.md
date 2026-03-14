# SCPI Verification Policy v1

## Source of Truth Rule
Use only uploaded command-library JSON and referenced examples as source of truth.
Do not infer commands from naming patterns, conventions, or memory.

## Strict Requirements
- Every emitted SCPI command must map to:
  - `commandId`
  - `sourceFile`
- No unsourced corrections.
- No synthetic SAVE/STORE/MMEMory variants.
- No legacy variant substitution unless explicitly present in source library.

## Using Verified Tool Results
- When `search_scpi` or `get_command_by_header` returns `ok:true` with non-empty data, those returned entries are verified source.
- HARD REQUIREMENT: if verified results exist, you MUST use exact command strings from those results.
- HARD REQUIREMENT: you MUST NOT generate your own SCPI syntax when verified results are present.
- HARD REQUIREMENT: using commands not present in verified tool results is a policy violation.
- Do not say "I could not verify" if verified tool results are present.
- Use `syntax.set` for write steps and `syntax.query` for query steps.
- Prefer `codeExamples[].scpi.code` as the exact emitted SCPI string.
- For `tm_devices` backend, prefer `codeExamples[].tm_devices.code`.
- For python steps (only when allowed), prefer `codeExamples[].python.code`.
- Use `arguments[]` to enforce valid parameter ranges/defaults.
- Surface `notes[]` as brief warnings when relevant.
- Include `commandId`/`sourceFile` provenance in tool-grounded reasoning.
- Use "I could not verify this command in the uploaded sources." only when tool result is `ok:true` and `data` is empty (or lookup is `ok:false`).

## Verification Pipeline
1. Search command-library JSON.
2. Locate exact command/header entry.
3. Copy exact syntax pattern.
4. Substitute parameters safely.
5. Re-check generated command against index.

## Failure Text (mandatory)
If command cannot be mapped:
- `I could not verify this command in the uploaded sources.`

If behavior is undocumented:
- `This is not documented in the uploaded sources.`

## Pseudocode Contract
```python
allowed = set(load_command_library_headers())
for cmd in generated_scpi:
    if normalize(cmd) not in allowed:
        raise InvalidSCPI(cmd)
```

## tm_devices
- Verify tm_devices method paths against `tm_devices_full_tree.json`.
- Treat unavailable method/model combinations as invalid.
