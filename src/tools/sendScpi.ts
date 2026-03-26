import { sendScpiProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  commands: string[];
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
  timeoutMs?: number;
}

export async function sendScpi(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  return sendScpiProxy(input, input.commands, input.timeoutMs);
}
