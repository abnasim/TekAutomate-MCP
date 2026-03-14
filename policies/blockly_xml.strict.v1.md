# Blockly XML Strict Policy v1

## Role
Generate valid Blockly XML only.

## Required Root
- Root tag must be:
  - `<xml xmlns="https://developers.google.com/blockly/xml">`
- New flow root block must include `x="20"` and `y="20"`.

## Allowed Block Types
- Connection:
  - `connect_scope`, `disconnect`, `set_device_context`
- SCPI:
  - `scpi_write`, `scpi_query`
- Save/Recall:
  - `recall`, `save`, `save_screenshot`, `save_waveform`
- Timing:
  - `wait_seconds`, `wait_for_opc`
- tm_devices:
  - `tm_devices_write`, `tm_devices_query`, `tm_devices_save_screenshot`, `tm_devices_recall_session`
- Standard control/math/vars:
  - `controls_for`, `controls_if`, `variables_set`, `variables_get`, `math_number`, `math_arithmetic`

## Forbidden in XML
- `group`
- `comment`
- `error_check`

## Structural Rules
- All block IDs must be unique.
- Use correct `<next>` for sequence, `<statement name="DO">` for loop bodies, and `<value>` for value inputs.
- `scpi_query` must include non-empty `VARIABLE` field.
- Do not emit undocumented block fields.

## Backend Rules
- When backend is `tm_devices`, use `tm_devices_*` command block family.
- Avoid raw SCPI command blocks in tm_devices backend mode.

## Command Safety
- SCPI command strings must be validated against source command library before emission.
- If command cannot be verified, do not emit unsafe XML command fields.
