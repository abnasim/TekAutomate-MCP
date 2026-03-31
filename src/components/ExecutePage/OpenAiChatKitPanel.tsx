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

import React, { useCallback, useEffect, useRef } from 'react';
import { ChatKit, useChatKit } from '@openai/chatkit-react';
import { parseAiActionResponse, type AiAction } from '../../utils/aiActions';
import { resolveMcpHost } from '../../utils/ai/mcpClient';
import { buildWorkflowContext } from '../../utils/ai/liveToolLoop';
import type { StepPreview } from './StepsListPreview';

// ── Storage keys ──
const CHATKIT_WORKFLOW_ID_KEY = 'tekautomate.chatkit.workflow_id';
const CHATKIT_THREAD_KEY = 'tekautomate.chatkit.thread_id';
const DEFAULT_WORKFLOW_ID = 'wf_69cb9085f72c8190ae05b360552d6987032b7c148cd57c24';

interface OpenAiChatKitPanelProps {
  apiKey: string;
  steps: StepPreview[];
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    deviceDriver?: string;
    validationErrors?: unknown[];
    selectedStep?: { id?: string };
  };
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

export function OpenAiChatKitPanel({
  apiKey,
  steps,
  flowContext,
  onActionsDetected,
  onThreadChange,
  className,
}: OpenAiChatKitPanelProps) {
  const onActionsRef = useRef(onActionsDetected);
  onActionsRef.current = onActionsDetected;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const flowContextRef = useRef(flowContext);
  flowContextRef.current = flowContext;

  // ── Session creation ──
  // Calls our MCP server's /chatkit/session endpoint which proxies to OpenAI
  const getClientSecret = useCallback(
    async (_currentSecret: string | null): Promise<string> => {
      const workflowId = getWorkflowId();
      if (!workflowId) {
        throw new Error(
          'ChatKit workflow ID not configured. Set it in AI Chat settings (localStorage key: tekautomate.chatkit.workflow_id).',
        );
      }

      const mcpHost = resolveMcpHost();
      const res = await fetch(`${mcpHost.replace(/\/$/, '')}/chatkit/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          workflowId,
          userId: 'tekautomate-user',
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`ChatKit session failed: ${err}`);
      }
      const data = (await res.json()) as { clientSecret?: string };
      if (!data.clientSecret) {
        throw new Error('ChatKit session returned no client_secret.');
      }
      return data.clientSecret;
    },
    [apiKey],
  );

  // ── Response interception — parse ACTIONS_JSON from assistant messages ──
  const handleResponseEnd = useCallback(() => {
    // ChatKit doesn't give us the response text directly in onResponseEnd.
    // We rely on DOM scraping or the thread's last message to extract ACTIONS_JSON.
    // For now, we use a MutationObserver approach in the effect below.
  }, []);

  // ── Thread change — persist conversation ID ──
  const handleThreadChange = useCallback(
    (threadId: string) => {
      setStoredThreadId(threadId);
      onThreadChange?.(threadId);
    },
    [onThreadChange],
  );

  // ── ChatKit hook ──
  // useChatKit returns { control, sendUserMessage, setThreadId, sendCustomAction, ... }
  const chatkit = useChatKit({
    api: { getClientSecret },
    initialThread: getStoredThreadId() || null,
    onResponseEnd: handleResponseEnd,
    onThreadChange: (detail: { threadId: string | null }) => {
      if (detail.threadId) {
        setStoredThreadId(detail.threadId);
        onThreadChange?.(detail.threadId);
      }
    },
    // Client-side tool execution — ChatKit invokes this when the agent calls
    // a tool marked as "client tool". For MCP tools connected via Option B
    // (function definitions in Agent Builder), we execute them against the MCP server.
    onClientTool: async ({ name, params }: { name: string; params: Record<string, unknown> }) => {
      try {
        const mcpHost = resolveMcpHost();
        const res = await fetch(`${mcpHost.replace(/\/$/, '')}/tools/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, args: params }),
        });
        if (!res.ok) {
          const errText = await res.text();
          return { error: `Tool ${name} failed: ${errText}` };
        }
        return await res.json();
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

  // ── DOM observer for ACTIONS_JSON extraction ──
  // ChatKit doesn't expose raw message text in events (confirmed by API docs).
  // We watch for DOM changes and scan for ACTIONS_JSON blocks in rendered content.
  const containerRef = useRef<HTMLDivElement>(null);
  const lastProcessedRef = useRef('');
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scanForActions = () => {
      const chatKitEl = container.querySelector('openai-chatkit');
      const root = chatKitEl?.shadowRoot || container;

      const allText = root.textContent || '';
      if (allText === lastProcessedRef.current) return;
      lastProcessedRef.current = allText;

      // Match ACTIONS_JSON — both fenced and raw
      const jsonMatch = allText.match(/```json\s*(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\})\s*```/)
        || allText.match(/(\{"summary"[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\})/);
      if (jsonMatch) {
        const parsed = parseAiActionResponse(jsonMatch[1]);
        if (parsed?.actions?.length) {
          onActionsRef.current?.(parsed.actions, parsed.summary);
        }
      }
    };

    const observer = new MutationObserver(() => {
      // Debounce to batch rapid DOM updates during streaming
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      scanTimerRef.current = setTimeout(scanForActions, 500);
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, []);

  // ── Inject workflow context when steps change ──
  // Send as a custom action so the agent receives updated context
  useEffect(() => {
    if (!stepsRef.current?.length) return;

    const ctx = buildWorkflowContext(
      stepsRef.current as any[],
      flowContextRef.current?.validationErrors as string[] | undefined,
      flowContextRef.current?.selectedStep?.id,
    );

    if (ctx && chatkit.sendCustomAction) {
      void chatkit.sendCustomAction({
        type: 'workflow_context_update',
        payload: { context: ctx },
      });
    }
  }, [chatkit, steps]);

  return (
    <div ref={containerRef} className={className} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ChatKit control={chatkit.control} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default OpenAiChatKitPanel;
