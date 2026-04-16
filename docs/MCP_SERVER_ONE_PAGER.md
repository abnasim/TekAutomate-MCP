# TekAutomate MCP Server: One-Page Overview

## What it is

The TekAutomate MCP Server is the intelligence layer between the TekAutomate UI and AI models. It turns plain-language requests into safe, applyable instrument automation actions.

In simple terms: users describe what they want, and the MCP server helps build the right flow quickly and reliably.

## Why it matters

- Faster workflow creation: reduces manual step-by-step setup.
- Higher confidence: commands are validated against a real SCPI source-of-truth library.
- Better reliability: server-side checks catch malformed or unsafe action payloads before apply.
- Flexible operation: supports deterministic local mode (`mcp_only`) and deeper AI-assisted mode (`mcp_ai`).

## Key capabilities

- Understands user intent for common oscilloscope and instrument tasks.
- Retrieves and verifies SCPI commands from indexed command libraries.
- Materializes concrete commands from canonical headers (for example `CH<x>` -> `CH1`).
- Supports tm_devices command generation for Python-object workflows.
- Validates output into TekAutomate-compatible `ACTIONS_JSON`.
- Exposes diagnostics and logs for support and troubleshooting.

## What is unique

- Grounded command generation: uses real command corpora, not prompt-only guessing.
- Strong post-check pipeline: validates and repairs output shape before returning.
- Hybrid fallback strategy: if model output is weak, deterministic planner paths can still recover actionable results.
- Designed for real lab workflows: integrates with instrument context, run logs, and flow state.

## Typical demo flow

1. User asks: "Set edge trigger on CH1 and add frequency measurement."
2. MCP resolves commands and creates action payload.
3. TekAutomate shows proposed actions.
4. User clicks Apply.
5. Flow updates instantly with valid step structure.

## Performance snapshot

- Local command lookup is sub-millisecond in hot paths.
- Reference benchmark run: 40/40 pass in `mcp-server/reports/level-benchmark-2026-03-18.md`.

## Security and governance posture

- Server-side API key support for hosted Responses proxy.
- Structured validation before applying any generated actions.
- Explicit model/key test and model listing endpoints for controlled setup.

## Who benefits

- Demo teams: faster story from request to working flow.
- Application engineers: fewer manual edits and syntax issues.
- Developers: clear API, logs, and deterministic fallback behavior.
