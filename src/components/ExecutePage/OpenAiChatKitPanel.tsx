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
import { ChatKit, useChatKit } from '@openai/chatkit-react';
import { parseAiActionResponse, type AiAction } from '../../utils/aiActions';
import { resolveMcpHost } from '../../utils/ai/mcpClient';
import { buildWorkflowContext, executeMcpTool } from '../../utils/ai/liveToolLoop';
import type { StepPreview } from './StepsListPreview';

// ── Storage keys ──
const CHATKIT_WORKFLOW_ID_KEY = 'tekautomate.chatkit.workflow_id';
const CHATKIT_THREAD_KEY = 'tekautomate.chatkit.thread_id';
const DEFAULT_WORKFLOW_ID = 'wf_69cb9085f72c8190ae05b360552d6987032b7c148cd57c24';

interface OpenAiChatKitPanelProps {
  apiKey: string;
  steps: StepPreview[];
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
  } | null;
  onActionsDetected?: (actions: AiAction[], summary?: string) => void;
  onThreadChange?: (threadId: string) => void;
  className?: string;
}

function getWorkflowId(): string {
  try {
    return localStorage.getItem(CHATKIT_WORKFLOW_ID_KEY) || DEFAULT_WORKFLOW_ID;
  } catch {
    return DEFAULT_WORKFLOW_ID;
  }
}

function getStoredThreadId(): string {
  try {
    return localStorage.getItem(CHATKIT_THREAD_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredThreadId(id: string): void {
  try {
    localStorage.setItem(CHATKIT_THREAD_KEY, id);
  } catch {
    // Ignore storage errors
  }
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

interface ParsedActionsPreview {
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  actions: AiAction[];
  rawJson: string;
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

export function OpenAiChatKitPanel({
  apiKey,
  steps,
  runLog,
  autoApply = false,
  flowContext,
  instrumentEndpoint,
  onActionsDetected,
  onThreadChange,
  className,
}: OpenAiChatKitPanelProps) {
  const [initError, setInitError] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<ParsedActionsPreview | null>(null);
  const [applyingPreview, setApplyingPreview] = useState(false);
  const onActionsRef = useRef(onActionsDetected);
  onActionsRef.current = onActionsDetected;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const flowContextRef = useRef(flowContext);
  flowContextRef.current = flowContext;
  const instrumentEndpointRef = useRef(instrumentEndpoint);
  instrumentEndpointRef.current = instrumentEndpoint;
  const autoApplyRef = useRef(autoApply);
  autoApplyRef.current = autoApply;
  const lastContextSentRef = useRef('');
  const lastParsedJsonRef = useRef('');
  const responseScanTimersRef = useRef<number[]>([]);

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
    if (preview.rawJson === lastParsedJsonRef.current) return true;
    lastParsedJsonRef.current = preview.rawJson;
    setParsedPreview(preview);
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
  }, []);

  const applyParsedPreview = useCallback(async () => {
    if (!parsedPreview?.actions?.length) return;
    setApplyingPreview(true);
    try {
      await Promise.resolve(onActionsRef.current?.(parsedPreview.actions, parsedPreview.summary));
    } finally {
      setApplyingPreview(false);
    }
  }, [parsedPreview]);

  // ── Session creation ──
  // Calls OpenAI ChatKit Sessions API directly from the browser.
  // The user's API key is used — no MCP proxy needed for session creation.
  const getClientSecret = useCallback(
    async (_currentSecret: string | null): Promise<string> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
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
          body: JSON.stringify({ apiKey, workflowId, userId: 'tekautomate-user' }),
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
            workflow: { id: workflowId },
            user: 'tekautomate-user',
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
    [apiKey],
  );

  // ── ChatKit hook ──
  const chatkit = useChatKit({
    api: { getClientSecret },
    // Don't restore threads from localStorage — ChatKit manages thread history
    // internally via its built-in history UI. Storing thread IDs causes stale
    // 404s when threads expire or get deleted on OpenAI's side.
    initialThread: null,
    onThreadChange: (detail: { threadId: string | null }) => {
      setActiveThreadId(detail.threadId ?? null);
      onThreadChange?.(detail.threadId || '');
    },
    onError: (detail: { error: Error }) => {
      console.error('[ChatKit] Error:', detail.error);
      setInitError(detail.error?.message || 'ChatKit error');
    },
    onReady: () => {
      console.log('[ChatKit] Ready');
      setInitError(null);
      setParsedPreview(null);
      lastParsedJsonRef.current = '';
    },
    // ── Response end — scan for ACTIONS_JSON and auto-apply ──
    onResponseEnd: () => {
      responseScanTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      responseScanTimersRef.current = [];
      [150, 600, 1200, 2200, 3500].forEach((delay) => {
        const timer = window.setTimeout(() => {
          const matched = scanContainerForActions();
          console.log('[ChatKit] onResponseEnd rescan', { delay, matched });
        }, delay);
        responseScanTimersRef.current.push(timer);
      });
    },
    onLog: (detail: { name?: string; data?: Record<string, unknown> }) => {
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
      // ── Client-only tool: get_current_workflow ──
      // Returns current flow state directly from the browser — no MCP needed.
      // Agent calls this to see what steps exist, selected step, validation errors.
      if (name === 'get_current_workflow') {
        const steps = stepsRef.current || [];
        const fc = flowContextRef.current;
        const stepSummary = steps.map((s: any, i: number) => {
          const cmd = s.params?.command || s.params?.code || s.label || s.type;
          return { index: i + 1, type: s.type, label: s.label || s.type, command: cmd, id: s.id };
        });
        return {
          stepCount: steps.length,
          steps: stepSummary,
          selectedStep: fc?.selectedStep?.id || null,
          validationErrors: fc?.validationErrors || [],
          backend: fc?.backend || 'pyvisa',
          modelFamily: fc?.modelFamily || 'unknown',
          deviceDriver: fc?.deviceDriver || null,
          isEmpty: steps.length === 0,
        };
      }

      // ── Client-only tool: get_instrument_info ──
      // Returns current instrument connection details from the browser.
      if (name === 'get_instrument_info') {
        const ep = instrumentEndpointRef.current;
        const fc = flowContextRef.current;
        return {
          connected: !!ep?.executorUrl,
          executorUrl: ep?.executorUrl || null,
          visaResource: ep?.visaResource || null,
          backend: ep?.backend || fc?.backend || 'pyvisa',
          modelFamily: fc?.modelFamily || 'unknown',
          deviceDriver: fc?.deviceDriver || null,
          liveMode: ep?.liveMode || false,
        };
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

      // ── MCP + executor tools ──
      try {
        const result = await executeMcpTool(
          name,
          params,
          instrumentEndpointRef.current || undefined,
          { modelFamily: flowContextRef.current?.modelFamily, deviceDriver: flowContextRef.current?.deviceDriver },
        );
        return result as Record<string, unknown>;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Tool execution failed' };
      }
    },
    // UI customization
    theme: typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    composer: {
      placeholder: 'Ask about measurements, debugging, scope setup...',
    },
    startScreen: {
      greeting: 'TekAutomate AI Chat — ask about SCPI, measurements, or say "build it" for a workflow.',
      prompts: [
        { label: 'Check my flow', prompt: 'Review the current workflow and suggest improvements.' },
        { label: 'Build a measurement', prompt: 'Build a frequency and amplitude measurement workflow for CH1.' },
      ],
    },
    widgets: {
      onAction: async (action) => {
        await handleWidgetAction(action);
      },
    },
  });

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
      console.log('[ChatKit] DOM scan, text length:', allText.length, 'has ACTIONS_JSON:', allText.includes('ACTIONS_JSON'));
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
  }, [scanContainerForActions]);

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
      console.warn('[ChatKit] workflow_context_update failed:', err);
    });
  }, [activeThreadId, chatkit, steps]);

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
    <div ref={containerRef} className={className} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {parsedPreview && (
        <div style={{ margin: '8px 8px 0', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 12, background: 'rgba(15,23,42,0.35)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(148,163,184,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' }}>
                Actions JSON
              </div>
              {!!parsedPreview.summary && (
                <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.45, color: '#e2e8f0' }}>
                  {cleanSummaryText(parsedPreview.summary)}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {!!parsedPreview.actions.length && !autoApplyRef.current && (
                <button
                  type="button"
                  onClick={() => { void applyParsedPreview(); }}
                  disabled={applyingPreview}
                  style={{ fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.45)', background: applyingPreview ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.18)', color: '#bbf7d0', cursor: applyingPreview ? 'default' : 'pointer', fontWeight: 700 }}
                >
                  {applyingPreview ? 'Applying...' : 'Apply to Flow'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setParsedPreview(null)}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.25)', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
              >
                Hide
              </button>
            </div>
          </div>
          <div style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(6,182,212,0.14)', color: '#67e8f9' }}>
                {parsedPreview.actions.length} {parsedPreview.actions.length === 1 ? 'change' : 'changes'}
              </span>
              {!!parsedPreview.findings.length && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(245,158,11,0.14)', color: '#fcd34d' }}>
                  {parsedPreview.findings.length} finding{parsedPreview.findings.length === 1 ? '' : 's'}
                </span>
              )}
              {!!parsedPreview.suggestedFixes.length && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.14)', color: '#86efac' }}>
                  {parsedPreview.suggestedFixes.length} suggestion{parsedPreview.suggestedFixes.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {parsedPreview.actions.slice(0, 6).map((action, index) => (
                <div key={`${action.id || 'action'}-${index}`} style={{ fontSize: 12, lineHeight: 1.45, color: '#cbd5e1' }}>
                  - {action.action_type.replace(/_/g, ' ')}
                </div>
              ))}
              {parsedPreview.actions.length > 6 && (
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  + {parsedPreview.actions.length - 6} more
                </div>
              )}
            </div>
            <details style={{ border: '1px solid rgba(148,163,184,0.18)', borderRadius: 10, overflow: 'hidden', background: 'rgba(2,6,23,0.5)' }}>
              <summary style={{ cursor: 'pointer', padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>
                Raw JSON
              </summary>
              <pre style={{ margin: 0, padding: 12, overflowX: 'auto', fontSize: 11, lineHeight: 1.45, color: '#e2e8f0', borderTop: '1px solid rgba(148,163,184,0.18)' }}>
                <code>{parsedPreview.rawJson}</code>
              </pre>
            </details>
          </div>
        </div>
      )}
      <ChatKit control={chatkit.control} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default OpenAiChatKitPanel;
