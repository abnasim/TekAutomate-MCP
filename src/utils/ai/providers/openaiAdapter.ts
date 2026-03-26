import type { AiProviderAdapter } from './types';
import type { ProviderStreamCallbacks, ProviderStreamInput } from './types';

async function streamSse(
  res: Response,
  onEvent: (payload: string) => void
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
      const lines = part.split('\n').filter((l) => l.startsWith('data:'));
      for (const line of lines) {
        const payload = line.replace(/^data:\s?/, '').trim();
        if (!payload || payload === '[DONE]') continue;
        onEvent(payload);
      }
    }
  }
}

export const openaiAdapter: AiProviderAdapter = {
  provider: 'openai',
  async streamResponse(input: ProviderStreamInput, callbacks: ProviderStreamCallbacks): Promise<void> {
    const { apiKey, model, systemPrompt, userPrompt } = input;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }

    await streamSse(res, (payload) => {
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) callbacks.onChunk(chunk);
      } catch {
        // Ignore non-JSON chunks.
      }
    });

    callbacks.onDone?.();
  },
};
