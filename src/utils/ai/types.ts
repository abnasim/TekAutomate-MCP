import type { AiAction } from '../aiActions';

export type RagCorpus = 'scpi' | 'tmdevices' | 'app_logic' | 'templates' | 'errors' | 'pyvisa_tekhsi';

export interface RagChunk {
  id: string;
  corpus: RagCorpus;
  title: string;
  body: string;
  tags?: string[];
  source?: string;
  pathHint?: string;
}

export interface RagManifest {
  version: string;
  generatedAt: string;
  corpora: Partial<Record<RagCorpus, string>>;
  counts?: Partial<Record<RagCorpus, number>>;
}

export interface RetrievalPlan {
  corpora: RagCorpus[];
  reasons: string[];
}

export interface AssembledContext {
  systemPrompt: string;
  userPrompt: string;
  debug?: {
    corpora: RagCorpus[];
    retrievedChunkIds: string[];
    approxTokens: number;
    timings?: {
      clientMs?: number;
      serverTotalMs?: number;
      toolMs?: number;
      modelMs?: number;
      toolCalls?: number;
      iterations?: number;
      usedShortcut?: boolean;
      promptChars?: {
        system: number;
        user: number;
      };
    };
  };
}

export type AiProvider = 'openai' | 'anthropic';
export type AiRoutingStrategy = 'direct' | 'assistant' | 'auto';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  tekMode?: 'mcp' | 'ai' | 'live';
  /** @deprecated Use tekMode instead */
  interactionMode?: 'build' | 'chat' | 'live';
  streaming?: boolean;
  routedVia?: 'assistant' | 'direct';
  isStandaloneQuickAction?: boolean;
  actions?: AiAction[];
  appliedActionIds?: string[];
  summary?: string;
  findings?: string[];
  suggestedFixes?: string[];
  confidence?: 'low' | 'medium' | 'high';
  appliedAt?: number;
  noOpAt?: number;
}

export type AiToolCallMode = boolean;

export interface PredefinedAction {
  id: string;
  label: string;
  promptTemplate: string;
  corporaHint?: RagCorpus[];
}
