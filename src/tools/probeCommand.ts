import { probeCommandProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  command: string;
  executorUrl: string;
  visaResource: string;
  backend: string;
}

export async function probeCommand(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return probeCommandProxy(input, input.command);
}
