import { probeCommandProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  command: string;
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
}

export async function probeCommand(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return probeCommandProxy(input, input.command);
}
