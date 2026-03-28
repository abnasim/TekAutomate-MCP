import { sendScpiProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  basePath: string;
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  depth?: 'shallow' | 'deep';
  modelFamily?: string;
}

// Common SCPI suffixes to try when walking the tree
const SHALLOW_SUFFIXES = [
  '', // try the base itself
  ':STATE', ':STATe',
  ':VALue', ':LEVel', ':MODe',
  ':SOUrce', ':TYPe', ':ENABle',
  ':FORMat', ':UNIts', ':POSition',
  ':SCAle', ':OFFSet', ':BANdwidth',
  ':COUPling', ':IMPedance', ':TERmination',
  ':FREQuency', ':PERiod', ':PHASe',
  ':AMPLitude', ':VOLTage', ':CURRent',
  ':MEAN', ':MAXimum', ':MINimum', ':PK2pk',
  ':COUNt', ':NUMAVg', ':WEIGht',
];

const DEEP_EXTRAS = [
  ':CH1', ':CH2', ':CH3', ':CH4',
  ':MAGnitude', ':RF_MAGnitude', ':RF_FREQuency', ':RF_PHASe',
  ':EDGE', ':PULse', ':WIDth', ':RUNt', ':LOGIc',
  ':SELect', ':SEQuence', ':WINDow',
  ':RISEtime', ':FALLtime', ':DELay',
  ':HIGh', ':LOW', ':THReshold',
  ':MATH', ':REF', ':BUS',
  ':HORizontal', ':VERTical', ':DISplay',
  ':ACQuire', ':CURSor', ':SEARCH',
  ':MAG_VS_TIME', ':FREQ_VS_TIME', ':PHASE_VS_TIME',
];

// Channel-like placeholder expansions
const CHANNEL_EXPANSIONS = ['CH1', 'CH2', 'CH3', 'CH4'];

export async function discoverScpi(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (!input.liveMode) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['discover_scpi requires liveMode=true — must be connected to a live instrument.'] };
  }
  if (!input.basePath?.trim()) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['basePath is required. Example: "TRIGger:A:LEVel" or "CH1:SV"'] };
  }

  const base = input.basePath.trim().replace(/\?$/, '');
  const depth = input.depth || 'shallow';
  const suffixes = depth === 'deep'
    ? [...SHALLOW_SUFFIXES, ...DEEP_EXTRAS]
    : SHALLOW_SUFFIXES;

  // Expand <x> placeholders if present
  let basePaths = [base];
  if (base.includes('<x>') || base.includes('<X>')) {
    basePaths = CHANNEL_EXPANSIONS.map(ch =>
      base.replace(/<x>/gi, ch.replace('CH', ''))
        .replace(/CH<x>/gi, ch)
    );
  }

  // Build all query commands to try
  const queries: string[] = [];
  for (const bp of basePaths) {
    for (const suffix of suffixes) {
      const cmd = `${bp}${suffix}?`;
      if (!queries.includes(cmd)) queries.push(cmd);
    }
  }

  // Send in batches to avoid overwhelming the instrument
  const BATCH_SIZE = 15;
  const responded: { command: string; response: string }[] = [];
  const failed: string[] = [];
  const timedOut: string[] = [];

  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const result = await sendScpiProxy(
      {
        executorUrl: input.executorUrl,
        visaResource: input.visaResource,
        backend: input.backend,
        liveMode: true,
        outputMode: 'clean',
      },
      batch,
      3000, // short timeout per command — we expect many to fail
    );

    // Parse per-command results from the response
    const data = result.data as Record<string, unknown>;
    const responses = (data?.responses ?? data?.results ?? []) as Array<{
      command?: string;
      response?: string;
      error?: string;
      status?: string;
    }>;

    if (Array.isArray(responses) && responses.length > 0) {
      for (const r of responses) {
        const cmd = r.command || '';
        if (r.error || r.status === 'error' || r.status === 'timeout') {
          if (r.status === 'timeout') {
            timedOut.push(cmd);
          } else {
            failed.push(cmd);
          }
        } else if (r.response !== undefined && r.response !== null) {
          responded.push({ command: cmd, response: String(r.response).trim() });
        }
      }
    } else if (result.ok) {
      // Fallback: if no per-command breakdown, try parsing stdout
      const stdout = String(data?.stdout || '');
      if (stdout.trim()) {
        responded.push({ command: batch.join('; '), response: stdout.trim() });
      }
    } else {
      // Whole batch failed
      failed.push(...batch);
    }
  }

  // Build a summary
  const discoveredPaths = responded.map(r => r.command.replace(/\?$/, ''));

  return {
    ok: true,
    data: {
      basePath: base,
      depth,
      totalProbed: queries.length,
      discovered: responded,
      discoveredCount: responded.length,
      failedCount: failed.length,
      timedOutCount: timedOut.length,
      discoveredPaths,
      suggestion: responded.length > 0
        ? `Found ${responded.length} valid paths under "${base}". Use get_command_by_header to check if they are in the database, or probe_command to test set syntax.`
        : `No valid paths found under "${base}". Try a different base path or use depth:"deep" for more suffixes.`,
    },
    sourceMeta: [{ type: 'live_discovery', basePath: base }],
    warnings: [],
  };
}
