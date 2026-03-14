# Blockly XML Strict Policy v1

## Required Root
`<xml xmlns="https://developers.google.com/blockly/xml">`
New flow root block must include x="20" y="20".

## Allowed Block Types
Connection: connect_scope, disconnect, set_device_context
SCPI: scpi_write, scpi_query
Save/Recall: recall, save, save_screenshot, save_waveform
Timing: wait_seconds, wait_for_opc
tm_devices: tm_devices_write, tm_devices_query, tm_devices_save_screenshot, tm_devices_recall_session
Control: controls_for, controls_if, variables_set, variables_get, math_number, math_arithmetic

## Forbidden in XML
group, comment, error_check — these are Steps UI only, not valid Blockly blocks.

## Structural Rules
- All block IDs must be unique
- Use <next> for sequence, <statement name="DO"> for loop bodies, <value> for inputs
- scpi_query must include non-empty VARIABLE field
- connect_scope must include IP, BACKEND fields
- controls_for must preserve mutation and variable XML attributes

## Device Context Rules (CRITICAL for multi-instrument)
Command prefix determines device context:
  CH<x>: | ACQuire: | MEASU: | DATa: | HOR: | TRIG: → (scope)
  :SOURce: | :OUTPut: | :MEASure: → (smu) / (psu)
  :SOURce:FREQuency | :OUTPut:SYNC → (awg) / (afg)
VALIDATE EVERY BLOCK's DEVICE_CONTEXT against its SCPI prefix.

## Backend Rules
- tm_devices backend: use tm_devices_* block family only
- pyvisa backend: use scpi_write, scpi_query blocks
- NEVER use raw SCPI blocks with tm_devices backend
