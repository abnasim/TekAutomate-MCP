export interface TrimmedHistoryTurn {
  role: string;
  content: string;
}

export const DEFAULT_HISTORY_TURNS = 5;
const MAX_TURN_CONTENT_CHARS = 3000;
const FOLLOW_UP_MESSAGE_RE =
  /^(?:yes|yeah|yep|yup|ok|okay|sure|please do|do it|go ahead|sounds good|works for me|apply it|apply that|try it|try that|do that|yes do that)\b/i;

function normalizeTurnContent(content: unknown, maxChars: number): string {
  return String(content || '').slice(0, maxChars);
}

export function trimConversationHistory<T extends { role: string; content?: unknown }>(
  history: T[] | undefined,
  maxTurns = DEFAULT_HISTORY_TURNS,
  maxCharsPerTurn = MAX_TURN_CONTENT_CHARS
): TrimmedHistoryTurn[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  const maxMessages = Math.max(1, maxTurns) * 2;
  return history
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-maxMessages)
    .map((turn) => ({
      role: turn.role,
      content: normalizeTurnContent(turn.content, maxCharsPerTurn),
    }));
}

function getLastAssistantTurn<T extends { role: string; content?: unknown }>(
  history: T[] | undefined,
  maxCharsPerTurn: number
): TrimmedHistoryTurn | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn.role === 'assistant') {
      return {
        role: 'assistant',
        content: normalizeTurnContent(turn.content, maxCharsPerTurn),
      };
    }
  }
  return null;
}

export function looksLikeFollowUpMessage(message: string | undefined): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  if (FOLLOW_UP_MESSAGE_RE.test(text)) return true;
  return /^(?:continue|keep going|same for this|same thing|and that|instead|now do that)\b/i.test(text);
}

export function buildRequestHistory<T extends { role: string; content?: unknown }>(
  history: T[] | undefined,
  currentUserMessage: string | undefined,
  maxCharsPerTurn = MAX_TURN_CONTENT_CHARS
): TrimmedHistoryTurn[] {
  if (!looksLikeFollowUpMessage(currentUserMessage)) return [];
  const lastAssistant = getLastAssistantTurn(history, maxCharsPerTurn);
  return lastAssistant ? [lastAssistant] : [];
}
