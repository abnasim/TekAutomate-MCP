import type { AiAction } from '../../utils/aiActions';
import type { AiProvider, AiRoutingStrategy, ChatTurn } from '../../utils/ai/types';

/** Three clean modes — no more confusing mcp_only/mcp_ai × build/chat/live combos */
export type TekMode = 'mcp' | 'ai' | 'live';

// Keep legacy types as aliases for server-facing code that still references them
export type AiOperatingMode = 'mcp_only' | 'mcp_ai';
export type AiInteractionMode = 'build' | 'chat' | 'live';

export interface AiChatState {
  history: ChatTurn[];
  tekMode: TekMode;
  /** Per-mode chat sessions — preserved across mode switches */
  modeHistories: Record<TekMode, ChatTurn[]>;
  modeThreadIds: Record<TekMode, string>;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  provider: AiProvider;
  model: string;
  routingStrategy: AiRoutingStrategy;
  openaiAssistantId: string;
  openaiThreadId: string;
  toolCallMode: boolean;
  isLoading: boolean;
  error: string | null;
}

export type AiChatAction =
  | { type: 'ADD_TURN'; turn: ChatTurn }
  | { type: 'STREAM_START'; tekMode: TekMode }
  | { type: 'STREAM_CHUNK'; chunk: string }
  | {
      type: 'STREAM_DONE';
      routedVia?: 'assistant' | 'direct';
      openaiThreadId?: string;
      actions?: AiAction[];
      parsed?: Partial<Pick<ChatTurn, 'summary' | 'findings' | 'suggestedFixes' | 'confidence'>>;
    }
  | { type: 'SET_TEK_MODE'; tekMode: TekMode }
  | { type: 'SET_KEY'; key: string }
  | { type: 'SET_OPENAI_KEY'; key: string }
  | { type: 'SET_ANTHROPIC_KEY'; key: string }
  | { type: 'SET_PROVIDER'; provider: AiProvider; model: string }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_ROUTING_STRATEGY'; value: AiRoutingStrategy }
  | { type: 'SET_OPENAI_ASSISTANT_ID'; value: string }
  | { type: 'SET_OPENAI_THREAD_ID'; value: string }
  | { type: 'SET_TOOL_CALL_MODE'; value: boolean }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'MARK_APPLIED'; turnIndex: number; actionIds?: string[] }
  | { type: 'MARK_NOOP'; turnIndex: number }
  | { type: 'CLEAR' };

const DEFAULT_MODEL_BY_PROVIDER: Record<AiProvider, string> = {
  openai: 'gpt-5.4-nano',
  anthropic: 'claude-sonnet-4-6',
};

export const initialAiChatState: AiChatState = {
  history: [],
  tekMode: 'mcp',
  modeHistories: { mcp: [], ai: [], live: [] },
  modeThreadIds: { mcp: '', ai: '', live: '' },
  apiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  provider: 'openai',
  model: DEFAULT_MODEL_BY_PROVIDER.openai,
  routingStrategy: 'assistant',
  openaiAssistantId: '',
  openaiThreadId: '',
  toolCallMode: false,
  isLoading: false,
  error: null,
};

export function aiChatReducer(state: AiChatState, action: AiChatAction): AiChatState {
  switch (action.type) {
    case 'ADD_TURN':
      return {
        ...state,
        history: [...state.history, action.turn],
        error: null,
      };
    case 'STREAM_START':
      return {
        ...state,
        history: [
          ...state.history,
          {
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            tekMode: action.tekMode,
            streaming: true,
          },
        ],
        isLoading: true,
        error: null,
      };
    case 'STREAM_CHUNK': {
      const history = [...state.history];
      for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].role === 'assistant' && history[i].streaming) {
          history[i] = {
            ...history[i],
            content: `${history[i].content}${action.chunk}`,
          };
          break;
        }
      }
      return { ...state, history };
    }
    case 'STREAM_DONE': {
      const history = [...state.history];
      for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].role === 'assistant' && history[i].streaming) {
          history[i] = {
            ...history[i],
            streaming: false,
            routedVia: action.routedVia,
            actions: action.actions,
            summary: action.parsed?.summary,
            findings: action.parsed?.findings,
            suggestedFixes: action.parsed?.suggestedFixes,
            confidence: action.parsed?.confidence,
          };
          break;
        }
      }
      return {
        ...state,
        history,
        isLoading: false,
        openaiThreadId:
          action.routedVia === 'assistant' && action.openaiThreadId
            ? action.openaiThreadId
            : state.openaiThreadId,
      };
    }

    // ── Mode switching — preserve per-mode chat sessions ──
    case 'SET_TEK_MODE': {
      // Save current mode's history before switching
      const savedHistories = {
        ...state.modeHistories,
        [state.tekMode]: state.history,
      };
      const savedThreadIds = {
        ...state.modeThreadIds,
        [state.tekMode]: state.openaiThreadId,
      };
      return {
        ...state,
        tekMode: action.tekMode,
        modeHistories: savedHistories,
        modeThreadIds: savedThreadIds,
        // Restore target mode's history
        history: savedHistories[action.tekMode] || [],
        openaiThreadId: savedThreadIds[action.tekMode] || '',
        toolCallMode: action.tekMode === 'mcp' ? false : state.toolCallMode,
        error: null,
        isLoading: false,
      };
    }

    // ── Key management ──
    case 'SET_KEY': {
      const hasKey = typeof action.key === 'string' && action.key.trim().length > 0;
      const isOpenai = state.provider === 'openai';
      return {
        ...state,
        apiKey: action.key,
        openaiApiKey: isOpenai ? action.key : state.openaiApiKey,
        anthropicApiKey: !isOpenai ? action.key : state.anthropicApiKey,
        tekMode: hasKey && state.tekMode === 'mcp' ? 'ai' : state.tekMode,
      };
    }
    case 'SET_OPENAI_KEY':
      return {
        ...state,
        openaiApiKey: action.key,
        apiKey: state.provider === 'openai' ? action.key : state.apiKey,
        tekMode: action.key.trim() && state.tekMode === 'mcp' ? 'ai' : state.tekMode,
      };
    case 'SET_ANTHROPIC_KEY':
      return {
        ...state,
        anthropicApiKey: action.key,
        apiKey: state.provider === 'anthropic' ? action.key : state.apiKey,
        tekMode: action.key.trim() && state.tekMode === 'mcp' ? 'ai' : state.tekMode,
      };

    // ── Provider ──
    case 'SET_PROVIDER':
      return {
        ...state,
        provider: action.provider,
        model: action.model || DEFAULT_MODEL_BY_PROVIDER[action.provider],
        apiKey: action.provider === 'openai' ? state.openaiApiKey : state.anthropicApiKey,
        routingStrategy: action.provider === 'openai' ? 'assistant' : state.routingStrategy,
        openaiThreadId: '',
      };
    case 'SET_MODEL':
      return { ...state, model: action.model };
    case 'SET_ROUTING_STRATEGY':
      return {
        ...state,
        routingStrategy: action.value,
        openaiThreadId: action.value === 'assistant' || action.value === 'auto' ? state.openaiThreadId : '',
      };
    case 'SET_OPENAI_ASSISTANT_ID':
      return { ...state, openaiAssistantId: action.value };
    case 'SET_OPENAI_THREAD_ID':
      return { ...state, openaiThreadId: action.value };
    case 'SET_TOOL_CALL_MODE':
      return { ...state, toolCallMode: action.value };
    case 'SET_LOADING':
      return { ...state, isLoading: action.loading };
    case 'SET_ERROR':
      return { ...state, error: action.error, isLoading: false };
    case 'MARK_APPLIED':
      return {
        ...state,
        history: state.history.map((turn, idx) =>
          idx === action.turnIndex
            ? {
                ...turn,
                appliedAt:
                  !action.actionIds ||
                  action.actionIds.length === 0 ||
                  (turn.actions?.length || 0) <= action.actionIds.length
                    ? Date.now()
                    : turn.appliedAt,
                appliedActionIds: Array.from(
                  new Set([...(turn.appliedActionIds || []), ...(action.actionIds || [])])
                ),
              }
            : turn
        ),
      };
    case 'MARK_NOOP':
      return {
        ...state,
        history: state.history.map((turn, idx) =>
          idx === action.turnIndex
            ? { ...turn, noOpAt: Date.now() }
            : turn
        ),
      };
    case 'CLEAR':
      return {
        ...state,
        history: [],
        openaiThreadId: '',
        modeHistories: {
          ...state.modeHistories,
          [state.tekMode]: [],
        },
        modeThreadIds: {
          ...state.modeThreadIds,
          [state.tekMode]: '',
        },
        error: null,
        isLoading: false,
      };
    default:
      return state;
  }
}
