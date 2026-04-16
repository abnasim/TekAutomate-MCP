# GPT Device Context - Critical Fix

## The Persistent Problem

The TekAutomate Script Generator GPT **consistently generates XML with incorrect device contexts**, despite multiple instruction updates.

### Error Pattern (Repeatedly Observed):

```xml
<!-- ❌ WRONG - Scope commands with SMU context -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">CH1:SCAle 1.0</field>  <!-- Scope command! -->
</block>

<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">ACQuire:STATE ON</field>  <!-- Scope command! -->
</block>

<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">ACQuire:STOPAfter SEQuence</field>  <!-- Scope command! -->
</block>
```

### What Should Happen:

```xml
<!-- ✅ CORRECT - Context matches command type -->
<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(scope)</field>
  <field name="COMMAND">CH1:SCAle 1.0</field>
</block>

<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(scope)</field>
  <field name="COMMAND">ACQuire:STATE ON</field>
</block>

<block type="scpi_write">
  <field name="DEVICE_CONTEXT">(smu)</field>
  <field name="COMMAND">:SOURce:VOLTage:LEVel 5.0</field>
</block>
```

## Root Cause

The GPT appears to be:
1. **Mixing up device contexts** when multiple instruments are connected
2. **Not validating** DEVICE_CONTEXT against SCPI command prefix before generating XML
3. **Defaulting to the wrong context** (often using the most recently connected device for ALL commands)

## Current Instructions (v6 - 7,995 chars)

Added **visual wrong/correct example** showing the exact error pattern:

```
## Multi-Instrument Rules (CRITICAL)

⚠️ MOST COMMON ERROR: Using wrong DEVICE_CONTEXT! ⚠️

❌ WRONG EXAMPLE (device contexts backwards):
<block type="scpi_write"><field name="DEVICE_CONTEXT">(smu)</field><field name="COMMAND">CH1:SCAle 1.0</field></block>
<block type="scpi_write"><field name="DEVICE_CONTEXT">(smu)</field><field name="COMMAND">ACQuire:STATE ON</field></block>
<block type="scpi_write"><field name="DEVICE_CONTEXT">(scope)</field><field name="COMMAND">:SOURce:VOLTage:LEVel 5</field></block>

✅ CORRECT (contexts match command prefixes):
<block type="scpi_write"><field name="DEVICE_CONTEXT">(scope)</field><field name="COMMAND">CH1:SCAle 1.0</field></block>
<block type="scpi_write"><field name="DEVICE_CONTEXT">(scope)</field><field name="COMMAND">ACQuire:STATE ON</field></block>
<block type="scpi_write"><field name="DEVICE_CONTEXT">(smu)</field><field name="COMMAND">:SOURce:VOLTage:LEVel 5</field></block>

RULE: Command prefix determines context:
CH1:|ACQuire:|MEASU:|DATa: → (scope)
:SOURce:|:OUTPut:|:MEASure: → (smu)/(psu)

VALIDATE EVERY BLOCK before generating!
```

## Recommendations

### Short-term:
1. **Test GPT again** with the updated instructions showing visual wrong/correct examples
2. **If still fails**, consider adding a post-processing validator in TekAutomate that flags incorrect device contexts before import

### Long-term:
1. **Consider fine-tuning** a custom model specifically for TekAutomate XML/JSON generation
2. **Add validation layer** in the app that shows warnings when importing XML with likely device context errors:
   - `CH1:` or `ACQuire:` with non-`(scope)` context → warn
   - `:SOURce:` or `:OUTPut:` with non-`(smu)`/`(psu)` context → warn

### Nuclear Option:
If GPT continues to fail, create a **specialized prompt** that:
1. First generates a DEVICE_CONTEXT_MAP (command → device mapping)
2. Then validates each block against the map before generating XML
3. Self-corrects if validation fails

## Test Cases

Use these prompts to validate GPT behavior:

1. **Single Instrument (Baseline)**:
   - "Connect to scope at 192.168.1.10, set CH1 scale to 1V, acquire single sequence"
   - Expected: All commands use `(scope)`

2. **Multi-Instrument (Critical Test)**:
   - "Connect to scope at 192.168.1.10 and SMU at 192.168.1.20. Set CH1 scale to 1V, set SMU voltage to 5V, acquire single sequence"
   - Expected: CH1/ACQuire use `(scope)`, :SOURce use `(smu)`

3. **Loop with Multi-Instrument (Stress Test)**:
   - "Connect to scope and SMU. Loop 5 times: set SMU voltage from 1-3V in 0.5V steps, trigger scope, save waveform"
   - Expected: ALL scope commands use `(scope)`, ALL SMU commands use `(smu)`

## Status

- **Last Updated**: 2024-01-24
- **Character Count**: 7,995 / 8,000
- **Instructions Version**: 6
- **Known Issues**: GPT still generating incorrect device contexts despite explicit visual examples
