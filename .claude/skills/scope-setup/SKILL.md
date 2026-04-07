---
name: scope-setup
description: Find, verify, and send SCPI commands to the scope
---

Help the user configure their scope with SCPI commands:

1. Call `get_instrument_info` to get connection context
2. Use `search_scpi` or `browse_scpi_commands` to find relevant commands for the user's request
3. Use `get_command_by_header` to get exact syntax and valid values
4. Use `verify_scpi_commands` to validate before sending
5. Use `send_scpi` to execute — pass all instrument params from step 1

Important:
- MSO2 uses `TRIGger:A:TYPe WIDTH` not PULSEWIDTH
- Always verify commands before sending
- After sending, check `*ESR?` and `ALLEV?` if anything seems wrong
- Use `*OPC?` after slow operations (SAVE, AUTOSET, ACQuire)
