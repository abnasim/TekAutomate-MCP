import { sendScpiProxy } from '../core/instrumentProxy';
import type { ToolResult } from '../core/schemas';

interface Input {
  basePath: string;
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  timeoutMs?: number;
  maxProbes?: number;
  modelFamily?: string;
}

// ── Universal suffixes (always tried) ────────────────────────────────
const UNIVERSAL_SUFFIXES = [
  '', // base path itself
  ':CH1', ':CH2', ':CH3', ':CH4', ':CH5', ':CH6', ':CH7', ':CH8',
  ':STATE', ':STATe', ':MODe', ':TYPe', ':ENABle',
  ':SOUrce', ':SOUrce1', ':SOUrce2',
  ':VALue', ':LEVel',
  ':MAGnitude', ':FREQuency', ':PHASe',
  ':HIGh', ':LOW', ':THReshold',
  ':SCAle', ':OFFSet', ':POSition',
  ':FORMat', ':UNIts',
  ':COUNt', ':NUMAVg',
  ':SELect',
];

// ── Context-aware suffix tables ──────────────────────────────────────
// Activated based on keywords in the base path
const CONTEXT_SUFFIXES: Record<string, string[]> = {
  trigger: [
    ':LEVel', ':SLOPe', ':EDGE', ':HOLDoff', ':PULse', ':WIDth', ':RUNt',
    ':LOGIc', ':SETLevel', ':COUPling', ':SOUrce', ':MAGnitude',
    ':FREQuency', ':PHASe', ':MAG_VS_TIME', ':FREQ_VS_TIME', ':PHASE_VS_TIME',
  ],
  sv: [
    ':CENTERFrequency', ':SPAN', ':RBW', ':NUMAVg', ':WINDow',
    ':STARTFrequency', ':STOPFrequency',
    ':RF_MAGnitude', ':RF_FREQuency', ':RF_PHASe', ':RF_AVErage',
    ':SELect:RF_MAGnitude', ':SELect:RF_FREQuency', ':SELect:RF_PHASe',
    ':SPANRBWRatio', ':SPECTRogram',
  ],
  ch: [
    ':SCAle', ':BANDWidth', ':TERmination', ':DESKew',
    ':COUPling', ':OFFSet', ':POSition', ':INVert',
    ':LABel', ':PRObe', ':SV:STATE', ':SV:CENTERFrequency',
  ],
  measurement: [
    ':TYPe', ':SOUrce1', ':SOUrce2', ':RESUlts',
    ':RESUlts:CURRentacq:MEAN', ':RESUlts:CURRentacq:MAXimum',
    ':RESUlts:CURRentacq:MINimum', ':RESUlts:ALLAcqs:MEAN',
    ':STATIstics:ENABle', ':STATIstics:COUNt',
    ':GAting:TYPe', ':GAting:STARTtime', ':GAting:ENDtime',
  ],
  display: [
    ':WAVEform', ':PERSistence', ':SELect', ':INTENSity',
    ':WAVEView1:ZOOM', ':GRAticule', ':COLors',
  ],
  horizontal: [
    ':SCAle', ':RECOrdlength', ':SAMPLERate', ':POSition',
    ':MODe', ':DELay:MODe', ':DELay:TIMe', ':FASTframe',
    ':FASTframe:STATE', ':FASTframe:COUNt',
  ],
  acquire: [
    ':MODe', ':NUMAVg', ':STOPAfter', ':STATE',
    ':NUMEnv', ':MAGNivu',
  ],
  math: [
    ':FUNCtion', ':SOUrce1', ':SOUrce2', ':SPECTral',
    ':TYPe', ':DEFine', ':VERTical:SCAle', ':VERTical:POSition',
  ],
  bus: [
    ':TYPe', ':I2C', ':SPI', ':UART', ':CAN', ':LIN', ':SENT',
    ':I2C:ADDRess', ':I2C:SCLK', ':I2C:SDA',
    ':SPI:SCLK', ':SPI:SS', ':SPI:MOSI', ':SPI:MISO',
  ],
  afg: [
    ':FUNCtion', ':FREQuency', ':AMPLitude', ':OFFSet',
    ':SYMMetry', ':PHASe', ':OUTPUT:STATE',
  ],
  plot: [
    ':TYPe', ':SOUrce1', ':CURVe', ':VIEW',
  ],
};

// ── Clamp timeout to safe range ──────────────────────────────────────
function clampTimeout(ms: number | undefined): number {
  const t = ms ?? 800;
  return Math.max(300, Math.min(2000, t));
}

// ── Get context suffixes based on base path ──────────────────────────
function getContextSuffixes(basePath: string): string[] {
  const lower = basePath.toLowerCase();
  const extra: string[] = [];
  for (const [key, suffixes] of Object.entries(CONTEXT_SUFFIXES)) {
    if (lower.includes(key)) {
      extra.push(...suffixes);
    }
  }
  return extra;
}

// ── Check if a response indicates a multi-channel aggregate ──────────
// Semicolons in response = per-channel data = tree node worth expanding
function isMultiValueResponse(response: string): boolean {
  return response.includes(';') && response.split(';').length >= 2;
}

// ── Probe a batch of queries ─────────────────────────────────────────
async function probeBatch(
  queries: string[],
  input: Input,
  timeoutMs: number,
): Promise<{ responded: { command: string; response: string }[]; failed: string[] }> {
  const responded: { command: string; response: string }[] = [];
  const failed: string[] = [];

  const result = await sendScpiProxy(
    {
      executorUrl: input.executorUrl,
      visaResource: input.visaResource,
      backend: input.backend,
      liveMode: true,
      outputMode: 'clean',
    },
    queries,
    timeoutMs,
  );

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
        failed.push(cmd);
      } else if (r.response !== undefined && r.response !== null) {
        responded.push({ command: cmd, response: String(r.response).trim() });
      }
    }
  } else if (result.ok) {
    const stdout = String(data?.stdout || '');
    if (stdout.trim()) {
      responded.push({ command: queries.join('; '), response: stdout.trim() });
    }
  } else {
    failed.push(...queries);
  }

  return { responded, failed };
}

// ── Main discover function ───────────────────────────────────────────
export async function discoverScpi(input: Input): Promise<ToolResult<Record<string, unknown>>> {
  if (!input.liveMode) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['discover_scpi requires liveMode=true — must be connected to a live instrument.'] };
  }
  if (!input.basePath?.trim()) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['basePath is required. Example: "TRIGger:A:LEVel" or "CH1:SV"'] };
  }

  const base = input.basePath.trim().replace(/\?$/, '');
  const timeoutMs = clampTimeout(input.timeoutMs);
  const maxProbes = Math.min(input.maxProbes ?? 100, 150);
  const BATCH_SIZE = 10;

  // ── Phase 1: Build depth-1 probe list ──────────────────────────
  const contextSuffixes = getContextSuffixes(base);
  const allSuffixes = [...new Set([...UNIVERSAL_SUFFIXES, ...contextSuffixes])];

  // Expand <x> placeholders
  let basePaths = [base];
  if (/<x>/i.test(base)) {
    basePaths = ['CH1', 'CH2', 'CH3', 'CH4'].map(ch =>
      base.replace(/CH<x>/gi, ch).replace(/<x>/gi, ch.replace('CH', ''))
    );
  }

  const depth1Queries: string[] = [];
  for (const bp of basePaths) {
    for (const suffix of allSuffixes) {
      const cmd = `${bp}${suffix}?`;
      if (!depth1Queries.includes(cmd) && depth1Queries.length < maxProbes) {
        depth1Queries.push(cmd);
      }
    }
  }

  // ── Pre-flight: verify instrument is reachable ─────────────────
  const preCheck = await probeBatch(['*IDN?'], input, 3000);
  if (preCheck.responded.length === 0) {
    return {
      ok: false,
      data: { error: 'Instrument not reachable. *IDN? did not respond.' },
      sourceMeta: [],
      warnings: ['Could not reach instrument — check connection.'],
    };
  }
  const instrumentId = preCheck.responded[0]?.response || 'unknown';

  // ── Phase 2: Depth-1 probing ───────────────────────────────────
  const allResponded: { command: string; response: string }[] = [];
  const allFailed: string[] = [];
  let totalProbed = 0;

  for (let i = 0; i < depth1Queries.length; i += BATCH_SIZE) {
    const batch = depth1Queries.slice(i, i + BATCH_SIZE);
    const { responded, failed } = await probeBatch(batch, input, timeoutMs);
    allResponded.push(...responded);
    allFailed.push(...failed);
    totalProbed += batch.length;
  }

  // ── Phase 3: Adaptive depth-2 expansion ────────────────────────
  // For depth-1 hits with multi-value (semicolon) responses,
  // automatically probe :CH1 through :CH8 sub-paths
  const depth2Queries: string[] = [];
  for (const hit of allResponded) {
    if (isMultiValueResponse(hit.response)) {
      const hitBase = hit.command.replace(/\?$/, '');
      for (let ch = 1; ch <= 8; ch++) {
        const d2cmd = `${hitBase}:CH${ch}?`;
        if (!depth1Queries.includes(d2cmd) && !depth2Queries.includes(d2cmd)) {
          depth2Queries.push(d2cmd);
        }
      }
    }
  }

  // Cap total probes
  const depth2Capped = depth2Queries.slice(0, Math.max(0, maxProbes - totalProbed));

  if (depth2Capped.length > 0) {
    for (let i = 0; i < depth2Capped.length; i += BATCH_SIZE) {
      const batch = depth2Capped.slice(i, i + BATCH_SIZE);
      const { responded, failed } = await probeBatch(batch, input, timeoutMs);
      allResponded.push(...responded);
      allFailed.push(...failed);
      totalProbed += batch.length;
    }
  }

  // ── Post-check: verify instrument still connected ──────────────
  const postCheck = await probeBatch(['*IDN?'], input, 3000);
  const stillConnected = postCheck.responded.length > 0;

  // ── Build results ──────────────────────────────────────────────
  const discoveredPaths = allResponded
    .filter(r => r.command !== '*IDN?')
    .map(r => ({
      path: r.command.replace(/\?$/, ''),
      response: r.response,
      isTreeNode: isMultiValueResponse(r.response),
    }));

  return {
    ok: true,
    data: {
      basePath: base,
      instrument: instrumentId,
      timeoutMs,
      totalProbed,
      depth1Count: depth1Queries.length,
      depth2Count: depth2Capped.length,
      discoveredCount: discoveredPaths.length,
      failedCount: allFailed.length,
      stillConnected,
      discovered: discoveredPaths,
      discoveredHeaders: discoveredPaths.map(d => d.path),
      treeNodes: discoveredPaths.filter(d => d.isTreeNode).map(d => d.path),
      leafNodes: discoveredPaths.filter(d => !d.isTreeNode).map(d => d.path),
      suggestion: discoveredPaths.length > 0
        ? `Found ${discoveredPaths.length} valid paths under "${base}". ` +
          `${discoveredPaths.filter(d => d.isTreeNode).length} are tree nodes (have sub-paths), ` +
          `${discoveredPaths.filter(d => !d.isTreeNode).length} are leaf nodes. ` +
          `Use get_command_by_header to check which are in the database.`
        : `No valid paths found under "${base}". Try a broader base path.`,
    },
    sourceMeta: [{ type: 'live_discovery', basePath: base, instrument: instrumentId }],
    warnings: stillConnected ? [] : ['WARNING: Instrument may have disconnected during probing.'],
  };
}
