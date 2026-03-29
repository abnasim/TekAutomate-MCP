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
  if (!input.commands?.length) {
    return { ok: false, data: { error: 'NO_COMMANDS' }, sourceMeta: [], warnings: ['No commands provided. Pass commands:["CH1:SCAle?"] array.'] };
  }
  if (!input.executorUrl) {
    return { ok: false, data: { error: 'NO_INSTRUMENT', message: 'No instrument connected. Connect to a scope via the Execute page first.' }, sourceMeta: [], warnings: ['No executorUrl — instrument not connected.'] };
  }
  if (!input.liveMode) {
    return { ok: false, data: { error: 'NOT_LIVE', message: 'liveMode must be true to send SCPI commands.' }, sourceMeta: [], warnings: ['liveMode is not enabled.'] };
  }
  return sendScpiProxy(input, input.commands, input.timeoutMs);
}
