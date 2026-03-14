# SCPI Verification Policy v1

## Source of Truth
The command library JSON files are the ONLY source of truth for SCPI commands.
Do not infer commands from naming patterns, conventions, or memory.

## Verification Pipeline
1. Call search_scpi or get_command_by_header tool
2. If tool returns ok:true with non-empty data → commands ARE verified
3. Use EXACT syntax from tool results:
   - syntax.set for write steps
   - syntax.query for query steps
   - codeExamples[].scpi.code as the exact command string
4. For tm_devices backend: use codeExamples[].tm_devices.code
5. Include commandId + sourceFile as provenance

## HARD RULES
- When verified results exist, you MUST use exact command strings from those results
- You MUST NOT generate your own SCPI syntax when verified results are present
- Using commands not present in verified tool results is a POLICY VIOLATION
- Do not say "I could not verify" when verified tool results ARE present
- Use arguments[] to enforce valid parameter ranges and defaults
- Surface notes[] as brief warnings when relevant

## Failure Text
If search returns empty or ok:false:
→ "I could not verify this command in the uploaded sources."

## Key Disambiguations
- FastFrame frame count: HORizontal:FASTframe:COUNt <NR1> (NOT SIXteenbit)
- FastFrame enable: HORizontal:FASTframe:STATE ON
- FastFrame captures ALL active channels — no per-channel enable needed
- Channel scale on MSO4/5/6/7: DISplay:WAVEView1:CH<x>:VERTical:SCAle (NOT CH<x>:SCAle)

## Standard Measurements — Modern MSO5/6 (MANDATORY)
Use ADDMEAS pattern for basic measurements on MSO5/6:
- `MEASUrement:ADDMEAS FREQ`
- `MEASUrement:ADDMEAS AMP`
- `MEASUrement:MEAS1:SOURCE1 CH1`
- `MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?` (saveAs freq_result)
- `MEASUrement:MEAS2:RESUlts:CURRentacq:MEAN?` (saveAs amp_result)

Wrong for this context:
- `CH1:FREQuency` (not a valid basic command pattern)
- `DPOJET:ADDMEAS` (DPOJET app, not standard measurement flow)
- `MEASUrement:IMMed` (legacy pattern for 5k/7k/70k class scopes)

Disambiguation rule:
- If user asks standard frequency/amplitude measurements on MSO5/6, do NOT use DPOJET commands.
- Only use `DPOJET:*` when the user explicitly asks for DPOJET.
- For standard measurements, always use `MEASUrement:ADDMEAS` + `MEASUrement:MEASx:SOURCE1` + `...:RESUlts:CURRentacq:MEAN?`.

Search hint: call `search_scpi` with `MEASUrement:ADDMEAS`.

## MEASUrement:ADDMEAS Argument Rule (MANDATORY)
Use only documented enum values from command-library `arguments[].validValues`.
Do NOT invent friendly aliases.

Preferred standard measurement enums for this workflow:
- `FREQ`
- `AMP`

Wrong:
- `FREQUENCY` (unless explicitly listed for the selected model command entry)
- `AMPLITUDE` (unless explicitly listed for the selected model command entry)
- `FREQ_CH1`

Always verify the exact enum in the returned command result before emitting `MEASUrement:ADDMEAS ...`.

## Search Strategy (MANDATORY)
Use specific operation-focused queries, not generic feature names.
Examples:
- `FastFrame enable` (not just `FastFrame`)
- `FastFrame count frames number` (not just `FastFrame`)
- `measurement frequency add` (not just `measurement`)
- `trigger edge slope` (not just `trigger`)

When results are mixed, refine and call `search_scpi` again with a more specific query before generating steps.
