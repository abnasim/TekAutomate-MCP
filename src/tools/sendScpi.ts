import { sendScpiProxy } from '../core/instrumentProxy';
import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';
import { dispatchLiveActionThroughTekAutomate, shouldBridgeToTekAutomate, withRuntimeInstrumentDefaults } from './liveToolSupport';

interface Input extends Record<string, unknown> {
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

function splitScpiCommandString(command: string): string[] {
  const text = String(command || '');
  if (!text.includes(';')) return [text];

  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ';' && !inQuotes) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) parts.push(trimmed);
  return parts.length ? parts : [text];
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

function fail(error: string, hint: string): ToolResult<Record<string, unknown>> {
  return { ok: false, data: { error, hint }, sourceMeta: [], warnings: [hint] };
}

export async function sendScpi(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  input = withRuntimeInstrumentDefaults(input);

  // ── Fast validation — tell the AI exactly what's wrong ──
  if (!input.commands?.length) {
    return fail('NO_COMMANDS', 'Pass commands:["*IDN?"] — an array of SCPI command strings.');
  }
  if (!input.executorUrl && !input.visaResource) {
    return fail('MISSING_CONTEXT',
      'No instrument context. Call get_instrument_info first, then pass executorUrl, visaResource, backend, and liveMode from its response.');
  }
  if (!input.executorUrl) {
    return fail('MISSING_EXECUTOR_URL', 'executorUrl is required. Call get_instrument_info to get it.');
  }
  if (!input.visaResource) {
    return fail('MISSING_VISA_RESOURCE', 'visaResource is required. Call get_instrument_info or get_visa_resources to get it.');
  }
  if (!input.liveMode) {
    return fail('NOT_LIVE', 'liveMode must be true. Pass liveMode:true with your request.');
  }

  // ── Bridge through TekAutomate browser ──
  if (shouldBridgeToTekAutomate(input)) {
    try {
      const bridged = await dispatchLiveActionThroughTekAutomate('send_scpi', input, Math.max((input.timeoutMs ?? 10_000) + 5_000, 15_000));
      if (!bridged.ok) {
        return fail('BRIDGE_FAILED', bridged.error || 'TekAutomate browser did not complete send_scpi. Is TekAutomate open?');
      }
      return {
        ok: true,
        data: (bridged.result && typeof bridged.result === 'object' ? bridged.result : { result: bridged.result }) as Record<string, unknown>,
        sourceMeta: [], warnings: [],
      };
    } catch (err) {
      return fail('BRIDGE_TIMEOUT', `send_scpi bridge timed out: ${err instanceof Error ? err.message : String(err)}. Is TekAutomate open in the browser?`);
    }
  }

  // ── Normalize commands — split semicolon-concatenated strings ──
  // OpenAI sometimes sends "*IDN?; CH1:SCAle?" as one string instead of separate array items.
  input.commands = input.commands.flatMap(cmd => splitScpiCommandString(String(cmd)));

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
