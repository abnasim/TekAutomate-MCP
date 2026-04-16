import type { AiProvider } from '../types';

export interface ProviderStreamInput {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface ProviderStreamCallbacks {
  onChunk: (chunk: string) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export interface AiProviderAdapter {
  provider: AiProvider;
  streamResponse: (input: ProviderStreamInput, callbacks: ProviderStreamCallbacks) => Promise<void>;
}

