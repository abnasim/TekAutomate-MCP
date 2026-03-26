import { getInstrumentStateProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
}

export async function getInstrumentState(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return getInstrumentStateProxy(input);
}
