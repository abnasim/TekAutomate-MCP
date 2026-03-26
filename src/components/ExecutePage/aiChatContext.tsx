import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { AiChatState } from './aiChatReducer';
import { aiChatReducer, initialAiChatState } from './aiChatReducer';
import type { TekMode } from './aiChatReducer';

interface AiChatContextValue {
  state: ReturnType<typeof useAiChatState>['state'];
  dispatch: ReturnType<typeof useAiChatState>['dispatch'];
}

const AI_CHAT_STATE_STORAGE = 'tekautomate.ai.chat.state';

function loadInitialAiChatState(): AiChatState {
  if (typeof window === 'undefined') return initialAiChatState;
  try {
    const raw = window.localStorage.getItem(AI_CHAT_STATE_STORAGE);
    if (!raw) return initialAiChatState;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawToolCallMode = parsed.toolCallMode;
    const parsedToolCallMode = rawToolCallMode === true || rawToolCallMode === 'true';
    const parsedHistory = Array.isArray(parsed.history) ? (parsed.history as any[]).slice(-12) : [];
    const lastAssistantTurn = [...parsedHistory]
      .reverse()
      .find((turn) => turn && typeof turn === 'object' && turn.role === 'assistant') as
      | { routedVia?: string; streaming?: boolean }
      | undefined;

    // Load per-provider keys from dedicated storage
    const openaiKey = (() => { try { return window.localStorage.getItem('tekautomate.ai.byok.api_key.openai') || ''; } catch { return ''; } })();
    const anthropicKey = (() => { try { return window.localStorage.getItem('tekautomate.ai.byok.api_key.anthropic') || ''; } catch { return ''; } })();
    const activeProvider = parsed.provider === 'anthropic' ? 'anthropic' as const : 'openai' as const;
    const activeKey = activeProvider === 'openai' ? openaiKey : anthropicKey;
    const hasAnyKey = openaiKey.length > 0 || anthropicKey.length > 0;

    // Migrate old mode values to tekMode
    let tekMode: TekMode = 'mcp';
    if (typeof parsed.tekMode === 'string' && ['mcp', 'ai', 'live'].includes(parsed.tekMode)) {
      tekMode = parsed.tekMode as TekMode;
    } else {
      // Migrate from old mode+interactionMode
      const oldMode = parsed.mode;
      const oldInteraction = parsed.interactionMode;
      if (oldMode === 'mcp_only') {
        tekMode = 'mcp';
      } else if (oldInteraction === 'live') {
        tekMode = 'live';
      } else if (oldInteraction === 'chat') {
        tekMode = 'ai';
      } else {
        tekMode = hasAnyKey ? 'ai' : 'mcp';
      }
    }

    const canRestoreOpenAiThreadId =
      activeProvider !== 'anthropic' &&
      tekMode === 'ai' &&
      parsedHistory.length > 0 &&
      lastAssistantTurn?.routedVia === 'assistant' &&
      lastAssistantTurn?.streaming !== true;

    return {
      ...initialAiChatState,
      history: parsedHistory,
      tekMode,
      provider: activeProvider,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : initialAiChatState.model,
      apiKey: activeKey,
      openaiApiKey: openaiKey,
      anthropicApiKey: anthropicKey,
      routingStrategy: (activeProvider === 'anthropic' ? initialAiChatState.routingStrategy : 'assistant'),
      openaiAssistantId: typeof parsed.openaiAssistantId === 'string' ? parsed.openaiAssistantId : '',
      openaiThreadId:
        canRestoreOpenAiThreadId && typeof parsed.openaiThreadId === 'string' ? parsed.openaiThreadId : '',
      toolCallMode: parsedToolCallMode,
      isLoading: false,
      error: null,
    };
  } catch {
    return initialAiChatState;
  }
}

function useAiChatState() {
  const [state, dispatch] = useReducer(aiChatReducer, initialAiChatState, loadInitialAiChatState);

  useEffect(() => {
    try {
      // Save per-provider keys to dedicated storage keys
      if (state.openaiApiKey.trim()) {
        window.localStorage.setItem('tekautomate.ai.byok.api_key.openai', state.openaiApiKey);
      } else {
        window.localStorage.removeItem('tekautomate.ai.byok.api_key.openai');
      }
      if (state.anthropicApiKey.trim()) {
        window.localStorage.setItem('tekautomate.ai.byok.api_key.anthropic', state.anthropicApiKey);
      } else {
        window.localStorage.removeItem('tekautomate.ai.byok.api_key.anthropic');
      }
      // Save general state (no apiKey — keys are in dedicated storage)
      window.localStorage.setItem(
        AI_CHAT_STATE_STORAGE,
        JSON.stringify({
          history: state.history,
          tekMode: state.tekMode,
          provider: state.provider,
          model: state.model,
          routingStrategy: state.routingStrategy,
          openaiAssistantId: state.openaiAssistantId,
          openaiThreadId: state.openaiThreadId,
          toolCallMode: state.toolCallMode,
        })
      );
    } catch {
      // Ignore storage failures.
    }
  }, [state]);

  return { state, dispatch };
}

const AiChatContext = createContext<AiChatContextValue | undefined>(undefined);

export function AiChatProvider({ children }: { children: React.ReactNode }) {
  const value = useAiChatState();
  const memo = useMemo(() => value, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <AiChatContext.Provider value={memo}>{children}</AiChatContext.Provider>;
}

export function useAiChatContext() {
  const context = useContext(AiChatContext);
  if (!context) {
    throw new Error('useAiChatContext must be used inside AiChatProvider');
  }
  return context;
}
