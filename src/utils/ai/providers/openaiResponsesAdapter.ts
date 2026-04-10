import type { AssembledContext, ChatTurn } from '../types';
import { trimConversationHistory } from '../historyTrim';
import { resolveMcpHost } from '../mcpClient';

export class OpenAiResponsesAdapter {
  private apiKey: string;
  private model: string;
  /** @deprecated vectorStoreId is now managed server-side via COMMAND_VECTOR_STORE_ID env var */
  private vectorStoreId: string;

  constructor(apiKey: string, model: string, vectorStoreId: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o';
    this.vectorStoreId = vectorStoreId;
  }

  async streamResponse(
    context: AssembledContext,
    history: ChatTurn[],
    onChunk: (chunk: string) => void
  ): Promise<void> {
    // Keep only the most recent conversational turns so requests do not grow unbounded.
    const historyInput = trimConversationHistory(history).map((turn) => ({
      role: turn.role as 'user' | 'assistant',
      content: turn.content,
    }));

    const input: Array<{ role: string; content: string }> = [
      { role: 'system', content: context.systemPrompt },
      ...historyInput,
      { role: 'user', content: context.userPrompt },
    ];

    // Route through MCP proxy so the server key (which owns the vector store) is used.
    // Falls back to direct OpenAI call only if no MCP host is available AND a
    // user-supplied vectorStoreId is present (legacy/dev mode).
    const mcpHost =
      (typeof process !== 'undefined' && process.env?.REACT_APP_MCP_HOST) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('tekautomate.mcp.host')) ||
      resolveMcpHost();

    // Always try MCP proxy first — it uses OPENAI_SERVER_API_KEY + COMMAND_VECTOR_STORE_ID
    const proxyUrl = `${mcpHost.replace(/\/$/, '')}/ai/responses-proxy`;

    const proxyBody: Record<string, unknown> = {
      apiKey: this.apiKey,   // passed for auth/logging; OpenAI call uses server key
      model: this.model,
      input,
    };

    let usedProxy = false;
    let res: Response | null = null;

    try {
      res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyBody),
      });
      if (res.ok) {
        usedProxy = true;
      } else {
        const errText = await res.text();
        // If server not configured, fall through to direct call
        if (res.status === 500 && errText.includes('OPENAI_SERVER_API_KEY not configured')) {
          usedProxy = false;
          res = null;
        } else {
          throw new Error(`MCP proxy error ${res.status}: ${errText}`);
        }
      }
    } catch (e) {
      // MCP server not reachable — fall back to direct if we have a vectorStoreId
      usedProxy = false;
      res = null;
    }

    if (!usedProxy) {
      // Legacy fallback: direct call with user key + user-supplied vectorStoreId
      const body: Record<string, unknown> = {
        model: this.model,
        input,
        stream: true,
      };
      if (this.vectorStoreId) {
        body.tools = [
          {
            type: 'file_search',
            vector_store_ids: [this.vectorStoreId],
          },
        ];
      }
      res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'responses=v1',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI Responses API error ${res.status}: ${err}`);
      }
    }

    if (!res) throw new Error('No response from OpenAI Responses API');

    // Parse SSE stream from Responses API
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in buffer
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.replace('event:', '').trim();
        } else if (line.startsWith('data:')) {
          const data = line.replace('data:', '').trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as {
              type?: string;
              delta?: string;
            };
            // Handle both event-header style and inline type field
            const isTextDelta =
              currentEvent === 'response.output_text.delta' ||
              parsed.type === 'response.output_text.delta';
            if (isTextDelta && parsed.delta) {
              onChunk(parsed.delta);
            }
          } catch {
            // Skip malformed JSON events
          }
        } else if (line === '') {
          // Blank line resets the event type (SSE message boundary)
          currentEvent = '';
        }
      }
    }
  }
}
