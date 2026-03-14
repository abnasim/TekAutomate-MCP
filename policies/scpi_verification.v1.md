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
