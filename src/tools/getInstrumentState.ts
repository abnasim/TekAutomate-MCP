import { getInstrumentStateProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  executorUrl: string;
  visaResource: string;
  backend: string;
}

export async function getInstrumentState(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return getInstrumentStateProxy(input);
}
