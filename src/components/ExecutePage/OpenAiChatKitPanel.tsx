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
  autoApply?: boolean;
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    deviceDriver?: string;
    validationErrors?: unknown[];
    selectedStep?: { id?: string };
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

export function OpenAiChatKitPanel({
  apiKey,
  steps,
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

  const extractActionsPreview = useCallback((text: string): ParsedActionsPreview | null => {
    const rawJson =
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
      summary: parsed.summary || '',
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
    if (!preview) return;
    if (preview.rawJson === lastParsedJsonRef.current) return;
    lastParsedJsonRef.current = preview.rawJson;
    setParsedPreview(preview);
    scrubRenderedActionsJson();
    if (autoApplyRef.current) {
      onActionsRef.current?.(preview.actions, preview.summary);
    }
  }, [extractActionsPreview, scrubRenderedActionsJson]);

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
    },
    // ── Response end — scan for ACTIONS_JSON and auto-apply ──
    onResponseEnd: () => {
      // Wait for ChatKit to finish rendering, then scan for ACTIONS_JSON
      setTimeout(() => {
        const container = containerRef.current;
        if (!container) return;
        const chatKitEl = container.querySelector('openai-chatkit');
        // Try every text source available
        const text = [
          chatKitEl?.textContent || '',
          chatKitEl?.innerHTML || '',
          container.textContent || '',
          container.innerHTML || '',
        ].join('\n');
        console.log('[ChatKit] onResponseEnd scan, length:', text.length, 'has ACTIONS_JSON:', text.includes('ACTIONS_JSON'));
        if (!text.includes('ACTIONS_JSON')) return;
        captureActionsPreview(text);
      }, 800); // Wait for render
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
      console.log('[ChatKit] Widget action:', detail.type, detail.payload);

      if (detail.type === 'flow.apply' && detail.payload?.actions) {
        const rawActions = detail.payload.actions;
        const actions = Array.isArray(rawActions) ? rawActions : [];
        if (actions.length) {
          const parsed = parseAiActionResponse(JSON.stringify({
            actions,
            summary: typeof detail.payload.summary === 'string' ? detail.payload.summary : '',
          }));
          if (parsed?.actions?.length) {
            onActionsRef.current?.(parsed.actions, parsed.summary);
          } else {
            onActionsRef.current?.(actions as AiAction[], String(detail.payload.summary || ''));
          }
        }
      } else if (detail.type === 'flow.addStep' && detail.payload?.command) {
        const step = {
          type: 'insert_step_after' as const,
          action_type: 'insert_step_after' as const,
          targetStepId: null,
          payload: {
            newStep: {
              type: 'write',
              label: String(detail.payload.command),
              params: { command: String(detail.payload.command) },
            },
          },
        };
        onActionsRef.current?.([step as unknown as AiAction]);
      } else if (detail.type === 'flow.dismiss') {
        console.log('[ChatKit] User dismissed flow actions');
      }
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
  }, []);

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

      const jsonMatch =
        allText.match(/```json\s*(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\})\s*```/)           // fenced ```json ... ```
        || allText.match(/ACTIONS_JSON:\s*(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\})/) // ACTIONS_JSON: { ... }
        || allText.match(/(\{"summary"[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\})/);       // raw { "summary"... }
      if (jsonMatch) {
        captureActionsPreview(jsonMatch[1]);
      }
    };

    const observer = new MutationObserver(() => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(scanForActions, 500);
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [captureActionsPreview]);

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
                  {parsedPreview.summary}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setParsedPreview(null)}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.25)', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
            >
              Hide
            </button>
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
