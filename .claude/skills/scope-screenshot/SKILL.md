---
name: scope-screenshot
description: Capture and analyze the scope display
---

Capture a screenshot from the connected scope and analyze it:

1. Call `get_instrument_info` to get executorUrl, visaResource, backend, liveMode
2. If not connected, report that and stop
3. Call `capture_screenshot` with `analyze: true` and the instrument context from step 1
4. Describe what you see on the scope display:
   - Waveform shape and characteristics
   - Channel settings (scale, offset)
   - Trigger status
   - Any measurements shown
   - Any anomalies or issues visible

Pass all instrument params (executorUrl, visaResource, backend, liveMode) from get_instrument_info.
