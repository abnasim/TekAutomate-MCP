/**
 * OpenAI ChatKit Panel — embeds ChatKit for OpenAI AI Chat mode.
 *
 * Replaces the MCP-proxied OpenAI chat path with ChatKit's native agent
 * infrastructure. ChatKit handles conversation state, streaming, tool loops,
 * and compaction. We intercept responses to parse ACTIONS_JSON.
 *
 * Prerequisites:
 *   - npm install @openai/chatkit-react
 *   - <script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async />
 *   - Agent workflow created in OpenAI Agent Builder (workflow ID)
 *   - Domain allowlisted in OpenAI org settings
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatKit, useChatKit, type ThemeOption } from '@openai/chatkit-react';
import { parseAiActionResponse, type AiAction } from '../../utils/aiActions';
import { resolveMcpHost, resolveMcpHostCandidates } from '../../utils/ai/mcpClient';
import { buildWorkflowContext, executeMcpTool } from '../../utils/ai/liveToolLoop';
import type { StepPreview } from './StepsListPreview';

// ── Storage keys ──
const CHATKIT_WORKFLOW_ID_KEY = 'tekautomate.chatkit.workflow_id';
const CHATKIT_THREAD_KEY = 'tekautomate.chatkit.thread_id';
const CHATKIT_LIVE_SESSION_KEY = 'tekautomate.chatkit.live_session_key';
const DEFAULT_WORKFLOW_ID = 'wf_69cb9085f72c8190ae05b360552d6987032b7c148cd57c24';

function readCurrentTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

interface OpenAiChatKitPanelProps {
  apiKey: string;
  steps: StepPreview[];
  workflowId?: string;
  isLiveMode?: boolean;
  threadStorageKey?: string;
  userId?: string;
  historyEnabled?: boolean;
  workspaceRevision?: number;
  runLog?: string;
  autoApply?: boolean;
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    deviceDriver?: string;
    validationErrors?: unknown[];
    selectedStep?: { id?: string } | null;
  };
  instrumentEndpoint?: {
    executorUrl: string;
    visaResource: string;
    backend: string;
    liveMode?: boolean;
    liveToken?: string;
  } | null;
  latestLiveScreenshot?: LatestScreenshotState | null;
  onLiveScreenshot?: (screenshot: { dataUrl: string; mimeType: string; sizeBytes: number; capturedAt: string }) => void;
  onActionsDetected?: (actions: AiAction[], summary?: string) => void | Promise<unknown>;
  onProposalDetected?: (proposal: ParsedActionsPreview | null) => void;
  onThreadChange?: (threadId: string) => void;
  className?: string;
}

interface LatestScreenshotState {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
  capturedAt: string;
}

function getWorkflowId(explicitWorkflowId?: string): string {
  if (explicitWorkflowId?.trim()) return explicitWorkflowId.trim();
  try {
    return localStorage.getItem(CHATKIT_WORKFLOW_ID_KEY) || DEFAULT_WORKFLOW_ID;
  } catch {
    return DEFAULT_WORKFLOW_ID;
  }
}

function setStoredThreadId(id: string, threadStorageKey?: string): void {
  try {
    localStorage.setItem(threadStorageKey || CHATKIT_THREAD_KEY, id);
  } catch {
    // Ignore storage errors
  }
}

function getOrCreateLiveSessionKey(workflowId?: string, userId?: string): string {
  const resolvedWorkflowId = getWorkflowId(workflowId);
  const resolvedUserId = userId?.trim() || 'tekautomate-user';
  try {
    const existing = localStorage.getItem(CHATKIT_LIVE_SESSION_KEY);
    if (existing && existing.trim()) return existing.trim();
    const created = `chatkit:${resolvedWorkflowId}:${resolvedUserId}:live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(CHATKIT_LIVE_SESSION_KEY, created);
    return created;
  } catch {
    return `chatkit:${resolvedWorkflowId}:${resolvedUserId}:live-fallback`;
  }
}

function getStartScreenGreeting(isLiveMode: boolean): string {
  return isLiveMode
    ? 'What would you like to do?'
    : 'How can I help?';
}

function getStartScreenPrompts(isLiveMode: boolean): Array<{ label: string; prompt: string }> {
  return isLiveMode
    ? [
        { label: 'Check Instrument', prompt: 'Quick instrument check. Send *IDN? via send_scpi to identify the scope, then *ESR? and ALLEV? to check for errors. Report identity, status, and any errors. Do NOT send *LRN? — use existing session context.' },
        { label: 'Discover SCPI', prompt: 'Start SCPI discovery mode. Send *LRN? via send_scpi and keep the response as your baseline. Then tell me to go make any changes on the scope. When I say done, send *LRN? again via send_scpi and diff the two responses to show me the exact SCPI commands that changed.' },
        { label: 'Reset Instrument', prompt: 'Full instrument reset and reconnection. Send *RST via send_scpi, poll *OPC? until 1, then *CLS to clear status. Then send device_clear to clear the I/O buffer. Then disconnect to close the connection. Then send *IDN? to reconnect and verify. Finally send *LRN? to capture the fresh reset state as your new session context. Report when complete.' },
        { label: 'What can you do?', prompt: 'What can you do in Live mode? Brief overview.' },
      ]
    : [
        { label: 'What is TekAutomate?', prompt: 'What is TekAutomate? Explain what you are and how you help with test automation workflows for Tektronix instruments.' },
        { label: 'Build me a flow', prompt: 'Build me a new test automation workflow. Ask me what instrument and measurements I need.' },
        { label: 'Check instrument', prompt: 'Check the connected instrument and tell me its identity, status, and any errors.' },
      ];
}

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  type: 'button' | 'input';
  /** For button type: prompt to send on click */
  prompt?: string;
  /** For input type: placeholder text */
  placeholder?: string;
  /** For input type: tool to call */
  toolName?: string;
}

function getQuickActions(isLiveMode: boolean): QuickAction[] {
  return isLiveMode
    ? [
        { id: 'check_instrument', label: 'Check Instrument', icon: '🔗', type: 'button', prompt: 'Quick instrument check. Send *IDN? via send_scpi to identify, *ESR? and ALLEV? for errors. Report identity and any errors. Do NOT send *LRN? — use existing session context.' },
        { id: 'discover_scpi', label: 'Discover SCPI', icon: '🔍', type: 'button', prompt: 'Send *LRN? via send_scpi and keep as baseline. Then tell me to make changes on the scope. When I say done, send *LRN? again and diff to show exact SCPI commands that changed.' },
        { id: 'reset_instrument', label: 'Reset Instrument', icon: '🔄', type: 'button', prompt: 'Full instrument reset. Send *RST via send_scpi, poll *OPC? until 1, *CLS to clear status, device_clear for I/O buffer, disconnect to close connection, *IDN? to reconnect, *LRN? for fresh state. Report when complete.' },
      ]
    : [];
}

function getChatKitThemeOptions(theme: 'dark' | 'light'): ThemeOption {
  return (theme === 'dark'
    ? {
        colorScheme: 'dark',
        radius: 'soft',
        density: 'normal',
        color: {
          grayscale: { hue: 220, tint: 7, shade: 1 },
          accent: { primary: '#20E0FF', level: 2 },
        },
      }
    : {
        colorScheme: 'light',
        radius: 'soft',
        density: 'normal',
        color: {
          accent: { primary: '#007FE0', level: 2 },
        },
      }
  ) as ThemeOption;
}

function extractClientSecret(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.client_secret,
    record.clientSecret,
    typeof record.session === 'object' && record.session ? (record.session as Record<string, unknown>).client_secret : undefined,
    typeof record.session === 'object' && record.session ? (record.session as Record<string, unknown>).clientSecret : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (candidate && typeof candidate === 'object') {
      const value = (candidate as Record<string, unknown>).value;
      if (typeof value === 'string' && value) return value;
    }
  }

  return null;
}

export interface ParsedActionsPreview {
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  actions: AiAction[];
  rawJson: string;
  source?: 'text' | 'tool' | 'mcp';
}

function decodeHtmlEntities(text: string): string {
  if (typeof document === 'undefined') return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function cleanSummaryText(text: string): string {
  return decodeHtmlEntities(String(text || ''))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function findBalancedJsonFromMarker(source: string, marker = 'ACTIONS_JSON:'): string | null {
  const raw = decodeHtmlEntities(String(source || ''));
  const markerIndex = raw.indexOf(marker);
  if (markerIndex === -1) return null;
  const jsonStart = raw.indexOf('{', markerIndex + marker.length);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(jsonStart, i + 1);
      }
    }
  }

  return null;
}

function extractDetailsBody(source: string): string | null {
  const raw = decodeHtmlEntities(String(source || ''));
  const match =
    raw.match(/<details>\s*<summary>[\s\S]*?<\/summary>\s*([\s\S]*?)<\/details>/i) ||
    raw.match(/&lt;details&gt;\s*&lt;summary&gt;[\s\S]*?&lt;\/summary&gt;\s*([\s\S]*?)&lt;\/details&gt;/i);
  return match?.[1]?.trim() || null;
}

function collectChatKitTextCandidates(container: HTMLDivElement): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown) => {
    const text = decodeHtmlEntities(String(value || '')).trim();
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    candidates.push(text);
  };

  const pushNodeText = (root: ParentNode | ShadowRoot | null | undefined) => {
    if (!root) return;
    push((root as ParentNode).textContent || '');
    const blocks = Array.from((root as ParentNode).querySelectorAll?.('pre, code, [data-message-content], article, section, div') || []);
    blocks.forEach((el) => {
      const text = (el as HTMLElement).innerText || el.textContent || '';
      if (text.includes('ACTIONS_JSON') || text.includes('<details>') || text.includes('"summary"')) {
        push(text);
      }
    });
  };

  pushNodeText(container);

  const chatKitEl = container.querySelector('openai-chatkit');
  if (chatKitEl) {
    pushNodeText(chatKitEl);
    pushNodeText(chatKitEl.shadowRoot);
    const iframes = Array.from(chatKitEl.querySelectorAll('iframe'));
    iframes.forEach((frame) => {
      try {
        pushNodeText((frame as HTMLIFrameElement).contentDocument?.body || null);
      } catch {
        // Cross-origin iframe content is not readable; ignore.
      }
    });
  }

  return candidates;
}

function collectStringCandidatesDeep(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringCandidatesDeep(item, seen));
  }

  const record = value as Record<string, unknown>;
  return Object.values(record).flatMap((item) => collectStringCandidatesDeep(item, seen));
}

function collectProposalObjectsDeep(
  value: unknown,
  seen = new Set<unknown>()
): Array<{
  summary?: string;
  findings?: unknown[];
  suggestedFixes?: unknown[];
  actions?: unknown[];
  rawJson?: string;
}> {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const matches: Array<{
    summary?: string;
    findings?: unknown[];
    suggestedFixes?: unknown[];
    actions?: unknown[];
    rawJson?: string;
  }> = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      matches.push(...collectProposalObjectsDeep(item, seen));
    }
    return matches;
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.actions)) {
    matches.push({
      summary: typeof record.summary === 'string' ? record.summary : undefined,
      findings: Array.isArray(record.findings) ? record.findings : undefined,
      suggestedFixes: Array.isArray(record.suggestedFixes) ? record.suggestedFixes : undefined,
      actions: record.actions,
      rawJson: JSON.stringify({
        summary: typeof record.summary === 'string' ? record.summary : '',
        findings: Array.isArray(record.findings) ? record.findings : [],
        suggestedFixes: Array.isArray(record.suggestedFixes) ? record.suggestedFixes : [],
        actions: record.actions,
      }),
    });
  }

  for (const item of Object.values(record)) {
    matches.push(...collectProposalObjectsDeep(item, seen));
  }

  return matches;
}

function buildRuntimeWorkflowPayload(
  steps: StepPreview[],
  flowContext?: OpenAiChatKitPanelProps['flowContext'],
) {
  const serializeStep = (step: StepPreview, indexPath: string): Record<string, unknown> => {
    const command =
      (step as any).params?.command ||
      (step as any).params?.code ||
      step.label ||
      step.type;
    const children = Array.isArray((step as any).children)
      ? ((step as any).children as StepPreview[]).map((child, idx) => serializeStep(child, `${indexPath}.${idx + 1}`))
      : [];
    return {
      indexPath,
      id: step.id,
      type: step.type,
      label: step.label || step.type,
      command,
      params: (step as any).params || {},
      childCount: children.length,
      children,
    };
  };

  const flattenSteps = (items: Record<string, unknown>[]): Array<Record<string, unknown>> => {
    const flat: Array<Record<string, unknown>> = [];
    const walk = (nodes: Record<string, unknown>[]) => {
      nodes.forEach((node) => {
        flat.push({
          indexPath: node.indexPath,
          id: node.id,
          type: node.type,
          label: node.label,
          command: node.command,
          childCount: node.childCount,
        });
        const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : [];
        if (children.length) walk(children);
      });
    };
    walk(items);
    return flat;
  };

  const tree = steps.map((s, i) => serializeStep(s, `${i + 1}`));
  const flatSteps = flattenSteps(tree);
  return {
    stepCount: flatSteps.length,
    topLevelStepCount: steps.length,
    steps: tree,
    flatSteps,
    selectedStep: flowContext?.selectedStep?.id || null,
    validationErrors: flowContext?.validationErrors || [],
    backend: flowContext?.backend || 'pyvisa',
    modelFamily: flowContext?.modelFamily || 'unknown',
    deviceDriver: flowContext?.deviceDriver || null,
    isEmpty: steps.length === 0,
  };
}

function buildRuntimeInstrumentPayload(
  instrumentEndpoint?: OpenAiChatKitPanelProps['instrumentEndpoint'] | null,
  flowContext?: OpenAiChatKitPanelProps['flowContext'],
  isLiveMode?: boolean,
) {
  return {
    connected: !!instrumentEndpoint?.executorUrl,
    executorUrl: instrumentEndpoint?.executorUrl || null,
    visaResource: instrumentEndpoint?.visaResource || null,
    backend: instrumentEndpoint?.backend || flowContext?.backend || 'pyvisa',
    modelFamily: flowContext?.modelFamily || 'unknown',
    deviceDriver: flowContext?.deviceDriver || null,
    liveMode: Boolean(isLiveMode || instrumentEndpoint?.liveMode),
  };
}

function normalizeScpiText(value: unknown): string {
  return String(value || '').replace(/^["']|["']$/g, '').trim();
}

function extractScpiResponseTexts(result: unknown): string[] {
  if (!result) return [];
  if (typeof result === 'string') return [normalizeScpiText(result)].filter(Boolean);
  if (Array.isArray(result)) {
    return result.flatMap((item) => extractScpiResponseTexts(item));
  }
  if (typeof result !== 'object') return [];

  const record = result as Record<string, unknown>;
  const collected: string[] = [];
  const push = (value: unknown) => {
    const text = normalizeScpiText(value);
    if (text) collected.push(text);
  };

  if (Array.isArray(record.responses)) {
    (record.responses as unknown[]).forEach((entry) => {
      if (entry && typeof entry === 'object') {
        const responseRecord = entry as Record<string, unknown>;
        push(responseRecord.response);
        push(responseRecord.output);
        push(responseRecord.stdout);
        push(responseRecord.combinedOutput);
      } else {
        push(entry);
      }
    });
  }

  push(record.stdout);
  push(record.output);
  push(record.combinedOutput);
  push(record.response);

  return collected.filter(Boolean);
}

function parseBandwidthFromOpt(optText: string): string | null {
  const normalized = normalizeScpiText(optText);
  if (!normalized) return null;
  const mhzMatch = normalized.match(/(\d+(?:\.\d+)?)\s*MHz/i);
  if (mhzMatch) return `${mhzMatch[1]} MHz`;
  const ghzMatch = normalized.match(/(\d+(?:\.\d+)?)\s*GHz/i);
  if (ghzMatch) return `${ghzMatch[1]} GHz`;
  return null;
}

function deriveModelMetadata(modelText: string): {
  deviceDriver: string | null;
  modelFamily: string | null;
  channelCount: string | null;
} {
  const model = normalizeScpiText(modelText).toUpperCase();
  if (!model) {
    return { deviceDriver: null, modelFamily: null, channelCount: null };
  }

  const exact = model.match(/^([A-Z]+)(\d)(\d)([A-Z]*)$/);
  if (exact) {
    const [, prefix, familyDigit, channelDigit] = exact;
    return {
      deviceDriver: model,
      modelFamily: `${prefix}${familyDigit}`,
      channelCount: channelDigit,
    };
  }

  const familyOnly = model.match(/^([A-Z]+)(\d)([A-Z]*)$/);
  if (familyOnly) {
    const [, prefix, familyDigit] = familyOnly;
    return {
      deviceDriver: model,
      modelFamily: `${prefix}${familyDigit}`,
      channelCount: null,
    };
  }

  return {
    deviceDriver: model,
    modelFamily: null,
    channelCount: null,
  };
}

async function buildLiveInstrumentInfoPayload(
  instrumentEndpoint?: OpenAiChatKitPanelProps['instrumentEndpoint'] | null,
  flowContext?: OpenAiChatKitPanelProps['flowContext'],
  isLiveMode?: boolean,
): Promise<Record<string, unknown>> {
  const base = buildRuntimeInstrumentPayload(instrumentEndpoint, flowContext, isLiveMode);
  if (!base.connected || !instrumentEndpoint?.executorUrl) return base;

  try {
    const queryResult = await executeMcpTool(
      'send_scpi',
      {
        commands: ['*IDN?', '*OPT?'],
        timeout_ms: 5000,
      },
      instrumentEndpoint || undefined,
      { modelFamily: flowContext?.modelFamily, deviceDriver: flowContext?.deviceDriver },
    );

    const responses = extractScpiResponseTexts(queryResult);
    const idn = responses.find((text) => text.includes(',') || /^TEK/i.test(text)) || '';
    const opt = responses.find((text) => /MHz|GHz/i.test(text) && text !== idn) || responses[1] || '';

    const idnParts = idn.split(',').map((part) => part.trim()).filter(Boolean);
    const manufacturer = idnParts[0] || null;
    const model = idnParts[1] || flowContext?.deviceDriver || '';
    const serial = idnParts[2] || null;
    const firmware = idnParts[3] || null;
    const derived = deriveModelMetadata(model);
    const bandwidth = parseBandwidthFromOpt(opt);

    return {
      ...base,
      manufacturer,
      serial,
      firmware,
      idn,
      options: opt || null,
      deviceDriver: derived.deviceDriver || base.deviceDriver,
      modelFamily: derived.modelFamily || base.modelFamily,
      channelCount: derived.channelCount,
      bandwidth,
    };
  } catch (error) {
    return {
      ...base,
      warnings: [error instanceof Error ? error.message : 'Failed to query instrument identity.'],
    };
  }
}

function buildLiveSessionPayload(
  threadId: string | null,
  workflowId?: string,
  userId?: string,
) {
  const resolvedWorkflowId = getWorkflowId(workflowId);
  const resolvedUserId = userId?.trim() || 'tekautomate-user';
  const normalizedThreadId = String(threadId || '').trim() || null;
  return {
    sessionKey: getOrCreateLiveSessionKey(workflowId, userId),
    threadId: normalizedThreadId,
    workflowId: resolvedWorkflowId,
    userId: resolvedUserId,
  };
}

function extractScreenshotPayload(value: unknown): LatestScreenshotState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested = record.data && typeof record.data === 'object'
    ? (record.data as Record<string, unknown>)
    : null;
  const source = typeof record.base64 === 'string' ? record : nested;
  if (!source || typeof source.base64 !== 'string' || !source.base64) return null;
  const mimeType = typeof source.mimeType === 'string' ? source.mimeType : 'image/png';
  const capturedAt = typeof source.capturedAt === 'string' ? source.capturedAt : new Date().toISOString();
  const sizeBytes = typeof source.sizeBytes === 'number'
    ? source.sizeBytes
    : Math.floor((source.base64.length * 3) / 4);
  return {
    dataUrl: `data:${mimeType};base64,${source.base64}`,
    mimeType,
    sizeBytes,
    capturedAt,
  };
}

export function OpenAiChatKitPanel(props: OpenAiChatKitPanelProps) {
  const [chatKitTheme, setChatKitTheme] = useState<'dark' | 'light'>(() => readCurrentTheme());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncTheme = () => setChatKitTheme(readCurrentTheme());
    syncTheme();

    const root = document.documentElement;
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    window.addEventListener('focus', syncTheme);
    window.addEventListener('pageshow', syncTheme);

    return () => {
      observer.disconnect();
      window.removeEventListener('focus', syncTheme);
      window.removeEventListener('pageshow', syncTheme);
    };
  }, []);

  return <OpenAiChatKitPanelInner key={chatKitTheme} {...props} chatKitTheme={chatKitTheme} />;
}

function OpenAiChatKitPanelInner({
  apiKey,
  steps,
  workflowId,
  isLiveMode = false,
  threadStorageKey,
  userId,
  historyEnabled = true,
  workspaceRevision,
  runLog,
  autoApply = false,
  flowContext,
  instrumentEndpoint,
  latestLiveScreenshot,
  onLiveScreenshot,
  onActionsDetected,
  onProposalDetected,
  onThreadChange,
  className,
  chatKitTheme,
}: OpenAiChatKitPanelProps & { chatKitTheme: 'dark' | 'light' }) {
  const [initError, setInitError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const chatKitThemeOptions = getChatKitThemeOptions(chatKitTheme);
  const [isSendingPrompt, setIsSendingPrompt] = useState(false);
  const [activeQuickAction, setActiveQuickAction] = useState<string | null>(null);
  const quickActionInputRef = useRef<HTMLInputElement>(null);
  const onActionsRef = useRef(onActionsDetected);
  onActionsRef.current = onActionsDetected;
  const onProposalDetectedRef = useRef(onProposalDetected);
  onProposalDetectedRef.current = onProposalDetected;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const flowContextRef = useRef(flowContext);
  flowContextRef.current = flowContext;
  const instrumentEndpointRef = useRef(instrumentEndpoint);
  instrumentEndpointRef.current = instrumentEndpoint;
  const onLiveScreenshotRef = useRef(onLiveScreenshot);
  onLiveScreenshotRef.current = onLiveScreenshot;
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;
  const lastContextSentRef = useRef('');
  const lastParsedJsonRef = useRef('');
  const responseScanTimersRef = useRef<number[]>([]);
  const seenProposalIdRef = useRef('');
  const proposalSessionStartedAtRef = useRef(Date.now());

  const setStructuredProposal = useCallback((
    proposal: {
      summary?: string;
      findings?: unknown[];
      suggestedFixes?: unknown[];
      actions?: unknown[];
      rawJson?: string;
    },
  ) => {
    const parsed = parseAiActionResponse(JSON.stringify({
      summary: typeof proposal.summary === 'string' ? proposal.summary : '',
      findings: Array.isArray(proposal.findings) ? proposal.findings : [],
      suggestedFixes: Array.isArray(proposal.suggestedFixes) ? proposal.suggestedFixes : [],
      actions: Array.isArray(proposal.actions) ? proposal.actions : [],
    }));
    if (!parsed?.actions?.length) return false;

    const preview: ParsedActionsPreview = {
      summary: cleanSummaryText(parsed.summary || ''),
      findings: parsed.findings || [],
      suggestedFixes: parsed.suggestedFixes || [],
      actions: parsed.actions,
      rawJson: proposal.rawJson || JSON.stringify({
        summary: parsed.summary || '',
        findings: parsed.findings || [],
        suggestedFixes: parsed.suggestedFixes || [],
        actions: parsed.actions,
      }),
      source: proposal.rawJson ? 'mcp' : 'tool',
    };

    const fingerprint = `${preview.summary}\n${preview.rawJson}`;
    if (fingerprint === lastParsedJsonRef.current) return true;
    lastParsedJsonRef.current = fingerprint;
    onProposalDetectedRef.current?.(preview);
    if (autoApplyRef.current) {
      onActionsRef.current?.(preview.actions, preview.summary);
    }
    return true;
  }, []);

  const extractActionsPreview = useCallback((text: string): ParsedActionsPreview | null => {
    const rawJson =
      (() => {
        const detailsBody = extractDetailsBody(text);
        return detailsBody ? findBalancedJsonFromMarker(detailsBody, 'ACTIONS_JSON:') : null;
      })() ||
      findBalancedJsonFromMarker(text, 'ACTIONS_JSON:')
      || findBalancedJsonFromMarker(text, 'actions_json:')
      || (() => {
        const trimmed = decodeHtmlEntities(String(text || '')).trim();
        if (!trimmed.startsWith('{')) return null;
        return trimmed;
      })();
    if (!rawJson) return null;
    const parsed = parseAiActionResponse(rawJson);
    if (!parsed?.actions?.length) return null;
    return {
      summary: cleanSummaryText(parsed.summary || ''),
      findings: parsed.findings || [],
      suggestedFixes: parsed.suggestedFixes || [],
      actions: parsed.actions,
      rawJson,
      source: 'text',
    };
  }, []);

  const scrubRenderedActionsJson = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const roots: Array<ParentNode | ShadowRoot> = [container];
    const chatKitEl = container.querySelector('openai-chatkit');
    if (chatKitEl) {
      roots.push(chatKitEl);
      if (chatKitEl.shadowRoot) roots.push(chatKitEl.shadowRoot);
    }

    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) textNodes.push(current as Text);
        current = walker.nextNode();
      }

      textNodes.forEach((node) => {
        const value = node.nodeValue || '';
        if (value.includes('<details><summary>ACTIONS_JSON')) {
          node.nodeValue = value.replace(/<details><summary>ACTIONS_JSON \(click to expand\)<\/summary>/g, '').trim();
        } else if (value.includes('</details>')) {
          node.nodeValue = value.replace(/<\/details>/g, '').trim();
        }
      });

      const blocks = Array.from((root as ParentNode).querySelectorAll?.('pre, code, div') || []);
      blocks.forEach((el) => {
        const text = decodeHtmlEntities((el.textContent || '').trim());
        if (/^ACTIONS_JSON:/i.test(text) || /^{"summary":/i.test(text) || text.includes('<details><summary>ACTIONS_JSON')) {
          (el as HTMLElement).style.display = 'none';
        }
      });
    }
  }, []);

  const captureActionsPreview = useCallback((text: string) => {
    const preview = extractActionsPreview(text);
    if (!preview) return false;
    const fingerprint = `${preview.summary}\n${preview.rawJson}`;
    if (fingerprint === lastParsedJsonRef.current) return true;
    lastParsedJsonRef.current = fingerprint;
    onProposalDetectedRef.current?.(preview);
    scrubRenderedActionsJson();
    if (autoApplyRef.current) {
      onActionsRef.current?.(preview.actions, preview.summary);
    }
    return true;
  }, [extractActionsPreview, scrubRenderedActionsJson]);

  const scanContainerForActions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    const candidates = collectChatKitTextCandidates(container);
    for (const candidate of candidates) {
      if (captureActionsPreview(candidate)) return true;
    }
    return false;
  }, [captureActionsPreview]);

  const fetchLatestStagedProposal = useCallback(async () => {
    const hosts = Array.from(new Set(resolveMcpHostCandidates().map((host) => host.replace(/\/+$/, ''))));
    if (!hosts.length) return false;

    let newest:
      | {
          host: string;
          proposal: {
            id?: string;
            createdAt?: string;
            summary?: string;
            findings?: unknown[];
            suggestedFixes?: unknown[];
            actions?: unknown[];
          };
          createdAtMs: number;
        }
      | null = null;

    for (const host of hosts) {
      try {
        const res = await fetch(`${host}/workflow-proposals/latest`);
        if (!res.ok) continue;
        const json = (await res.json()) as {
          ok?: boolean;
          proposal?: {
            id?: string;
            createdAt?: string;
            summary?: string;
            findings?: unknown[];
            suggestedFixes?: unknown[];
            actions?: unknown[];
          } | null;
        };
        const proposal = json?.proposal;
        if (!proposal?.id || !proposal?.createdAt) continue;
        if (proposal.id === seenProposalIdRef.current) continue;
        const createdAtMs = Date.parse(String(proposal.createdAt));
        if (Number.isFinite(createdAtMs) && createdAtMs < proposalSessionStartedAtRef.current) continue;
        if (!newest || (!Number.isNaN(createdAtMs) && createdAtMs > newest.createdAtMs)) {
          newest = { host, proposal, createdAtMs };
        }
      } catch {
        // Ignore individual host failures and try the next candidate.
      }
    }

    if (!newest) return false;

    const accepted = setStructuredProposal({
      summary: newest.proposal.summary,
      findings: Array.isArray(newest.proposal.findings) ? newest.proposal.findings : [],
      suggestedFixes: Array.isArray(newest.proposal.suggestedFixes) ? newest.proposal.suggestedFixes : [],
      actions: Array.isArray(newest.proposal.actions) ? newest.proposal.actions : [],
      rawJson: JSON.stringify({
        summary: newest.proposal.summary || '',
        findings: Array.isArray(newest.proposal.findings) ? newest.proposal.findings : [],
        suggestedFixes: Array.isArray(newest.proposal.suggestedFixes) ? newest.proposal.suggestedFixes : [],
        actions: Array.isArray(newest.proposal.actions) ? newest.proposal.actions : [],
      }),
    });
    if (accepted) {
      seenProposalIdRef.current = String(newest.proposal.id || '');
      console.log('[ChatKit] Accepted staged proposal from host:', newest.host);
      return true;
    }
    return false;
  }, [setStructuredProposal]);

  const handleWidgetAction = useCallback(async (
    action: { type: string; payload?: Record<string, unknown> },
  ) => {
    console.log('[ChatKit] Widget action:', action.type, action.payload);

    if (action.type === 'flow.apply' && action.payload?.actions) {
      const rawActions = action.payload.actions;
      const actions = Array.isArray(rawActions) ? rawActions : [];
      if (actions.length) {
        const parsed = parseAiActionResponse(JSON.stringify({
          actions,
          summary: typeof action.payload.summary === 'string' ? action.payload.summary : '',
        }));
        if (parsed?.actions?.length) {
          onActionsRef.current?.(parsed.actions, parsed.summary);
        } else {
          onActionsRef.current?.(actions as AiAction[], String(action.payload.summary || ''));
        }
      }
      return;
    }

    if (action.type === 'flow.addStep' && action.payload?.command) {
      const step = {
        type: 'insert_step_after' as const,
        action_type: 'insert_step_after' as const,
        targetStepId: null,
        payload: {
          newStep: {
            type: 'write',
            label: String(action.payload.command),
            params: { command: String(action.payload.command) },
          },
        },
      };
      onActionsRef.current?.([step as unknown as AiAction]);
      return;
    }

    if (action.type === 'flow.dismiss') {
      console.log('[ChatKit] User dismissed flow actions');
    }
  }, [isLiveMode]);

  // ── Session creation ──
  // Calls OpenAI ChatKit Sessions API directly from the browser.
  // The user's API key is used — no MCP proxy needed for session creation.
  const getClientSecret = useCallback(
    async (_currentSecret: string | null): Promise<string> => {
      const resolvedWorkflowId = getWorkflowId(workflowId);
      const resolvedUserId = userId?.trim() || 'tekautomate-user';
      if (!resolvedWorkflowId) {
        const msg = 'ChatKit workflow ID not configured.';
        setInitError(msg);
        throw new Error(msg);
      }
      if (!apiKey) {
        const msg = 'OpenAI API key is required for ChatKit.';
        setInitError(msg);
        throw new Error(msg);
      }

      try {
        // Try MCP server first (if available — handles session creation server-side)
        const mcpHost = resolveMcpHost();
        const sessionUrl = `${mcpHost.replace(/\/$/, '')}/chatkit/session`;
        console.log('[ChatKit] Creating session via:', sessionUrl);
        const res = await fetch(sessionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey,
            workflowId: resolvedWorkflowId,
            userId: resolvedUserId,
            chatkit_configuration: {
              file_upload: {
                enabled: true,
              },
            },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const secret = extractClientSecret(data);
          if (secret) {
            setInitError(null);
            return secret;
          }
        }
        console.warn('[ChatKit] MCP session returned non-ok:', res.status, await res.clone().text().catch(() => ''));
      } catch (mcpErr) {
        // MCP server not reachable — fall through to direct API call
        console.warn('[ChatKit] MCP server unreachable for session:', mcpErr);
      }

      // Direct call to OpenAI ChatKit Sessions API (fallback — may be CORS-blocked)
      console.log('[ChatKit] Trying direct OpenAI API fallback...');
      try {
        const res = await fetch('https://api.openai.com/v1/chatkit/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'chatkit_beta=v1',
          },
          body: JSON.stringify({
            workflow: { id: resolvedWorkflowId },
            user: resolvedUserId,
            chatkit_configuration: {
              file_upload: {
                enabled: true,
              },
            },
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          const msg = `ChatKit session failed (${res.status}): ${errText}`;
          console.error('[ChatKit]', msg);
          setInitError(msg);
          throw new Error(msg);
        }
        const data = await res.json();
        const secret = extractClientSecret(data);
        if (!secret) {
          const keys = data && typeof data === 'object'
            ? Object.keys(data as Record<string, unknown>).join(', ') || '(none)'
            : '(non-object response)';
          const msg = `ChatKit session returned no client_secret. Response keys: ${keys}`;
          setInitError(msg);
          throw new Error(msg);
        }
        setInitError(null);
        return secret;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'ChatKit session creation failed';
        setInitError(msg);
        throw err;
      }
    },
    [apiKey, userId, workflowId],
  );

  // ── ChatKit hook ──
  const chatkit = useChatKit({
    api: { getClientSecret },
    history: {
      enabled: historyEnabled,
      showDelete: historyEnabled,
      showRename: historyEnabled,
    },
    // Don't restore threads from localStorage — ChatKit manages thread history
    // internally via its built-in history UI. Reusing stale thread ids can
    // leave the surface blank until the user manually recovers.
    initialThread: null,
    onThreadChange: (detail: { threadId: string | null }) => {
      setActiveThreadId(detail.threadId ?? null);
      setStoredThreadId(detail.threadId || '', threadStorageKey);
      onThreadChange?.(detail.threadId || '');
    },
    onError: (detail: { error: Error }) => {
      console.error('[ChatKit] Error:', detail.error);
      const message = String(detail.error?.message || '').toLowerCase();
      if (message.includes('thread') && (message.includes('not found') || message.includes('404') || message.includes('invalid'))) {
        setStoredThreadId('', threadStorageKey);
        setActiveThreadId(null);
      }
      setInitError(detail.error?.message || 'ChatKit error');
    },
    onReady: () => {
      console.log('[ChatKit] Ready');
      setInitError(null);
      lastParsedJsonRef.current = '';
      seenProposalIdRef.current = '';
      proposalSessionStartedAtRef.current = Date.now();
    },
    onResponseStart: () => {
      lastParsedJsonRef.current = '';
      responseScanTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      responseScanTimersRef.current = [];
    },
    // ── Response end — scan for ACTIONS_JSON and auto-apply ──
    onResponseEnd: () => {
      responseScanTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      responseScanTimersRef.current = [];
      [150, 600, 1200, 2200, 3500].forEach((delay) => {
        const timer = window.setTimeout(() => {
          const matched = scanContainerForActions();
          void fetchLatestStagedProposal().then((proposalMatched) => {
            if (matched || proposalMatched) {
              console.log('[ChatKit] onResponseEnd rescan matched', { delay, matched, proposalMatched });
            }
          });
        }, delay);
        responseScanTimersRef.current.push(timer);
      });
    },
    onLog: (detail: { name?: string; data?: Record<string, unknown> }) => {
      const structuredCandidates = collectProposalObjectsDeep(detail?.data);
      for (const candidate of structuredCandidates) {
        const accepted = setStructuredProposal(candidate);
        if (accepted) {
          console.log('[ChatKit] Parsed structured proposal from log event:', detail?.name || '(unnamed)');
          return;
        }
      }

      const strings = collectStringCandidatesDeep(detail?.data);
      for (const text of strings) {
        if (!text.includes('ACTIONS_JSON') && !text.includes('"actions"') && !text.includes('"summary"')) continue;
        const matched = captureActionsPreview(text);
        if (matched) {
          console.log('[ChatKit] Parsed actions from log event:', detail?.name || '(unnamed)');
          break;
        }
      }
    },
    // Client-side tool execution — same split as liveToolLoop.ts:
    // Instrument tools (send_scpi, capture_screenshot, etc.) → browser calls executor directly
    // Knowledge tools (search_scpi, verify, browse, etc.) → browser calls MCP /tools/execute
    onClientTool: async ({ name, params }: { name: string; params: Record<string, unknown> }) => {
      console.log(`[onClientTool] ${name} — instrumentEndpoint:`, instrumentEndpointRef.current?.executorUrl || 'NULL');
      // ── Client-only tool: get_current_workflow ──
      // Returns current flow state directly from the browser — no MCP needed.
      // Agent calls this to see what steps exist, selected step, validation errors.
      if (name === 'get_current_workflow') {
        return buildRuntimeWorkflowPayload(stepsRef.current || [], flowContextRef.current);
      }

      // ── Client-only tool: get_instrument_info ──
      // Returns current instrument connection details from the browser.
      if (name === 'get_instrument_info') {
        return await buildLiveInstrumentInfoPayload(instrumentEndpointRef.current, flowContextRef.current, isLiveMode);
      }

      // ── Client-only tool: get_run_log ──
      // Returns the latest local execution log tail from the browser.
      if (name === 'get_run_log') {
        const raw = String(runLog || '');
        const lines = raw.split(/\r?\n/).filter(Boolean);
        const tailLines = lines.slice(-60);
        return {
          hasLogs: tailLines.length > 0,
          lineCount: lines.length,
          tailLineCount: tailLines.length,
          logTail: tailLines.join('\n'),
          lastLine: tailLines.length ? tailLines[tailLines.length - 1] : '',
        };
      }

      // ── Client-only proposal tools ──
      // Capture structured workflow proposals directly in the UI.
      // Support both the legacy ChatKit tool name and the newer MCP staging name.
      if (name === 'propose_workflow_actions' || name === 'stage_workflow_proposal') {
        const accepted = setStructuredProposal({
          summary: typeof params.summary === 'string' ? params.summary : '',
          findings: Array.isArray(params.findings) ? params.findings : [],
          suggestedFixes: Array.isArray(params.suggestedFixes) ? params.suggestedFixes : [],
          actions: Array.isArray(params.actions) ? params.actions : [],
        });
        return {
          ok: accepted,
          appliedUi: accepted,
          message: accepted
            ? 'TekAutomate captured the workflow proposal.'
            : 'Proposal was ignored because no valid actions were provided.',
        };
      }

      // ── Client-only tool: discover_scpi ──
      // Routes snapshot/diff through send_scpi *LRN? (which works) then forwards to MCP
      if (name === 'discover_scpi') {
        const discoverAction = String(params.action || 'snapshot');
        if (discoverAction === 'snapshot' || discoverAction === 'diff') {
          try {
            // Use send_scpi path which is proven to work
            const lrnResult = await executeMcpTool(
              'send_scpi',
              { commands: ['*LRN?'], timeout_ms: 15000 },
              instrumentEndpointRef.current || undefined,
              { modelFamily: flowContextRef.current?.modelFamily, deviceDriver: flowContextRef.current?.deviceDriver },
            );
            // Forward to MCP for storage/diff
            const mcpHost = resolveMcpHost();
            if (mcpHost) {
              const mcpRes = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tool: 'discover_scpi',
                  args: { ...params, _lrnResponse: JSON.stringify(lrnResult) },
                }),
              });
              if (mcpRes.ok) {
                const mcpJson = await mcpRes.json() as { ok: boolean; result: Record<string, unknown> };
                if (mcpJson.ok) {
                  const mcpResult = mcpJson.result;
                  // For snapshot: include raw *LRN? so AI has full context
                  if (discoverAction === 'snapshot') {
                    const data = (lrnResult as Record<string, unknown>)?.data ?? lrnResult;
                    const responses = ((data as Record<string, unknown>)?.responses ?? []) as Array<{ response?: string }>;
                    const rawLrn = responses[0]?.response || '';
                    if (rawLrn) mcpResult.lrnCommands = rawLrn;
                  }
                  return mcpResult;
                }
              }
            }
            // Fallback: return raw *LRN?
            return { ok: true, action: discoverAction, data: lrnResult };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'discover_scpi failed' };
          }
        }
        // inspect: fall through to MCP path
      }

      // ── MCP + executor tools ──
      try {
        const result = await executeMcpTool(
          name,
          params,
          instrumentEndpointRef.current || undefined,
          { modelFamily: flowContextRef.current?.modelFamily, deviceDriver: flowContextRef.current?.deviceDriver },
        );
        if (name === 'capture_screenshot') {
          const screenshot = extractScreenshotPayload(result);
          if (screenshot) {
            onLiveScreenshotRef.current?.(screenshot);
          }
        }
        return result as Record<string, unknown>;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Tool execution failed' };
      }
    },
    // UI customization
    theme: chatKitThemeOptions,
    composer: {
      placeholder: isLiveMode
        ? 'Tell TekAutomate Live what to do with the scope...'
        : 'Ask about measurements, debugging, scope setup...',
      attachments: ({
        enabled: true,
        maxCount: 4,
        accept: {
          'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
        },
      } as any),
    },
    widgets: {
      onAction: async (action) => {
        await handleWidgetAction(action);
      },
    },
  });

  const startScreenGreeting = getStartScreenGreeting(isLiveMode);
  const startScreenPrompts = getStartScreenPrompts(isLiveMode);

  const quickActions = getQuickActions(isLiveMode);

  const handleStarterPrompt = useCallback(async (prompt: string) => {
    if (!prompt || isSendingPrompt) return;
    setIsSendingPrompt(true);
    try {
      await chatkit.sendUserMessage({ text: prompt });
      chatkit.focusComposer?.();
    } catch (error) {
      console.warn('[ChatKit] starter prompt failed:', error);
    } finally {
      setIsSendingPrompt(false);
    }
  }, [chatkit, isSendingPrompt]);

  // ── Widget action handler — replaces MutationObserver for ACTIONS_JSON ──
  // ChatKit emits widget actions as DOM CustomEvents on the <openai-chatkit> element.
  // When user clicks "Apply to Flow" on the widget, we receive actions directly.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleAction = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type?: string; payload?: Record<string, unknown> } | undefined;
      if (!detail?.type) return;
      void handleWidgetAction({ type: detail.type, payload: detail.payload });
    };

    // Listen on the container — ChatKit widget actions bubble up as CustomEvents
    container.addEventListener('chatkit.action', handleAction);
    // Also try the chatkit element directly
    const chatKitEl = container.querySelector('openai-chatkit');
    if (chatKitEl) chatKitEl.addEventListener('chatkit.action', handleAction);

    return () => {
      container.removeEventListener('chatkit.action', handleAction);
      if (chatKitEl) chatKitEl.removeEventListener('chatkit.action', handleAction);
    };
  }, [handleWidgetAction]);

  // ── DOM observer for ACTIONS_JSON extraction (FALLBACK) ──
  // Primary path: onAction handler above receives structured data from widgets.
  // This observer is a fallback for when the agent returns raw ACTIONS_JSON
  // in text instead of a widget (e.g., if widget output isn't configured).
  const containerRef = useRef<HTMLDivElement>(null);
  const lastProcessedRef = useRef('');
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scanForActions = () => {
      // Try multiple sources — ChatKit may use shadow DOM (closed) or regular DOM
      const chatKitEl = container.querySelector('openai-chatkit');
      const sources = [
        chatKitEl?.shadowRoot?.textContent,  // open shadow root
        chatKitEl?.textContent,               // element text (includes shadow in some browsers)
        container.textContent,                // wrapper fallback
        // Also try iframes if ChatKit embeds one
        ...(chatKitEl ? Array.from(chatKitEl.querySelectorAll('iframe')).map(f => {
          try { return (f as HTMLIFrameElement).contentDocument?.body?.textContent; } catch { return null; }
        }) : []),
      ];
      const allText = sources.filter(Boolean).join('\n');
      if (!allText || allText === lastProcessedRef.current) return;
      lastProcessedRef.current = allText;
      if (allText.includes('ACTIONS_JSON')) {
        console.log('[ChatKit] DOM scan found ACTIONS_JSON');
      }
      scanContainerForActions();
    };

    const observer = new MutationObserver(() => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(scanForActions, 500);
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      responseScanTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      responseScanTimersRef.current = [];
    };
  }, [fetchLatestStagedProposal, scanContainerForActions, isLiveMode]);

  useEffect(() => {
    const mcpHost = resolveMcpHost();
    if (!mcpHost) return;

    const payload = {
      workflow: buildRuntimeWorkflowPayload(stepsRef.current || [], flowContextRef.current),
      instrument: buildRuntimeInstrumentPayload(instrumentEndpointRef.current, flowContextRef.current, isLiveMode),
      runLog: String(runLog || ''),
      liveSession: isLiveMode ? buildLiveSessionPayload(activeThreadId, workflowId, userId) : null,
    };

    void fetch(`${mcpHost.replace(/\/$/, '')}/runtime-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.warn('[ChatKit] Failed to sync runtime context:', error);
    });
  }, [steps, flowContext, instrumentEndpoint, runLog, activeThreadId, workspaceRevision, workflowId, userId, isLiveMode]);

  useEffect(() => {
    const mcpHost = resolveMcpHost();
    if (!isLiveMode) return;
    const liveSession = buildLiveSessionPayload(activeThreadId, workflowId, userId);
    if (!mcpHost || !liveSession) return;
    if (!instrumentEndpoint?.executorUrl) return;

    let cancelled = false;

    const loop = async () => {
      while (!cancelled) {
        let currentAction: { id: string; toolName: string; args?: Record<string, unknown> } | null = null;
        try {
          const nextRes = await fetch(
            `${mcpHost.replace(/\/$/, '')}/live-actions/next?sessionKey=${encodeURIComponent(liveSession.sessionKey)}&timeoutMs=20000`,
          );
          if (!nextRes.ok) {
            await new Promise((resolve) => window.setTimeout(resolve, 1500));
            continue;
          }
          const nextJson = (await nextRes.json()) as {
            ok?: boolean;
            action?: { id: string; toolName: string; args?: Record<string, unknown> } | null;
          };
          currentAction = nextJson.action || null;
          if (!currentAction?.id || !currentAction.toolName) {
            continue;
          }

          const result = await executeMcpTool(
            currentAction.toolName,
            currentAction.args || {},
            instrumentEndpointRef.current || undefined,
            {
              modelFamily: flowContextRef.current?.modelFamily,
              deviceDriver: flowContextRef.current?.deviceDriver,
            },
          );

          if (currentAction.toolName === 'capture_screenshot') {
            const screenshot = extractScreenshotPayload(result);
            if (screenshot) {
              onLiveScreenshotRef.current?.(screenshot);
            }
          }

          await fetch(`${mcpHost.replace(/\/$/, '')}/live-actions/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: currentAction.id,
              sessionKey: liveSession.sessionKey,
              ok: true,
              result,
            }),
          });
        } catch (error) {
          if (currentAction?.id) {
            try {
              await fetch(`${mcpHost.replace(/\/$/, '')}/live-actions/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: currentAction.id,
                  sessionKey: liveSession.sessionKey,
                  ok: false,
                  error: error instanceof Error ? error.message : 'Live action execution failed.',
                }),
              });
            } catch {
              // Ignore secondary reporting failures.
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }
      }
    };

    void loop();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, instrumentEndpoint?.executorUrl, userId, workflowId, flowContext?.deviceDriver, flowContext?.modelFamily, isLiveMode]);

  // ── Inject workflow context when steps change ──
  useEffect(() => {
    if (!activeThreadId) return;
    if (!stepsRef.current?.length) return;

    const ctx = buildWorkflowContext(
      stepsRef.current as any[],
      flowContextRef.current?.validationErrors as string[] | undefined,
      flowContextRef.current?.selectedStep?.id,
    );

    const contextKey = ctx ? JSON.stringify(ctx) : '';
    if (!ctx || contextKey === lastContextSentRef.current || !chatkit.sendCustomAction) return;

    void chatkit.sendCustomAction({
      type: 'workflow_context_update',
      payload: { context: ctx },
    }).then(() => {
      lastContextSentRef.current = contextKey;
    }).catch((err) => {
      const message = String(err instanceof Error ? err.message : err || '');
      if (
        message.includes('sendAction() ignored - thread is loading')
        || message.includes('sendAction() ignored - already responding')
      ) {
        return;
      }
      console.warn('[ChatKit] workflow_context_update failed:', err);
    });
  }, [activeThreadId, chatkit, steps, workspaceRevision]);

  useEffect(() => {
    if ((workspaceRevision ?? 0) < 1) return;
    seenProposalIdRef.current = '';
    proposalSessionStartedAtRef.current = Date.now();
    lastParsedJsonRef.current = '';
  }, [workspaceRevision]);

  // ── Error state ──
  if (initError) {
    return (
      <div className={className} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>
            ChatKit failed to load
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, wordBreak: 'break-word' }}>
            {initError}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Check: API key is valid, workflow is published, domain is allowlisted in OpenAI org settings.
          </div>
          <button
            type="button"
            onClick={() => { setInitError(null); window.location.reload(); }}
            style={{ marginTop: 12, fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '1px solid #475569', color: '#cbd5e1', background: 'transparent', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {!activeThreadId ? (
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            padding: '20px 20px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: chatKitTheme === 'dark' ? '#111827' : '#ffffff',
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1.3,
              color: chatKitTheme === 'dark' ? '#f3f4f6' : '#111827',
              maxWidth: 720,
            }}
          >
            {startScreenGreeting}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {startScreenPrompts.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { void handleStarterPrompt(item.prompt); }}
                disabled={isSendingPrompt}
                style={{
                  borderRadius: 999,
                  border: '1px solid rgba(148,163,184,0.22)',
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: isSendingPrompt ? 'default' : 'pointer',
                  color: chatKitTheme === 'dark' ? '#e5e7eb' : '#1f2937',
                  background: chatKitTheme === 'dark' ? 'rgba(255,255,255,0.03)' : '#f9fafb',
                  opacity: isSendingPrompt ? 0.7 : 1,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ChatKit control={chatkit.control} style={{ width: '100%', height: '100%' }} />
        {quickActions.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px 6px',
            borderTop: `1px solid ${chatKitTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
            background: chatKitTheme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)',
          }}>
            {quickActions.map((qa) => {
              // Button type — simple click action
              if (qa.type === 'button') {
                return (
                  <button
                    key={qa.id}
                    type="button"
                    onClick={() => {
                      if (qa.prompt === '__ATTACH_SCREENSHOT__') {
                        // Screenshot attach — send latest screenshot as message
                        const screenshot = latestLiveScreenshot;
                        if (!screenshot?.dataUrl) {
                          void handleStarterPrompt('No screenshot available yet. Take a screenshot first by asking me to capture one, or run a command on the scope.');
                          return;
                        }
                        void handleStarterPrompt(`Here is the current scope screenshot. Analyze what you see and describe the waveforms, measurements, and any issues visible.\n\n![Scope Screenshot](${screenshot.dataUrl})`);
                      } else if (qa.prompt) {
                        void handleStarterPrompt(qa.prompt);
                      }
                    }}
                    disabled={isSendingPrompt}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      borderRadius: 6,
                      border: `1px solid ${chatKitTheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                      color: chatKitTheme === 'dark' ? '#94a3b8' : '#64748b',
                      background: 'transparent',
                      cursor: isSendingPrompt ? 'default' : 'pointer',
                      opacity: isSendingPrompt ? 0.5 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>{qa.icon}</span>
                    <span>{qa.label}</span>
                  </button>
                );
              }

              // Input type — toggle with text input (kept for future use)
              const isActive = activeQuickAction === qa.id;
              return (
                <div key={qa.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isActive) {
                        setActiveQuickAction(null);
                      } else {
                        setActiveQuickAction(qa.id);
                        setTimeout(() => quickActionInputRef.current?.focus(), 50);
                      }
                    }}
                    disabled={isSendingPrompt}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 500,
                      borderRadius: 6,
                      border: `1px solid ${isActive
                        ? (chatKitTheme === 'dark' ? '#20E0FF' : '#0091FF')
                        : (chatKitTheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')}`,
                      color: isActive
                        ? (chatKitTheme === 'dark' ? '#20E0FF' : '#0091FF')
                        : (chatKitTheme === 'dark' ? '#94a3b8' : '#64748b'),
                      background: isActive
                        ? (chatKitTheme === 'dark' ? 'rgba(32,224,255,0.08)' : 'rgba(0,145,255,0.06)')
                        : 'transparent',
                      cursor: isSendingPrompt ? 'default' : 'pointer',
                      opacity: isSendingPrompt ? 0.5 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>{qa.icon}</span>
                    <span>{qa.label}</span>
                    {isActive && <span style={{ marginLeft: 2, fontSize: 10, opacity: 0.7 }}>✕</span>}
                  </button>
                  {isActive && (
                    <form
                      style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const val = quickActionInputRef.current?.value?.trim();
                        if (!val || !qa.toolName) return;
                        setActiveQuickAction(null);
                        void (async () => {
                          try {
                            const result = await executeMcpTool(
                              qa.toolName!,
                              { query: val, limit: 10 },
                              instrumentEndpoint || undefined,
                              { modelFamily: flowContext?.modelFamily, deviceDriver: flowContext?.deviceDriver },
                            );
                            void handleStarterPrompt(`Search results for "${val}":\n\n${JSON.stringify(result, null, 2)}\n\nSummarize what was found.`);
                          } catch (err) {
                            void handleStarterPrompt(`Search for "${val}" failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
                          }
                        })();
                      }}
                    >
                      <input
                        ref={quickActionInputRef}
                        type="text"
                        placeholder={qa.placeholder}
                        disabled={isSendingPrompt}
                        style={{
                          flex: 1,
                          minWidth: 160,
                          padding: '4px 8px',
                          fontSize: 12,
                          borderRadius: 6,
                          border: `1px solid ${chatKitTheme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
                          background: chatKitTheme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                          color: chatKitTheme === 'dark' ? '#e2e8f0' : '#1e293b',
                          outline: 'none',
                        }}
                      />
                      <button
                        type="submit"
                        disabled={isSendingPrompt}
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 6,
                          border: 'none',
                          background: chatKitTheme === 'dark' ? '#20E0FF' : '#0091FF',
                          color: '#000',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Go
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default OpenAiChatKitPanel;
