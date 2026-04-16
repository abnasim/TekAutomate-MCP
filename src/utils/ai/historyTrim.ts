export interface TrimmedHistoryTurn {
  role: string;
  content: string;
}

export const DEFAULT_HISTORY_TURNS = 3;
const MAX_TURN_CONTENT_CHARS = 3000;

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
