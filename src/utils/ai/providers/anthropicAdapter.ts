import type { AiProviderAdapter } from './types';
import type { ProviderStreamCallbacks, ProviderStreamInput } from './types';

async function streamSse(
  res: Response,
  onEvent: (event: string, payload: string) => void
): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const eventMatch = part.match(/^event:\s*(.+)$/m);
      const event = eventMatch?.[1]?.trim() || '';
      const dataLines = part
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.replace(/^data:\s?/, '').trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join('\n');
      onEvent(event, payload);
    }
  }
}

export const anthropicAdapter: AiProviderAdapter = {
  provider: 'anthropic',
  async streamResponse(input: ProviderStreamInput, callbacks: ProviderStreamCallbacks): Promise<void> {
    const { apiKey, model, systemPrompt, userPrompt } = input;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0.1,
        system: systemPrompt,
        stream: true,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${text}`);
    }

    await streamSse(res, (event, payload) => {
      if (event === 'message_stop') return;
      try {
        const json = JSON.parse(payload) as {
          type?: string;
          delta?: { text?: string };
        };
        const chunk =
          json.type === 'content_block_delta' ? json.delta?.text : undefined;
        if (chunk) callbacks.onChunk(chunk);
      } catch {
        // Ignore malformed events.
      }
    });

    callbacks.onDone?.();
  },
};

