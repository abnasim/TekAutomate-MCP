import { useMemo, useState, useEffect, useRef } from 'react';
import type { AiAction, AiActionParseResult } from '../../utils/aiActions';
import { canMaterializeAiAction, parseAiActionResponse } from '../../utils/aiActions';
import { streamMcpChat, disconnectLiveSession, resolveMcpHost, type McpChatAttachment } from '../../utils/ai/mcpClient';
import { runLiveToolLoop, fetchLiveTools, buildLiveSystemPrompt } from '../../utils/ai/liveToolLoop';
import type { ChatTurn, PredefinedAction, RagCorpus } from '../../utils/ai/types';
import type { StepPreview } from './StepsListPreview';
import { useAiChatContext } from './aiChatContext';
import type { TekMode } from './aiChatReducer';

const DEFAULT_MODELS = {
  openai: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5.3',
    'gpt-5.3-codex',
    'gpt-5.2',
    'gpt-5.2-codex',
    'gpt-4o',
    'gpt-4o-mini',
  ],
  anthropic: ['claude-sonnet-4-6', 'claude-sonnet-4-5-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
};

/**
 * Build full system prompt for Anthropic browser-direct path.
 * Matches the OpenAI hosted_responses_system_prompt.md in capability.
 */
function buildAnthropicBuilderSystemPrompt(modelFamily: string, backend: string, deviceType: string): string {
  return `[ROLE]
You are TekAutomate Flow Builder Assistant. Build, edit, and validate TekAutomate flows for Tektronix instruments.
Device: ${modelFamily} | Backend: ${backend} | Type: ${deviceType}

[PRIORITY]
P1 Runtime context from conversation (backend, deviceType, modelFamily, current flow, user intent)
P2 Pre-loaded SCPI context from verified 9,300+ command database
P3 General knowledge
If conflict, P1 wins.

[CORE COMMAND LANGUAGE]
- Canonical mnemonics: CH<x> (CH1), B<x> (B1), MATH<x> (MATH1), MEAS<x> (MEAS1), REF<x> (REF1), SEARCH<x> (SEARCH1), WAVEView<x> (WAVEView1).
- Never invent aliases like CHAN1, CHANNEL1, BUS1.
- SCPI grammar: colon-separated headers, space before arguments, commas between multiple arguments, no leading colon on star commands (*OPC?).

[OUTPUT MODES]
- Build/edit/configure/add intent → 1-2 short sentences then ACTIONS_JSON.
- Question/explain intent → concise conversational answer, no ACTIONS_JSON.
- Never dump raw SCPI lists without ACTIONS_JSON wrapper.
- Never output raw flow JSON without wrapping in ACTIONS_JSON replace_flow.
- Never output raw Python unless user explicitly asks for Python.

[ACTIONS_JSON FORMAT]
ALWAYS use this format for any flow output (new or edit):
ACTIONS_JSON: {"summary":"...","findings":["..."],"suggestedFixes":["..."],"actions":[...]}

For building a new flow from scratch, use replace_flow action:
ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[{"type":"replace_flow","flow":{"name":"...","description":"...","backend":"${backend}","deviceType":"${deviceType}","steps":[...]}}]}

For editing existing flows, use insert/replace/remove actions:
ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[{"type":"insert_step_after","targetStepId":null,"newStep":{...}}]}

[CANONICAL ACTION SHAPES]
insert_step_after: {"type":"insert_step_after","targetStepId":null,"newStep":{valid step}}
replace_step: {"type":"replace_step","targetStepId":"2","newStep":{valid step}}
remove_step: {"type":"remove_step","targetStepId":"2"}
set_step_param: {"type":"set_step_param","targetStepId":"2","param":"filename","value":"capture.png"}
replace_flow: {"type":"replace_flow","flow":{"name":"...","steps":[...]}}
move_step: {"type":"move_step","targetStepId":"2","targetGroupId":"g1","position":0}
add_error_check_after_step: {"type":"add_error_check_after_step","targetStepId":"2"}

[VALID STEP TYPES]
connect, disconnect, write, query, set_and_query, sleep, error_check, comment, python, save_waveform, save_screenshot, recall, group, tm_device_command

[EXACT STEP SCHEMAS]
connect: {"type":"connect","label":"Connect","params":{"instrumentIds":[],"printIdn":true}}
disconnect: {"type":"disconnect","label":"Disconnect","params":{"instrumentIds":[]}}
write: {"type":"write","label":"Set CH1 Scale","params":{"command":"CH1:SCAle 1.0"}}
query: {"type":"query","label":"Read Scale","params":{"command":"CH1:SCAle?","saveAs":"result_scale"}}
set_and_query: {"type":"set_and_query","label":"Set and Query","params":{"command":"...","cmdParams":[],"paramValues":{}}}
sleep: {"type":"sleep","label":"Wait","params":{"duration":0.5}}
error_check: {"type":"error_check","label":"Error Check","params":{"command":"*ESR?"}}
comment: {"type":"comment","label":"Note","params":{"text":"..."}}
python: {"type":"python","label":"Python","params":{"code":"..."}}
save_waveform: {"type":"save_waveform","label":"Save Waveform","params":{"source":"CH1","filename":"ch1.bin","format":"bin"}}
save_screenshot: {"type":"save_screenshot","label":"Screenshot","params":{"filename":"capture.png","scopeType":"modern","method":"pc_transfer"}}
recall: {"type":"recall","label":"Recall","params":{"recallType":"SESSION","filePath":"C:/tests/baseline.tss","reference":"REF1"}}
group: {"type":"group","label":"Setup","params":{},"collapsed":false,"children":[]}
tm_device_command: {"type":"tm_device_command","label":"tm_devices","params":{"code":"scope.commands.acquire.state.write(\\"RUN\\")","description":"..."}}

[STEP RULES]
- connect first, disconnect last.
- query must include params.saveAs with unique descriptive name.
- group must include params:{} and children:[].
- Use label for display text. Never use name or title.
- Use exact verified SCPI syntax. Do not guess or shorten mnemonics.
- Combine related same-subsystem setup commands into one write step with semicolons (max 3 per step).
- Keep query steps query-only — no setup writes mixed in.
- Prefer save_screenshot over raw screenshot SCPI.
- Prefer save_waveform over raw waveform transfer SCPI.
- Do not add *OPC? by default — only when flow has OPC-capable operation and user asks for sync.

[BACKEND ROUTING]
- pyvisa/vxi11: prefer write, query, save_screenshot, save_waveform, connect, disconnect.
- tm_devices: prefer tm_device_command; convert verified SCPI to scope.commands... path when clear.

[SCPI SAFE DEFAULTS]
- IEEE488.2: *IDN?, *RST, *OPC?, *CLS, *ESR?, *WAI
- Measurements: MEASUrement:ADDMEAS ...
- FastFrame: HORizontal:FASTframe:STATE, HORizontal:FASTframe:COUNt
- No DPOJET for basic measurements unless explicitly requested.
- No HARDCopy for modern MSO4/5/6 screenshot capture.

[MEASUREMENT GROUPING]
For measurement flows, prefer two groups:
- "Add Measurements" group: MEASUrement:ADDMEAS, MEASUrement:MEAS<x>:SOUrce...
- "Read Results" group: result queries with saveAs

[NEVER DO THESE]
- Never invent pseudo-step types (set_channel, acquire_waveform, log_to_csv, etc.)
- Never output malformed/truncated JSON.
- Never use params.query — use params.command.
- Never use file_path — use filename.
- Never use seconds — use duration.
- Never mix setup writes into query steps.

[BUILD BEHAVIOR]
- Build immediately when request is clear.
- Build your best flow first, caveat gaps in findings.
- Partial useful output beats empty output.
- If one value is missing, ask one clarifying question max.
- If part is clear, return verified portion and note gaps in findings.
- Never return actions:[] if a useful portion can still be applied.

[SAVE LEARNED WORKFLOWS]
After building a flow with 3+ steps, call save_learned_workflow to persist it:
- name: Short name (e.g. "I2C Bus Debug Setup")
- description: What it achieves
- triggers: 3-5 phrases (e.g. ["setup i2c", "i2c decode", "configure i2c bus"])
- steps: The tool call sequence [{tool:"send_scpi",args:{commands:["..."]},description:"..."}]
This lets users recall the flow instantly next time. Do not skip this.

[VERIFY YOUR WORK]
Do not assume SET commands succeed — the scope may reject values silently.
- Only query back commands that support both set and query (commandType: "both"). Set-only commands have no query form.
- For set-only commands (e.g. MEASUrement:ADDMEAS), use a related query (MEASUrement:LIST?) or screenshot to confirm.
- After visual changes (measurements, bus decode, display), capture a screenshot to confirm the scope updated.
- If query returns unexpected values or screenshot doesn't match, report and retry.

[SELF-CHECK]
1) Correct output mode for intent?
2) All step types valid?
3) All param keys exact?
4) All query steps have saveAs?
5) All group steps have params:{} and children:[]?
6) connect first, disconnect last for full flows?
7) newStep and flow are real JSON objects, not strings?`;
}

function canonicalizeModelId(model: string): string {
  const raw = String(model || '').trim();
  if (!raw) return raw;
  return raw.replace(/-\d{4}-\d{2}-\d{2}$/i, '');
}

const API_KEY_STORAGE = 'tekautomate.ai.byok.api_key';
const API_KEY_STORAGE_BY_PROVIDER = {
  openai: 'tekautomate.ai.byok.api_key.openai',
  anthropic: 'tekautomate.ai.byok.api_key.anthropic',
} as const;
const SERVER_DEFAULT_ASSISTANT_TOKEN = '__SERVER_DEFAULT_ASSISTANT__';
const SURPRISE_PROMPTS = [
  'Build a practical oscilloscope validation flow for the current model using only valid TekAutomate step types, and explain why you chose that sequence.',
  'Suggest one useful TekAutomate workflow for this scope that a test engineer would actually reuse, then build it using only valid TekAutomate step types.',
  'Give me a smart measurement workflow for the current scope context and include the flow steps using only valid TekAutomate step types.',
  'Create a compact but useful capture-and-measure flow for this instrument, using only valid TekAutomate step types, and explain the purpose briefly.',
  'Build a quick communication sanity-check flow with IDN, ESR, OPC, and error queue checks using only valid TekAutomate step types.',
  'Create a fast startup validation flow for this scope: connect, clear status, minimal trigger setup, and one result query.',
  'Generate a deterministic CH1 signal-health workflow with scale/coupling setup, edge trigger, and frequency plus pk2pk readouts.',
  'Build an operator-friendly debug flow that configures channels, captures one shot, reads key measurements, and saves screenshot.',
  'Create a reusable bus-debug starter flow for the current model with safe defaults and explicit query result variables.',
  'Build a low-risk smoke test flow for the instrument backend in this workspace and include only schema-valid step types.',
  'Create a compact waveform-capture flow: setup, single acquisition, save CH1/CH2 waveforms, and save screenshot.',
  'Generate a setup-and-hold measurement workflow template with clearly labeled groups and query steps.',
  'Create a trigger-tuning helper flow that sets edge trigger source/slope/level and reads back status.',
  'Build a flow that checks instrument communication health first, then runs one focused measurement task.',
  'Create a cleanly grouped flow with Setup, Acquisition, Measurements, and Save Results sections.',
  'Build a scope readiness checklist flow that an engineer can run before collecting production data.',
  'Generate a minimal but robust pyvisa flow that validates comms and captures one verified datapoint.',
  'Create a flow optimized for readability in Steps UI: short grouped writes, explicit queries, and clear labels.',
  'Build a deterministic single-sequence capture flow with post-capture error check and status queries.',
  'Create a no-surprises baseline flow for this scope model that is safe to run repeatedly.',
  'Generate a practical quick-diagnosis flow for intermittent issues: status checks, capture, measurements, and screenshot.',
  'Build a compact SCPI verification flow using common IEEE/status commands plus one acquisition step.',
  'Create a starter flow for lab bring-up that validates connection, configures CH1, and logs two core measurements.',
  'Generate a one-click troubleshooting flow with clear grouped steps and applyable actions only.',
  "What's the most useful TekAutomate workflow a test engineer never thinks to build until they need it at 2am?",
  'I have a mystery signal on CH1. Build me a flow that queries everything about it: frequency, amplitude, rise time, duty cycle, and saves a screenshot so I can figure out what it is.',
  'Run a complete scope health check: query IDN, check error queue, verify acquisition state, read sample rate, check trigger status, and save a diagnostic screenshot.',
  'I have an unknown serial signal on CH1 that toggles between 0V and 3.3V. Set up UART, I2C, and SPI decode all on B1 B2 B3 simultaneously so I can figure out which protocol it is.',
  'Quick power rail sanity check: set CH1 to 50mV DC 50ohm, CH2 to 500mV DC 1Mohm, add RMS and pk2pk on both channels, query results, save screenshot.',
  'Build a 30-second production pass/fail test: connect, reset, set CH1 1V DC 50ohm edge trigger rising 0.5V, single sequence, add frequency amplitude and overshoot, query all results, error check, save waveform and screenshot, disconnect.',
  'Capture 200 frames of whatever is on CH1 using FastFrame, then save the waveform so I can analyze frame-to-frame variation offline.',
  'Verify a crystal oscillator on CH1: add frequency, period, and jitter measurements, run average acquisition 64 waveforms, query all three results.',
  'Set up CAN FD decode on B1 source CH2 500kbps ISO standard, enable decode, trigger on any error frame, single sequence, save screenshot.',
  'Set up the AFG to output a 10kHz square wave 3.3Vpp 50% duty cycle on channel 1, output on.',
  'Source 1V on the SMU with 10mA current limit, output on, then measure voltage and current.',
  'Hunt for runt pulses on CH2: set runt trigger positive polarity with high threshold 2V low threshold 0.8V, normal mode, FastAcq temperature palette, run continuous.',
  'Set CH1 and CH2 both to 500mV DC 50ohm, add a math channel MATH1 as CH1 minus CH2, add frequency and amplitude measurements on MATH1.',
  'Set acquisition to peak detect mode, run continuous for 10 acquisitions, then save CH1 waveform as binary so I can find the worst-case spike.',
  'Recall the session from C:/baseline/golden.tss, then add frequency amplitude and pk2pk measurements on CH1, query all results, compare by saving screenshot.',
  'Full clock characterization on CH1: add frequency, period, rise time, fall time, positive duty cycle, jitter, and pk2pk. Average 128 waveforms. Query all 7 results each saved to a named variable.',
  'Set up I2C decode on B1 clock CH1 threshold 1.65V data CH2 threshold 1.65V, trigger on any address, single sequence, save screenshot of the decoded transaction.',
  'Capture a 4-channel timing diagram: CH1 through CH4 all at 1V DC 1Mohm, edge trigger CH1 rising 0.5V, single sequence, save all 4 channels as binary files and take a screenshot.',
  'Before I power down: save current setup to C:/sessions/last_session.set, save CH1 waveform to C:/data/last_capture.bin, take a screenshot, then disconnect cleanly.',
  'Suggest the most interesting TekAutomate workflow you can think of for an MSO6B that a test engineer would actually want to run, then build it.',
  'Set CH1 500mV DC 50ohm, CH2 1V AC, set average acquisition 64 waveforms, add frequency rise time and pk2pk on CH1, query all three results each saved to named variables, save screenshot.',
  'Set up LIN decode on B1 source CH1 19200 baud LIN 2.x standard, trigger on any LIN frame, single sequence, save screenshot and save CH1 waveform as binary.',
  'Recall session from C:/tests/golden.tss, add amplitude and mean measurements on CH1 and CH2, query all 4 results, run error check, save setup to C:/tests/run1.set.',
  'Set CH1 200mV DC 50ohm, enable FastFrame 50 frames single sequence, wait for OPC, save CH1 waveform as binary and take screenshot.',
  'Using tm_devices on MSO6B: set CH1 scale 500mV DC 50ohm, add frequency and amplitude measurements, run single sequence, query both results, save screenshot.',
  'I2C signal integrity test: CH1 SCL 3.3V DC 1Mohm, CH2 SDA 3.3V DC 1Mohm. Set up I2C decode B1 clock CH1 threshold 1.65V data CH2 threshold 1.65V. Trigger on address 0x48 write. Single sequence. Add setup time measurement between CH1 falling and CH2 falling, hold time between CH2 falling and CH1 rising. Query both results. Save both channels binary. Screenshot.',
  'Power sequencing test: CH1 200mV DC 50ohm VDD_CORE, CH2 500mV DC 50ohm VDD_IO, CH3 1V DC 50ohm VDD_PHY. Trigger CH3 rising 0.5V normal mode. Single sequence 5M samples. Add delay from CH3 rising to CH1 crossing 100mV and CH2 crossing 250mV. Add pk2pk and mean on all 3 channels. Query all 7 results each to named variables. Save all 3 channels as binary. Screenshot.',
  'Set up CAN FD decode B1 source CH2 500kbps 2Mbps data phase ISO. Configure B trigger sequence: A trigger edge CH2 falling 1.65V, B trigger time delay 200ns. FastFrame 100 frames single sequence. Save CH2 waveform as binary. Screenshot.',
  'Full production validation: connect print IDN, reset factory, set CH1 1V DC 50ohm CH2 500mV AC, edge trigger CH1 rising 1V normal mode, average acquisition 128 waveforms, add frequency amplitude pk2pk overshoot undershoot mean RMS on CH1 - 7 measurements, query all 7 results each to named variable, error check, save setup to C:/prod/run1.set, save CH1 waveform binary, screenshot, disconnect.',
  'Signal characterization suite: set CH1 100mV DC 50ohm bandwidth full, CH2 100mV DC 50ohm bandwidth full. Add frequency period rise time fall time pk2pk mean RMS positive overshoot negative overshoot on CH1 - 9 measurements. Average 256 waveforms. Query all 9 results. Save CH1 as binary. Save setup. Screenshot. Disconnect.',
];

function extractFirstJsonObjectAfterMarker(text: string, markerRegex: RegExp): string | null {
  const markerMatch = markerRegex.exec(text);
  if (!markerMatch || markerMatch.index < 0) return null;
  const startSearchAt = markerMatch.index + markerMatch[0].length;
  const source = text.slice(startSearchAt);
  const firstBrace = source.indexOf('{');
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = firstBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(firstBrace, i + 1);
      }
    }
  }
  return null;
}

function tryParseResult(text: string): AiActionParseResult | null {
  const direct = parseAiActionResponse(text);
  if (direct) return direct;
  const tagged = extractFirstJsonObjectAfterMarker(text, /ACTIONS_JSON\s*:\s*/i);
  if (tagged) {
    const parsedTagged = parseAiActionResponse(tagged.trim());
    if (parsedTagged) return parsedTagged;
  }
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsedFenced = parseAiActionResponse(fenced[1].trim());
    if (parsedFenced) return parsedFenced;
  }
  const fencedBlocks = Array.from(text.matchAll(/```json\s*([\s\S]*?)```/gi))
    .map((match) => parseAiActionResponse(match[1].trim()))
    .filter((parsed): parsed is AiActionParseResult => Boolean(parsed));
  if (fencedBlocks.length > 1) {
    const uniqueText = (items: string[]) => Array.from(new Set(items.filter(Boolean)));
    return {
      summary: uniqueText(fencedBlocks.map((r) => r.summary)).join(' ').trim() || 'Parsed assistant JSON blocks.',
      findings: uniqueText(fencedBlocks.flatMap((r) => r.findings || [])),
      suggestedFixes: uniqueText(fencedBlocks.flatMap((r) => r.suggestedFixes || [])),
      confidence: fencedBlocks.some((r) => r.confidence === 'high')
        ? 'high'
        : fencedBlocks.some((r) => r.confidence === 'medium')
          ? 'medium'
          : 'low',
      actions: fencedBlocks.flatMap((r) => r.actions || []),
    };
  }
  const candidate = text.match(/\{[\s\S]*\}/);
  if (candidate) {
    return parseAiActionResponse(candidate[0]);
  }
  return null;
}

function sanitizeParsedResult(parsed: AiActionParseResult): AiActionParseResult {
  const filteredActions = (parsed.actions || []).filter((action) => canMaterializeAiAction(action));
  if (filteredActions.length === (parsed.actions || []).length) return parsed;
  return {
    ...parsed,
    actions: filteredActions,
    findings: Array.from(new Set([
      ...(parsed.findings || []),
      'Assistant returned descriptive flow JSON that does not map to valid TekAutomate step types, so Apply was hidden.',
    ])),
  };
}

function getReplaceFlowStepCount(action: AiAction): number | null {
  const payload = (action.payload || {}) as { steps?: unknown[]; flow?: { steps?: unknown[] } };
  const steps = Array.isArray(payload.steps)
    ? payload.steps
    : payload.flow && typeof payload.flow === 'object' && Array.isArray(payload.flow.steps)
      ? payload.flow.steps
      : null;
  if (!steps?.length) return null;
  const hasConnect = steps.some((step) => String((step as { type?: unknown })?.type || '').toLowerCase() === 'connect');
  const hasDisconnect = steps.some((step) => String((step as { type?: unknown })?.type || '').toLowerCase() === 'disconnect');
  return steps.length + (hasConnect ? 0 : 1) + (hasDisconnect ? 0 : 1);
}

function extractReplaceFlowStepsFromAction(action: AiAction | undefined): StepPreview[] {
  if (!action || action.action_type !== 'replace_flow') return [];
  const payload = (action.payload || {}) as { steps?: unknown[]; flow?: { steps?: unknown[] } };
  const steps = Array.isArray(payload.steps)
    ? payload.steps
    : payload.flow && typeof payload.flow === 'object' && Array.isArray(payload.flow.steps)
      ? payload.flow.steps
      : [];
  return Array.isArray(steps) ? (steps as StepPreview[]) : [];
}

function extractLatestPendingFlowSteps(history: Array<{ role: string; actions?: AiAction[] }>): StepPreview[] {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn.role !== 'assistant' || !Array.isArray(turn.actions)) continue;
    const replace = turn.actions.find((action) => action.action_type === 'replace_flow');
    const steps = extractReplaceFlowStepsFromAction(replace);
    if (steps.length) return steps;
  }
  return [];
}

function extractActiveBuildHandoffHistory(history: ChatTurn[]): ChatTurn[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  let startIndex = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    const isBoundary =
      turn.tekMode === 'mcp' ||
      Boolean(turn.appliedAt) ||
      (Array.isArray(turn.actions) && turn.actions.length > 0);
    if (isBoundary) {
      startIndex = i + 1;
      break;
    }
  }

  const sliced = history
    .slice(startIndex)
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant');

  if (sliced.length > 0) {
    return sliced.slice(-8);
  }

  return history
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-8);
}

function isConversationalFlowFollowUp(message: string): boolean {
  const msg = String(message || '').toLowerCase();
  return /\b(?:same thing|same as before|do all of that|actually do all of that|actually make that|instead|change my flow accordingly|update my flow accordingly|apply that change|apply those changes|make that change|do that change)\b/.test(msg);
}

function isChatBuildHandoffRequest(message: string): boolean {
  const msg = String(message || '').trim().toLowerCase();
  return /^(build it|build that|make the flow|create the flow|turn that into (?:a )?flow|okay build it)\b/.test(msg);
}

function isShortAffirmation(message: string): boolean {
  const msg = String(message || '').trim().toLowerCase();
  return /^(?:yes|yeah|yep|yup|ok|okay|sure|please do|do it|go ahead|sounds good|works for me|apply it|apply that|make that change|change it accordingly|update it accordingly)\b/.test(
    msg
  );
}

function assistantLikelyProposedFlowChange(turn: ChatTurn | undefined): boolean {
  if (!turn || turn.role !== 'assistant') return false;
  if (Array.isArray(turn.actions) && turn.actions.length > 0) return true;
  const text = String(turn.content || '').toLowerCase();
  if (!text) return false;
  return (
    /\bsay ["']?build it["']?\b/.test(text) ||
    /\bi can build that\b/.test(text) ||
    /\bi can rewrite your flow\b/.test(text) ||
    /\bi can turn that into\b/.test(text) ||
    /\bupdated flow\b/.test(text) ||
    /\brebuilt step list\b/.test(text) ||
    /\bflow outline\b/.test(text) ||
    /\bexact rebuilt step list\b/.test(text) ||
    (/\bif you want, i can\b/.test(text) && /\b(flow|rewrite|format|steps?)\b/.test(text))
  );
}

function getLastAssistantTurn(history: ChatTurn[]): ChatTurn | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn.role === 'assistant') return turn;
  }
  return undefined;
}

function shouldAutoPromoteChatFollowUpToBuild(opts: {
  message: string;
  history: ChatTurn[];
  hasCurrentSteps: boolean;
  hasPendingFlowSteps: boolean;
}): boolean {
  const msg = String(opts.message || '').trim().toLowerCase();
  if (!msg) return false;
  const hasFlowContext = opts.hasCurrentSteps || opts.hasPendingFlowSteps;
  const lastAssistant = getLastAssistantTurn(opts.history);
  const assistantProposedChange = assistantLikelyProposedFlowChange(lastAssistant);
  const explicitFlowEditAsk =
    /\b(change|update|fix|apply|adjust|rewrite|redo|remove|replace|keep)\b/.test(msg) &&
    /\b(flow|steps?|that|it|accordingly|those)\b/.test(msg);

  if (assistantProposedChange && isShortAffirmation(msg)) return true;
  if (hasFlowContext && isConversationalFlowFollowUp(msg)) return true;
  if (hasFlowContext && explicitFlowEditAsk) return true;
  return false;
}

function shouldForceFreshBuild(message: string, tekMode: TekMode): boolean {
  const msg = String(message || '').trim().toLowerCase();
  if ((tekMode === 'ai' || tekMode === 'live') && isChatBuildHandoffRequest(msg)) return true;
  return /^(build it|build that|rebuild it|rebuild that|replace the flow|redo the flow|make a fresh flow|start over and build it)\b/.test(msg);
}

function shouldReuseOpenAiThread(params: {
  threadId: string;
  shouldRouteViaAssistant: boolean;
  standalone: boolean;
  forceFreshBuild: boolean;
  history: ChatTurn[];
}): boolean {
  if (!params.shouldRouteViaAssistant || params.standalone || params.forceFreshBuild) return false;
  if (!String(params.threadId || '').trim()) return false;
  const lastAssistantTurn = [...params.history]
    .reverse()
    .find((turn) => turn.role === 'assistant');
  if (!lastAssistantTurn) return false;
  if (lastAssistantTurn.streaming) return false;
  if (lastAssistantTurn.routedVia !== 'assistant') return false;
  if (lastAssistantTurn.isStandaloneQuickAction) return false;
  return true;
}

interface StructuredBuildBrief {
  intent: string;
  diagnosticDomain: string[];
  channels: string[];
  protocols: string[];
  signalType?: string;
  dataRate?: string;
  closureType?: string;
  probing?: string;
  measurementGoals: string[];
  artifactGoals: string[];
  operatingModeHints: string[];
  unresolvedQuestions: string[];
  suggestedChecks: string[];
  secondaryEvidence: string[];
}

function pushUnique(target: string[], value: string | null | undefined): void {
  const normalized = String(value || '').trim();
  if (!normalized) return;
  if (!target.includes(normalized)) target.push(normalized);
}

function mentionsProtocol(text: string, protocol: 'I2C' | 'SPI' | 'UART' | 'CAN' | 'LIN'): boolean {
  switch (protocol) {
    case 'I2C':
      return /\bi2c\b/i.test(text);
    case 'SPI':
      return /\bspi\b/i.test(text);
    case 'UART':
      return /\buart\b|\brs232\b|\brs-232\b/i.test(text);
    case 'CAN':
      return /\bCAN\s*FD\b/.test(text) ||
        /\bCAN\b(?=[^.!?\n\r]*(?:bus|decode|frame|trigger|search|baud|kbps|mbps|protocol|fd))/i.test(text) ||
        /\b(?:bus|decode|frame|trigger|search|protocol)\b[^.!?\n\r]*\bCAN\b/i.test(text);
    case 'LIN':
      return /\bLIN\b(?=[^.!?\n\r]*(?:bus|decode|frame|trigger|search|baud|protocol))/i.test(text) ||
        /\b(?:bus|decode|frame|trigger|search|protocol)\b[^.!?\n\r]*\bLIN\b/i.test(text);
    default:
      return false;
  }
}

function extractStructuredBuildBrief(history: Array<{ role: string; content?: string }>): StructuredBuildBrief {
  const joined = history
    .map((turn) => String(turn.content || ''))
    .join('\n');
  const brief: StructuredBuildBrief = {
    intent: 'general_debug',
    diagnosticDomain: [],
    channels: [],
    protocols: [],
    measurementGoals: [],
    artifactGoals: [],
    operatingModeHints: [],
    unresolvedQuestions: [],
    suggestedChecks: [],
    secondaryEvidence: [],
  };

  for (const match of Array.from(joined.toUpperCase().matchAll(/\bCH([1-8])\b/g))) {
    pushUnique(brief.channels, `CH${match[1]}`);
  }

  if (/\beye diagram|closed eye|eye closure\b/i.test(joined)) {
    brief.intent = 'eye_diagram_debug';
    pushUnique(brief.diagnosticDomain, 'scope_signal_integrity');
    pushUnique(brief.measurementGoals, 'eye closure diagnosis');
    pushUnique(brief.measurementGoals, 'jitter and amplitude/noise investigation');
    pushUnique(brief.artifactGoals, 'save screenshot evidence');
    [
      'acquisition sanity',
      'channel health',
      'differential integrity',
      'breakout-related checks',
      'eye metrics',
      'debug triggers',
    ].forEach((item) => pushUnique(brief.suggestedChecks, item));
  }
  if (/\bjitter\b/i.test(joined)) {
    pushUnique(brief.measurementGoals, 'jitter characterization');
    pushUnique(brief.diagnosticDomain, 'timing_analysis');
    ['acquisition sanity', 'jitter summary', 'spec comparison'].forEach((item) =>
      pushUnique(brief.suggestedChecks, item)
    );
  }
  if (/\bsetup time|hold time|setup\/hold\b/i.test(joined)) {
    brief.intent = 'timing_relationship_debug';
    pushUnique(brief.measurementGoals, 'setup/hold timing');
  }
  if (/\bdelay\b/i.test(joined)) {
    pushUnique(brief.measurementGoals, 'delay measurement');
  }
  if (/\bglitch|intermittent|runt\b/i.test(joined)) {
    brief.intent = 'intermittent_event_debug';
    pushUnique(brief.diagnosticDomain, 'capture_debug');
    pushUnique(brief.operatingModeHints, 'single sequence or event-hunt capture');
    ['trigger strategy', 'event capture', 'evidence capture'].forEach((item) =>
      pushUnique(brief.suggestedChecks, item)
    );
  }
  const isDifferentialMathRipple =
    /\bpower rail|ripple|supply|vdd|droop\b/i.test(joined) &&
    (/\bMATH1\b/i.test(joined) || /\bCH1\s*(?:-|minus)\s*CH2\b/i.test(joined));

  if (/\bpower rail|ripple|supply|vdd|droop\b/i.test(joined)) {
    brief.intent = 'power_integrity_debug';
    pushUnique(brief.diagnosticDomain, 'power_integrity');
    if (!isDifferentialMathRipple) {
      pushUnique(brief.measurementGoals, 'mean/rms/pk2pk style rail checks');
      ['rail health', 'mean/rms/pk2pk checks', 'artifact capture'].forEach((item) =>
        pushUnique(brief.suggestedChecks, item)
      );
    }
  }
  if (/\bpower harmonic|harmonics?\b/i.test(joined) && /\bpower|mains|line|thd\b/i.test(joined)) {
    brief.intent = brief.intent === 'general_debug' ? 'power_integrity_debug' : brief.intent;
    pushUnique(brief.diagnosticDomain, 'power_integrity');
    pushUnique(brief.measurementGoals, 'power harmonics analysis');
    pushUnique(brief.suggestedChecks, 'harmonic measurement configuration');
    pushUnique(brief.suggestedChecks, 'artifact capture');
  }
  if (
    /\b(?:500\s*mV|0\.5\s*V)\b/i.test(joined) &&
    /\bDC\b/i.test(joined) &&
    /\b50\s*ohm\b|\b50ohm\b/i.test(joined) &&
    /\bCH1\b/i.test(joined) &&
    /\bCH2\b/i.test(joined)
  ) {
    pushUnique(brief.suggestedChecks, 'set CH1 and CH2 to 0.5 V/div, DC coupling, 50 ohm termination');
    pushUnique(brief.secondaryEvidence, 'User confirmed 500 mV/div, DC coupling, 50 ohm termination on CH1 and CH2.');
  }
  if (
    /\bMATH1\b/i.test(joined) ||
    /\bmath channel\b/i.test(joined) ||
    /\bCH1\s*(?:-|minus)\s*CH2\b/i.test(joined)
  ) {
    pushUnique(brief.suggestedChecks, 'create MATH1 = CH1 - CH2 and enable display');
    pushUnique(brief.secondaryEvidence, 'Use a differential math trace MATH1 = CH1 - CH2.');
  }
  if (/\bvpp\b|\bpk2pk\b|\bpeak[-\s]?to[-\s]?peak\b/i.test(joined)) {
    pushUnique(brief.measurementGoals, 'PK2PK ripple on MATH1');
  }
  if (/\bvpk\b|\bvmax\b|\bpositive peak\b/i.test(joined)) {
    pushUnique(brief.measurementGoals, 'HIGH / positive peak on MATH1');
  }
  if (mentionsProtocol(joined, 'I2C')) pushUnique(brief.protocols, 'I2C');
  if (mentionsProtocol(joined, 'SPI')) pushUnique(brief.protocols, 'SPI');
  if (mentionsProtocol(joined, 'UART')) pushUnique(brief.protocols, 'UART/RS232');
  if (mentionsProtocol(joined, 'CAN')) pushUnique(brief.protocols, 'CAN');
  if (mentionsProtocol(joined, 'LIN')) pushUnique(brief.protocols, 'LIN');
  if (brief.protocols.length > 0) {
    brief.intent = brief.intent === 'general_debug' ? 'protocol_debug' : brief.intent;
    pushUnique(brief.diagnosticDomain, 'serial_decode');
    pushUnique(brief.measurementGoals, 'protocol decode / trigger / search');
    ['protocol configuration', 'protocol trigger/search', 'artifact capture'].forEach((item) =>
      pushUnique(brief.suggestedChecks, item)
    );
  }

  const signalTypeMatch = joined.match(/\b(nrz|pam4|pam-4)\b/i);
  if (signalTypeMatch) {
    brief.signalType = signalTypeMatch[1].toUpperCase() === 'PAM-4' ? 'PAM4' : signalTypeMatch[1].toUpperCase();
  }

  const dataRateMatch = joined.match(/\b(\d+(?:\.\d+)?)\s*(g|m|k)?(?:b\/s|bps|hz)\b/i);
  if (dataRateMatch) {
    brief.dataRate = `${dataRateMatch[1]}${String(dataRateMatch[2] || '').toUpperCase()}${/hz/i.test(dataRateMatch[0]) ? 'Hz' : 'bps'}`;
  }

  const closureMatch = joined.match(/\b(horizontal|vertical)\s+closure\b/i);
  if (closureMatch) {
    brief.closureType = closureMatch[1].toLowerCase();
  }

  const probingMatch = joined.match(/\b(diff(?:erential)? probe|single-ended probe|active probe|passive probe|sma|coax|direct sma)\b/i);
  if (probingMatch) {
    brief.probing = probingMatch[1];
  }

  if (/\bsingle sequence|single shot|one shot\b/i.test(joined)) {
    pushUnique(brief.operatingModeHints, 'single sequence acquisition');
  }
  if (/\bfastframe\b/i.test(joined)) {
    pushUnique(brief.operatingModeHints, 'FastFrame capture');
  }
  if (/\baverage\b/i.test(joined)) {
    pushUnique(brief.operatingModeHints, 'average acquisition');
  }
  if (/\bsave|screenshot|waveform|dump the data|export\b/i.test(joined)) {
    pushUnique(brief.artifactGoals, 'save capture artifacts');
  }

  const assistantEvidence = history
    .filter((turn) => turn.role === 'assistant')
    .flatMap((turn) =>
      String(turn.content || '')
        .split('\n')
        .map((line) => line.replace(/^[\s>*-]+/, '').trim())
        .filter(Boolean)
    );
  assistantEvidence.forEach((line) => {
    if (/acquisition sanity|channel health|differential integrity|breakout|eye metrics|debug triggers/i.test(line)) {
      pushUnique(brief.suggestedChecks, line);
    }
    if (/sample mode|bandwidth limit off|no averaging|deskew|common-mode|differential amplitude|eye height|noise amplitude|skew exceeds limit/i.test(line)) {
      pushUnique(brief.secondaryEvidence, line);
    }
  });

  if (brief.intent === 'eye_diagram_debug') {
    if (!brief.signalType) pushUnique(brief.unresolvedQuestions, 'signal type not specified (NRZ or PAM4)');
    if (!brief.dataRate) pushUnique(brief.unresolvedQuestions, 'data rate not specified');
    if (!brief.closureType) pushUnique(brief.unresolvedQuestions, 'closure orientation not specified (horizontal or vertical)');
    if (!brief.probing) pushUnique(brief.unresolvedQuestions, 'probing method not specified');
  }
  if (brief.protocols.length > 0 && brief.channels.length === 0) {
    pushUnique(brief.unresolvedQuestions, 'protocol source channels not specified');
  }

  if (brief.diagnosticDomain.length === 0) pushUnique(brief.diagnosticDomain, 'general_scope_debug');
  if (brief.measurementGoals.length === 0) pushUnique(brief.measurementGoals, 'diagnostic measurement workflow');
  return brief;
}

function inferConversationBuildFocus(history: Array<{ role: string; content?: string }>): string[] {
  const joined = history
    .map((turn) => String(turn.content || ''))
    .join('\n')
    .toLowerCase();
  const hints: string[] = [];

  if (/\beye diagram|closed eye|eye is closed|eye closure\b/.test(joined)) {
    hints.push('The build should be an eye-diagram diagnostic flow, not a generic measurement starter flow.');
    hints.push('Focus on signal-quality investigation steps relevant to eye closure such as jitter, amplitude/noise, persistence, capture quality, and screenshot evidence.');
  }
  if (/\bjitter\b/.test(joined)) {
    hints.push('Include jitter-oriented setup or measurements when appropriate.');
  }
  if (/\bintermittent|glitch|glitches\b/.test(joined)) {
    hints.push('Bias toward capture/debug flow structure for intermittent events.');
  }
  if (/\bi2c|spi|uart|can|lin|bus\b/.test(joined)) {
    hints.push('Prefer protocol/bus decode configuration over generic analog measurements when the conversation is about serial buses.');
  }
  if (/\bpower rail|ripple|supply|vdd\b/.test(joined)) {
    hints.push('Prefer power-integrity measurements such as mean, RMS, pk2pk, and save evidence.');
  }
  if (/\bharmonic|harmonics|thd\b/.test(joined)) {
    hints.push('Include power harmonics analysis configuration and measurements as discussed in the conversation.');
  }

  if (hints.length === 0) {
    hints.push('Build a flow that directly addresses the user’s specific diagnostic goal from the conversation, not a generic starter workflow.');
  }
  return hints;
}

function buildPromptFromRecentChat(history: Array<{ role: string; content?: string }>, latestMessage: string): string {
  // Compile the full conversation into a clean build prompt
  // The user and AI planned together — use everything discussed
  const userMessages = history
    .filter((t) => t.role === 'user')
    .map((t) => String(t.content || '').trim())
    .filter(Boolean);

  const aiSummary = history
    .filter((t) => t.role === 'assistant')
    .map((t) => String(t.content || '').trim())
    .filter(Boolean)
    .slice(-2) // last 2 AI responses have the refined plan
    .join('\n');

  return [
    'Build a TekAutomate flow from this conversation:',
    '',
    'User requests:',
    ...userMessages.map((m) => `- ${m.slice(0, 500)}`),
    '',
    aiSummary ? `AI plan summary:\n${aiSummary.slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n');
}

export function useAiChat(params: {
  steps: StepPreview[];
  runLog: string;
  code: string;
  executionSource: 'steps' | 'blockly' | 'live';
  runStatus: 'idle' | 'connecting' | 'running' | 'done' | 'error';
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    connectionType?: string;
    host?: string;
    deviceType?: string;
    deviceDriver?: string;
    visaBackend?: string;
    alias?: string;
    validationErrors?: string[];
    selectedStep?: StepPreview | null;
    instrumentMap?: Array<{
      alias: string;
      backend: string;
      host?: string;
      connectionType?: string;
      deviceType?: string;
      deviceDriver?: string;
      visaBackend?: string;
    }>;
  };
  executorEndpoint?: { host: string; port: number } | null;
  instrumentEndpoint?: { executorUrl: string; visaResource: string; backend: string; liveMode?: boolean } | null;
  instrumentOutputMode?: 'clean' | 'verbose';
  lastAuditReport?: import('../../utils/executionAudit').ExecutionAuditReport | null;
  onLiveScreenshot?: (screenshot: { dataUrl: string; mimeType: string; sizeBytes: number; capturedAt: string }) => void;
  onApplyAiActions?: (actions: AiAction[]) => Promise<{ applied: number; rerunStarted: boolean; changed: boolean }>;
}) {
  const { state, dispatch } = useAiChatContext();
  const hydratedRef = useRef(false);
  const [lastDiagnostics, setLastDiagnostics] = useState<{
    corpora: string[];
    retrievedChunkIds: string[];
    approxTokens: number;
    timings?: {
      clientMs?: number;
      serverTotalMs?: number;
      toolMs?: number;
      modelMs?: number;
      toolCalls?: number;
      iterations?: number;
      usedShortcut?: boolean;
      promptChars?: {
        system: number;
        user: number;
      };
    };
  } | null>(null);

  const providerModels = useMemo(
    () => DEFAULT_MODELS[state.provider],
    [state.provider]
  );

  useEffect(() => {
    // Allow custom model IDs; only force a default when model is empty.
    if (!state.model?.trim()) {
      dispatch({ type: 'SET_MODEL', model: providerModels[0] });
    }
  }, [dispatch, providerModels, state.model]);

  useEffect(() => {
    const normalized = canonicalizeModelId(state.model || '');
    if (normalized && normalized !== state.model && providerModels.includes(normalized)) {
      dispatch({ type: 'SET_MODEL', model: normalized });
    }
  }, [dispatch, providerModels, state.model]);

  // Keys are now loaded from dedicated localStorage in aiChatContext and
  // saved per-provider in the context save effect. No key effects needed here.

  const sendUserMessage = async (
    message: string,
    _hintCorpora: RagCorpus[] = [],
    options?: { standalone?: boolean; attachments?: McpChatAttachment[] }
  ) => {
    const text = message.trim();
    if (!text) return;
    const pendingFlowSteps = extractLatestPendingFlowSteps(state.history as Array<{ role: string; actions?: AiAction[] }>);
    // Only AI mode (not live) can trigger build handoffs — live mode always executes directly
    const chatBuildHandoff = state.tekMode === 'ai' && isChatBuildHandoffRequest(text);
    const autoBuildFollowUp =
      state.tekMode === 'ai' &&
      !chatBuildHandoff &&
      shouldAutoPromoteChatFollowUpToBuild({
        message: text,
        history: state.history as ChatTurn[],
        hasCurrentSteps: params.steps.length > 0,
        hasPendingFlowSteps: pendingFlowSteps.length > 0,
      });
    // When user says "build it" with an AI provider + key, let the AI handle the build.
    // The AI has full conversation context and can return ACTIONS_JSON via tek_router.
    // Only fall back to MCP-only deterministic planner when no AI key is available.
    const hasAiKey = state.apiKey.trim().length > 0;
    const aiBuildHandoff = (chatBuildHandoff || autoBuildFollowUp) && hasAiKey;
    const effectiveTekMode: TekMode = (chatBuildHandoff || autoBuildFollowUp) && !hasAiKey ? 'mcp' : state.tekMode;
    // When building from AI chat with OpenAI provider + key, route via assistant
    const buildHandoffViaAssistant = aiBuildHandoff
      && state.provider === 'openai';
    const forceFreshBuild = effectiveTekMode === 'mcp' && shouldForceFreshBuild(text, state.tekMode);
    const handoffHistory = (chatBuildHandoff || autoBuildFollowUp)
      ? extractActiveBuildHandoffHistory(state.history as ChatTurn[])
      : [];
    const handoffBrief = (chatBuildHandoff || autoBuildFollowUp)
      ? extractStructuredBuildBrief(handoffHistory as Array<{ role: string; content?: string }>)
      : null;
    const effectiveMessage = (chatBuildHandoff || autoBuildFollowUp)
      ? buildPromptFromRecentChat(handoffHistory as Array<{ role: string; content?: string }>, text) +
        (aiBuildHandoff ? '\n\nIMPORTANT: Return ACTIONS_JSON with the built flow. Use tek_router({action:"build", query:"<summary of what to build>"}) to generate verified steps. Return the result as ACTIONS_JSON: {...} so the app can apply it.' : '')
      : text;
    const trimmedKey = state.apiKey.trim();
    const requiresByok = state.tekMode !== 'mcp';
    if (requiresByok && !trimmedKey) {
      dispatch({ type: 'SET_ERROR', error: 'Enter API key first.' });
      return;
    }

    dispatch({
      type: 'ADD_TURN',
      turn: {
        role: 'user',
        content: text,
        timestamp: Date.now(),
        tekMode: effectiveTekMode,
        isStandaloneQuickAction: Boolean(options?.standalone),
      },
    });
    dispatch({ type: 'STREAM_START', tekMode: effectiveTekMode });

    try {
      setLastDiagnostics(null);
      let finalText = '';
      const requestStartedAt = Date.now();

      // ── Live mode: browser calls AI API directly, MCP only for tool execution ──
      // API key stays in browser, never passes through MCP server.
      // Uses anthropic-dangerous-direct-browser-access header for Anthropic CORS.
      if (effectiveTekMode === 'live') {
        const allTools = await fetchLiveTools();
        // Only expose the tools AI needs — keeps token count low
        const liveToolNames = new Set([
          'send_scpi', 'capture_screenshot', 'get_instrument_state', 'get_visa_resources',
          'smart_scpi_lookup', 'search_scpi', 'get_command_by_header',
          'retrieve_rag_chunks', 'tek_router',
        ]);
        const liveTools = allTools.filter((t) => liveToolNames.has(t.name));
        const executorUrl = params.instrumentEndpoint?.executorUrl || '';
        const visaResource = params.instrumentEndpoint?.visaResource || '';
        const backend = params.instrumentEndpoint?.backend || 'pyvisa';
        const modelFamily = params.flowContext?.modelFamily || '';
        const deviceDriver = params.flowContext?.deviceDriver || '';
        const systemPrompt = buildLiveSystemPrompt(params.instrumentEndpoint ? {
          executorUrl, visaResource, backend, modelFamily, deviceDriver,
        } : undefined);

        const result = await runLiveToolLoop({
          provider: state.provider,
          apiKey: trimmedKey,
          model: state.model,
          systemPrompt,
          userMessage: effectiveMessage,
          history: state.history.slice(-2).map((h) => ({
            role: h.role,
            content: String(h.content || '').slice(0, 1000),
          })),
          tools: liveTools,
          instrumentEndpoint: params.instrumentEndpoint ?? undefined,
          flowContext: { modelFamily, deviceDriver },
          maxIterations: 12,
        });

        if (result.error) {
          dispatch({ type: 'STREAM_DONE' });
          dispatch({ type: 'SET_ERROR', error: result.error });
          return;
        }
        finalText = result.text || '';
        if (finalText) dispatch({ type: 'STREAM_CHUNK', chunk: finalText });

        // Extract screenshot from tool calls and update live UI
        if (params.onLiveScreenshot && result.toolCalls.length > 0) {
          const screenshotCall = [...result.toolCalls].reverse().find(
            (tc) => tc.tool === 'capture_screenshot' && tc.result && typeof tc.result === 'object'
          );
          if (screenshotCall) {
            const r = screenshotCall.result as Record<string, unknown>;
            const base64 = r.base64 as string | undefined;
            const mimeType = (r.mimeType as string) || 'image/png';
            if (base64 && base64.length > 100) {
              params.onLiveScreenshot({
                dataUrl: `data:${mimeType};base64,${base64}`,
                mimeType,
                sizeBytes: Math.round(base64.length * 0.75),
                capturedAt: (r.capturedAt as string) || new Date().toISOString(),
              });
            }
          }
        }

        dispatch({ type: 'STREAM_DONE' });
        return;
      }

      // ── AI Chat + Anthropic: browser-direct with MCP context ──
      // 1. Fetch SCPI + RAG context from MCP (tools/execute)
      // 2. Call Anthropic API directly from browser (no MCP proxy)
      // Claude generates ACTIONS_JSON directly when user wants to build/add steps.
      if (effectiveTekMode === 'ai' && state.provider === 'anthropic') {
        try {
          // Pre-load context from MCP tools (same as MCP path does server-side)
          let preContext = '';
          const hasHistory = state.history.length > 0;
          if (!hasHistory) {
            const contextParts: string[] = [];
            try {
              const mcpTools = await fetchLiveTools();
              if (mcpTools.length > 0) {
                // Use tek_router for SCPI + knowledge in one call
                const routerRes = await fetch(`${resolveMcpHost().replace(/\/$/, '')}/tools/execute`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tool: 'tek_router',
                    args: { action: 'search', query: effectiveMessage, modelFamily: params.flowContext?.modelFamily, limit: 3 },
                  }),
                });
                if (routerRes.ok) {
                  const routerJson = await routerRes.json() as { ok: boolean; result: Record<string, unknown> };
                  if (routerJson.ok) {
                    const results = (routerJson.result as any)?.results || [];
                    const knowledge = (routerJson.result as any)?.knowledge || [];
                    if (results.length > 0) {
                      contextParts.push('Relevant SCPI commands:\n' + results.slice(0, 3).map((r: any) =>
                        `${r.name}: ${JSON.stringify(r.syntax || {}).slice(0, 100)}`
                      ).join('\n'));
                    }
                    if (knowledge.length > 0) {
                      contextParts.push('Knowledge:\n' + knowledge.slice(0, 2).map((k: any) =>
                        `${k.title}: ${(k.body || '').slice(0, 200)}`
                      ).join('\n'));
                    }
                  }
                }
              }
            } catch { /* non-fatal */ }
            if (contextParts.length > 0) {
              preContext = '\n\n---\nContext from TekAutomate:\n' + contextParts.join('\n\n');
            }
          }

          // Build user content with image attachments for Anthropic vision
          const pendingAttachments = options?.attachments || [];
          const imageBlocks = pendingAttachments
            .filter((a) => a.mimeType?.startsWith('image/') && a.dataUrl)
            .slice(0, 4)
            .map((a) => {
              const match = String(a.dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
              if (!match) return null;
              return {
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: match[1], data: match[2] },
              };
            })
            .filter(Boolean);
          const userContent = imageBlocks.length > 0
            ? [{ type: 'text' as const, text: effectiveMessage + preContext }, ...imageBlocks]
            : effectiveMessage + preContext;

          // Fetch slim tool surface from MCP server
          const chatTools = await fetchLiveTools();

          // Use the live tool loop for multi-round tool calling
          const loopResult = await runLiveToolLoop({
            provider: 'anthropic',
            apiKey: trimmedKey,
            model: state.model,
            systemPrompt: buildAnthropicBuilderSystemPrompt(
              params.flowContext?.modelFamily || 'scope',
              params.flowContext?.backend || 'pyvisa',
              params.flowContext?.deviceType || 'SCOPE',
            ),
            userMessage: (typeof userContent === 'string' ? userContent : effectiveMessage + preContext),
            history: state.history.slice(-8).map((h) => ({
              role: h.role as string,
              content: String(h.content || '').slice(0, 6000),
            })),
            tools: chatTools,
            instrumentEndpoint: params.flowContext ? {
              executorUrl: '',
              visaResource: '',
              backend: params.flowContext.backend || 'pyvisa',
              liveMode: false,
            } : undefined,
            flowContext: {
              modelFamily: params.flowContext?.modelFamily,
              deviceDriver: params.flowContext?.deviceDriver,
            },
            maxIterations: 6,
            onChunk: (chunk) => dispatch({ type: 'STREAM_CHUNK', chunk }),
            onToolCall: (name, args) => console.log(`[AI Chat] Tool call: ${name}`, args),
            onToolResult: (name, result) => console.log(`[AI Chat] Tool result: ${name}`, result),
          });

          const text = loopResult.text || '';
          if (loopResult.error) {
            console.warn('[AI Chat] Anthropic tool loop error:', loopResult.error);
          }
          if (text) {
            finalText = text;
            dispatch({ type: 'STREAM_CHUNK', chunk: text });
          }
          // Parse ACTIONS_JSON / flow JSON from Claude's response
          const anthropicParsed = (() => {
            const result = tryParseResult(text);
            return result ? sanitizeParsedResult(result) : null;
          })();
          dispatch({
            type: 'STREAM_DONE',
            actions: anthropicParsed?.actions,
            parsed: anthropicParsed
              ? {
                  summary: anthropicParsed.summary,
                  findings: anthropicParsed.findings,
                  suggestedFixes: anthropicParsed.suggestedFixes,
                  confidence: anthropicParsed.confidence,
                }
              : undefined,
          });
          return;
        } catch (browserErr) {
          // If browser-direct fails, fall through to MCP path
          console.warn('[AI Chat] Anthropic browser-direct failed, falling through to MCP:', browserErr);
        }
      }

      // ── MCP and AI Chat modes route through MCP server ──
      // MCP mode: deterministic planner, no API key needed
      // AI mode: server proxies AI call, chat interaction
      // Live mode: server proxies AI call with tool loop (send_scpi, screenshot, etc.)
      const shouldRouteViaAssistant = buildHandoffViaAssistant || (state.tekMode === 'ai' && state.provider === 'openai' && effectiveTekMode !== 'mcp');
      const reuseOpenAiThread = shouldReuseOpenAiThread({
        threadId: state.openaiThreadId,
        shouldRouteViaAssistant,
        standalone: Boolean(options?.standalone),
        forceFreshBuild,
        history: state.history,
      });
      if (!reuseOpenAiThread && state.openaiThreadId) {
        dispatch({ type: 'SET_OPENAI_THREAD_ID', value: '' });
      }
      const effectiveSteps =
        forceFreshBuild
          ? []
          : params.steps.length > 0
          ? params.steps
          : (isConversationalFlowFollowUp(text) || autoBuildFollowUp ? pendingFlowSteps : []);
      const selectedStepId =
        forceFreshBuild
          ? null
          : (params.flowContext?.selectedStep && String(params.flowContext.selectedStep.id || '').trim()) || null;
      const mcpRequest = {
        userMessage: effectiveMessage,
        buildNew: forceFreshBuild,
        buildBrief: handoffBrief
          ? {
              intent: handoffBrief.intent,
              diagnosticDomain: handoffBrief.diagnosticDomain,
              channels: handoffBrief.channels,
              protocols: handoffBrief.protocols,
              signalType: handoffBrief.signalType,
              dataRate: handoffBrief.dataRate,
              closureType: handoffBrief.closureType,
              probing: handoffBrief.probing,
              measurementGoals: handoffBrief.measurementGoals,
              artifactGoals: handoffBrief.artifactGoals,
              operatingModeHints: handoffBrief.operatingModeHints,
              unresolvedQuestions: handoffBrief.unresolvedQuestions,
              suggestedChecks: handoffBrief.suggestedChecks,
              secondaryEvidence: handoffBrief.secondaryEvidence,
            }
          : undefined,
        attachments: options?.attachments || [],
        interactionMode: effectiveTekMode === 'ai'
          ? ('chat' as const)
          : ('build' as const),
        outputMode: effectiveTekMode === 'ai'
          ? ('chat' as const)
          : params.executionSource === 'blockly' ? 'blockly_xml' : 'steps_json',
        mode: (effectiveTekMode === 'mcp' && !buildHandoffViaAssistant) ? ('mcp_only' as const) : (undefined as any),
        provider: (effectiveTekMode === 'mcp' && !buildHandoffViaAssistant) ? ('openai' as const) : (state.provider as any),
        apiKey: (effectiveTekMode === 'mcp' && !buildHandoffViaAssistant) ? '__mcp_only__' : trimmedKey,
        model: (effectiveTekMode === 'mcp' && !buildHandoffViaAssistant) ? 'gpt-5.4-mini' : state.model,
        toolCallMode: false,
        openaiAssistantId: shouldRouteViaAssistant
          ? state.openaiAssistantId.trim() || SERVER_DEFAULT_ASSISTANT_TOKEN
          : undefined,
        openaiThreadId: reuseOpenAiThread ? state.openaiThreadId || undefined : undefined,
        flowContext: {
          backend: params.flowContext?.backend || 'pyvisa',
          host: params.flowContext?.host || '127.0.0.1',
          connectionType: params.flowContext?.connectionType || 'tcpip',
          modelFamily: params.flowContext?.modelFamily || 'unknown',
          steps: effectiveSteps,
          selectedStepId,
          executionSource: params.executionSource,
          deviceType: params.flowContext?.deviceType,
          deviceDriver: params.flowContext?.deviceDriver,
          visaBackend: params.flowContext?.visaBackend,
          alias: params.flowContext?.alias,
          validationErrors: params.flowContext?.validationErrors,
          selectedStep: params.flowContext?.selectedStep,
          instrumentMap: params.flowContext?.instrumentMap,
        },
        runContext: {
          runStatus: params.runStatus,
          logTail: params.runLog || '',
          auditOutput: params.lastAuditReport ? JSON.stringify(params.lastAuditReport, null, 2) : '',
          exitCode:
            typeof params.lastAuditReport?.summary?.exit_code === 'number'
              ? params.lastAuditReport.summary.exit_code
              : null,
          duration: undefined,
        },
        instrumentEndpoint: params.instrumentEndpoint
          ? {
              ...params.instrumentEndpoint,
              liveMode: params.instrumentEndpoint.liveMode === true,
              outputMode: params.instrumentOutputMode || 'verbose',
            }
          : undefined,
        history: options?.standalone
          ? []
          : ((chatBuildHandoff || autoBuildFollowUp) && handoffHistory.length > 0
              ? handoffHistory
              : state.history.slice(-6)
            ).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 4000) })),
      };

      const streamMeta = await streamMcpChat(mcpRequest as any, (chunk) => {
        finalText += chunk;
        dispatch({ type: 'STREAM_CHUNK', chunk });
      });
      // Update live UI with any screenshots captured during AI tool calls
      if (streamMeta.screenshots?.length && params.onLiveScreenshot) {
        const last = streamMeta.screenshots[streamMeta.screenshots.length - 1];
        params.onLiveScreenshot({
          dataUrl: `data:${last.mimeType};base64,${last.base64}`,
          mimeType: last.mimeType,
          sizeBytes: Math.round(last.base64.length * 0.75),
          capturedAt: last.capturedAt,
        });
      }
      const parseText = streamMeta.parseText || finalText;

      try {
        const host =
          process.env.REACT_APP_MCP_HOST ||
          (typeof window !== 'undefined' && localStorage.getItem('tekautomate.mcp.host')) ||
          'http://localhost:8787';
        const debugRes = await fetch(`${host.replace(/\/$/, '')}/ai/debug/last`);
        const debugJson = (await debugRes.json()) as {
          debug?: {
            timings?: {
              totalMs?: number;
              toolMs?: number;
              modelMs?: number;
              toolCalls?: number;
              iterations?: number;
              usedShortcut?: boolean;
              promptChars?: {
                system?: number;
                user?: number;
              };
            };
          };
        };
        const timings = debugJson.debug?.timings;
        setLastDiagnostics({
          corpora: [],
          retrievedChunkIds: [],
          approxTokens: 0,
          timings: {
            clientMs: Date.now() - requestStartedAt,
            serverTotalMs: timings?.totalMs,
            toolMs: timings?.toolMs,
            modelMs: timings?.modelMs,
            toolCalls: timings?.toolCalls,
            iterations: timings?.iterations,
            usedShortcut: timings?.usedShortcut,
            promptChars:
              timings?.promptChars?.system !== undefined || timings?.promptChars?.user !== undefined
                ? {
                    system: timings?.promptChars?.system ?? 0,
                    user: timings?.promptChars?.user ?? 0,
                  }
                : undefined,
          },
        });
      } catch {
        setLastDiagnostics({
          corpora: [],
          retrievedChunkIds: [],
          approxTokens: 0,
          timings: {
            clientMs: Date.now() - requestStartedAt,
          },
        });
      }

      const parsed = (() => {
        const result = tryParseResult(parseText);
        return result ? sanitizeParsedResult(result) : null;
      })();
      dispatch({
        type: 'STREAM_DONE',
        routedVia: shouldRouteViaAssistant ? 'assistant' : 'direct',
        openaiThreadId: shouldRouteViaAssistant ? streamMeta.openaiThreadId : undefined,
        actions: parsed?.actions,
        parsed: parsed
          ? {
              summary: parsed.summary,
              findings: parsed.findings,
              suggestedFixes: parsed.suggestedFixes,
              confidence: parsed.confidence,
            }
            : undefined,
      });
    } catch (err) {
      dispatch({ type: 'STREAM_DONE' }); // finalize streaming turn before error
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'AI request failed.',
      });
    }
  };

  const applyActionsFromTurn = async (
    turnIndex: number,
    actionIds?: string[]
  ): Promise<string> => {
    if (!params.onApplyAiActions) {
      return 'Apply action handler is unavailable in this view.';
    }
    const turn = state.history[turnIndex];
    if (turn?.appliedAt) {
      return 'These changes were already applied to the current flow.';
    }
    if (!turn?.actions?.length) {
      return 'No actions available on this response.';
    }
    const selected = actionIds?.length
      ? turn.actions.filter((a) => actionIds.includes(a.id))
      : turn.actions;
    if (!selected.length) return 'No actions selected.';
    if (selected.length === 1 && selected[0].action_type === 'replace_flow' && !canMaterializeAiAction(selected[0])) {
      return 'This assistant flow is descriptive, but it does not map to valid TekAutomate step types yet, so it cannot be applied automatically.';
    }

    const result = await params.onApplyAiActions(selected);
    if (result.changed && result.applied > 0) {
      const selectedIds = selected.map((a) => a.id).filter(Boolean);
      dispatch({ type: 'MARK_APPLIED', turnIndex, actionIds: selectedIds });
      if (selected.length === 1 && selected[0].action_type === 'replace_flow') {
        const stepCount = getReplaceFlowStepCount(selected[0]);
        return stepCount
          ? `Applied the proposed ${stepCount}-step flow. No auto-run was started. Click Run on scope when ready.`
          : 'Applied the proposed flow. No auto-run was started. Click Run on scope when ready.';
      }
      return `Applied ${result.applied} action(s). No auto-run was started. Click Run on scope when ready.`;
    }
    if (selected.length === 1 && selected[0].action_type === 'replace_flow') {
      dispatch({ type: 'MARK_NOOP', turnIndex });
      return 'This proposed flow already matches the current workspace.';
    }
    dispatch({ type: 'MARK_NOOP', turnIndex });
    return 'No flow changes were applied. The proposed actions did not change the current flow.';
  };

  const quickActions: PredefinedAction[] = [
    {
      id: 'check_flow',
      label: 'Check Flow',
      promptTemplate:
        'Review the current flow structure from the user perspective. Ignore run logs and environment issues. Call out only real flow blockers or risky design issues, and propose ACTIONS_JSON only if a concrete flow fix is needed.',
      corporaHint: ['app_logic', 'scpi'],
    },
    {
      id: 'validate_flow_commands',
      label: 'Verify SCPI in Flow',
      promptTemplate:
        'Verify all SCPI commands currently in the flow against the loaded command JSON/source-of-truth for this model family. Report invalid/missing headers, wrong argument usage, or risky concatenation. Propose ACTIONS_JSON fixes only for clear, safe corrections.',
      corporaHint: ['scpi', 'app_logic'],
    },
    {
      id: 'command_lookup',
      label: 'Look Up Command',
      promptTemplate:
        'Look up this command using current model/backend context and return BOTH formats when available: (1) SCPI header/syntax/valid values/examples and (2) tm_devices method/path/example. Include related commands and one concrete TekAutomate step suggestion.',
      corporaHint: ['scpi', 'tmdevices', 'app_logic', 'pyvisa_tekhsi'],
    },
    {
      id: 'tm_devices_lookup',
      label: 'Screenshot Placeholder',
      promptTemplate:
        'Create a temporary screenshot placeholder step for this flow (no execution side effects), and keep it easy to replace later.',
      corporaHint: ['app_logic'],
    },
    {
      id: 'check_logs',
      label: 'Check Run Logs',
      promptTemplate:
        'Review the latest run logs and audit only. If execution failed, explain the root cause with concrete evidence and exact remediation steps. If it succeeded, say "Run looks good."',
      corporaHint: ['errors', 'app_logic'],
    },
    {
      id: 'surprise_me',
      label: 'Surprise me',
      promptTemplate: SURPRISE_PROMPTS[Math.floor(Math.random() * SURPRISE_PROMPTS.length)],
      corporaHint: ['app_logic', 'scpi', 'tmdevices'],
    },
  ];

  const clearChat = () => {
    dispatch({ type: 'CLEAR' });
    dispatch({ type: 'SET_OPENAI_THREAD_ID', value: '' });
  };
  const setApiKey = (key: string) => dispatch({ type: 'SET_KEY', key });
  const clearApiKey = () => dispatch({ type: 'SET_KEY', key: '' });
  const setProvider = (provider: 'openai' | 'anthropic') => {
    // SET_PROVIDER in reducer auto-switches apiKey to the new provider's stored key
    dispatch({
      type: 'SET_PROVIDER',
      provider,
      model: DEFAULT_MODELS[provider][0],
    });
  };
  const setModel = (model: string) => dispatch({ type: 'SET_MODEL', model });
  const setToolCallMode = (value: boolean) => dispatch({ type: 'SET_TOOL_CALL_MODE', value });
  const setTekMode = (mode: TekMode) => {
    // Disconnect live VISA session when switching away from live mode
    if (state.tekMode === 'live' && mode !== 'live' && params.instrumentEndpoint) {
      disconnectLiveSession(params.instrumentEndpoint).catch(() => {});
    }
    dispatch({ type: 'SET_TEK_MODE', tekMode: mode });
  };
  const setOpenAiAssistantId = (value: string) =>
    dispatch({ type: 'SET_OPENAI_ASSISTANT_ID', value });

  return {
    state,
    providerModels,
    quickActions,
    lastDiagnostics,
    sendUserMessage,
    applyActionsFromTurn,
    clearChat,
    setApiKey,
    clearApiKey,
    setTekMode,
    setProvider,
    setModel,
    setToolCallMode,
    setOpenAiAssistantId,
  };
}
