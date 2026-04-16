---
name: scope-check
description: Quick instrument check — identity, errors, and connection status
---

Run a quick instrument health check:

1. Call `get_instrument_info` to get executorUrl, visaResource, backend, and liveMode
2. If not connected, report that and stop
3. Call `send_scpi` with those exact params and commands: `["*IDN?", "*ESR?", "ALLEV?"]`
4. Report:
   - Instrument identity (manufacturer, model, serial, firmware)
   - ESR register value (0 = no errors)
   - Event queue contents
5. If ESR is non-zero, explain which bits are set

Do NOT send *LRN? — this is a quick check only.
