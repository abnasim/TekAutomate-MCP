import { sendScpiProxy } from '../core/instrumentProxy';
import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface Input {
  commands: string[];
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: 'clean' | 'verbose';
  timeoutMs?: number;
  modelFamily?: string;
  /** Set by discover_scpi to bypass the verify gate. */
  _bypassVerifyGate?: boolean;
}

/**
 * Server-side SCPI verify gate.
 * Uses getByHeader() for fast local lookup (~1ms per command).
 * Star commands (*IDN?, *RST, etc.) are universal and always pass.
 */
async function verifyCommandsLocally(
  commands: string[],
  modelFamily?: string
): Promise<Array<{ command: string; reason: string }>> {
  const failures: Array<{ command: string; reason: string }> = [];
  let index: Awaited<ReturnType<typeof getCommandIndex>>;
  try {
    index = await getCommandIndex();
  } catch {
    return []; // Index unavailable — allow through
  }

  for (const cmd of commands) {
    const trimmed = String(cmd).trim();
    if (trimmed.startsWith('*')) continue;
    const headerPart = trimmed.split(/\s/)[0].replace(/\?$/, '');
    if (!headerPart) continue;

    const entry =
      index.getByHeader(headerPart, modelFamily) ||
      index.getByHeader(headerPart.toUpperCase(), modelFamily) ||
      index.getByHeaderPrefix(headerPart, modelFamily);

    if (!entry) {
      failures.push({
        command: trimmed,
        reason: `Unverified: "${headerPart}" not found in command index. Use tek_router to find the correct command.`,
      });
    }
  }
  return failures;
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

  // ── Normalize commands — split semicolon-concatenated strings ──
  // OpenAI sometimes sends "*IDN?; CH1:SCAle?" as one string instead of separate array items.
  input.commands = input.commands.flatMap(cmd =>
    String(cmd).includes(';') ? String(cmd).split(';').map(s => s.trim()).filter(Boolean) : [cmd]
  );

  // ── SCPI Verify Gate (server-side) ──
  // Bypass for discover_scpi (probing mode) or when explicitly bypassed.
  if (!input._bypassVerifyGate) {
    const failures = await verifyCommandsLocally(input.commands, input.modelFamily);
    if (failures.length > 0) {
      const failList = failures.map(f => f.reason).join('\n');
      return {
        ok: false,
        data: {
          error: 'VERIFY_GATE_BLOCKED',
          unverifiedCommands: failures.map(f => f.command),
          message:
            `SCPI verify gate blocked ${failures.length} of ${input.commands.length} command(s):\n${failList}\n` +
            'Use tek_router to find the correct command: {action:"search_exec", query:"search scpi commands", args:{query:"..."}}',
        },
        sourceMeta: [],
        warnings: [`${failures.length} command(s) failed verification`],
      };
    }
  }

  return sendScpiProxy(input, input.commands, input.timeoutMs);
}
