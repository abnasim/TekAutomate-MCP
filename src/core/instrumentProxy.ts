import type { InstrumentOutputMode, ToolResult } from './schemas';
import { decodeCommandStatus, decodeStatusFromText } from './statusDecoder';

interface Endpoint {
  executorUrl: string;
  visaResource: string;
  backend: string;
  liveMode?: boolean;
  outputMode?: InstrumentOutputMode;
}

interface RunPythonResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  combinedOutput: string;
  transcript: Array<{ stream: string; line: string; timestamp?: number }>;
  durationSec?: number;
}

function resolveOutputMode(endpoint: Endpoint): InstrumentOutputMode {
  return endpoint.outputMode === 'clean' ? 'clean' : 'verbose';
}

function isLiveModeEnabled(endpoint: Endpoint): boolean {
  return endpoint.liveMode === true;
}

function buildRuntimeDetails(run: RunPythonResult, mode: InstrumentOutputMode): Record<string, unknown> {
  const base: Record<string, unknown> = {
    outputMode: mode,
    durationSec: run.durationSec,
  };
  if (mode === 'clean') {
    base.runtimeSummary = {
      hasStdout: Boolean(run.stdout),
      hasStderr: Boolean(run.stderr),
      hasError: Boolean(run.error),
      transcriptLines: run.transcript.length,
    };
    return base;
  }
  base.rawStdout = run.stdout;
  base.rawStderr = run.stderr;
  base.error = run.error;
  base.combinedOutput = run.combinedOutput;
  base.transcript = run.transcript;
  return base;
}

export function formatVerboseProbeResult(
  command: string,
  data: Record<string, unknown>,
  mode: InstrumentOutputMode
): string {
  const response = typeof data.response === 'string' ? data.response : '';
  const stderr = typeof data.stderr === 'string' ? data.stderr : '';
  const error = typeof data.error === 'string' ? data.error : '';
  const decoded = Array.isArray(data.decodedStatus) ? data.decodedStatus.map((item) => String(item)) : [];
  if (mode === 'clean') {
    return decoded.length > 0
      ? `${command}: ${response}\nDecoded:\n- ${decoded.join('\n- ')}`.trim()
      : `${command}: ${response}`.trim();
  }

  const sections = [`Command: ${command}`];
  if (response) sections.push(`Query response:\n${response}`);
  if (typeof data.rawStdout === 'string' && data.rawStdout) sections.push(`stdout:\n${data.rawStdout}`);
  if (stderr) sections.push(`stderr:\n${stderr}`);
  if (error) sections.push(`error:\n${error}`);
  if (decoded.length > 0) sections.push(`Decoded:\n- ${decoded.join('\n- ')}`);
  if (typeof data.combinedOutput === 'string' && data.combinedOutput) {
    sections.push(`Combined runtime output:\n${data.combinedOutput}`);
  }
  return sections.join('\n\n').trim();
}

async function runPython(
  endpoint: Endpoint,
  code: string,
  timeoutSec = 60
): Promise<RunPythonResult> {
  try {
    const res = await fetch(`${endpoint.executorUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action: 'run_python',
        code,
        timeout_sec: timeoutSec,
        scope_visa: endpoint.visaResource,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return {
      ok: json.ok === true,
      stdout: typeof json.stdout === 'string' ? json.stdout : '',
      stderr: typeof json.stderr === 'string' ? json.stderr : '',
      error: typeof json.error === 'string' ? json.error : undefined,
      combinedOutput: typeof json.combined_output === 'string' ? json.combined_output : '',
      transcript: Array.isArray(json.transcript)
        ? (json.transcript as Array<{ stream: string; line: string; timestamp?: number }>)
        : [],
      durationSec: typeof json.duration_sec === 'number' ? json.duration_sec : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: err instanceof Error ? err.message : 'Executor unreachable',
      combinedOutput: '',
      transcript: [],
    };
  }
}

export async function getInstrumentStateProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const code = `import pyvisa
rm = pyvisa.ResourceManager()
scope = rm.open_resource(${JSON.stringify(endpoint.visaResource)})
print("IDN:", scope.query("*IDN?").strip())
print("ESR:", scope.query("*ESR?").strip())
print("ALLEV:", scope.query("ALLEV?").strip())
scope.close()
`;
  const run = await runPython(endpoint, code, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  return {
    ok: true,
    data: {
      decodedStatus: decodeStatusFromText(`${run.stdout}\n${run.stderr}`),
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function probeCommandProxy(
  endpoint: Endpoint,
  command: string
): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const code = `import pyvisa
rm = pyvisa.ResourceManager()
scope = rm.open_resource(${JSON.stringify(endpoint.visaResource)})
cmd = ${JSON.stringify(command)}
if "?" in cmd:
    print(scope.query(cmd).strip())
else:
    scope.write(cmd)
    print("OK")
scope.close()
`;
  const run = await runPython(endpoint, code, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  const mode = resolveOutputMode(endpoint);
  return {
    ok: true,
    data: {
      response: run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      decodedStatus: decodeCommandStatus(command, run.stdout.trim()),
      ...buildRuntimeDetails(run, mode),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function getVisaResourcesProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const code = `import pyvisa
rm = pyvisa.ResourceManager()
print(list(rm.list_resources()))
`;
  const run = await runPython(endpoint, code, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  return {
    ok: true,
    data: {
      resources: run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function getEnvironmentProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
  if (!isLiveModeEnabled(endpoint)) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['live instrument mode is disabled'] };
  }
  const code = `import pyvisa, tm_devices, sys
print("pyvisa:", pyvisa.__version__)
print("tm_devices:", tm_devices.__version__)
print("python:", sys.version)
`;
  const run = await runPython(endpoint, code, 45);
  if (!run.ok) {
    return { ok: false, data: {}, sourceMeta: [], warnings: ['code_executor not reachable'] };
  }
  return {
    ok: true,
    data: {
      environment: run.stdout.trim(),
      stderr: run.stderr.trim(),
      error: run.error,
      ...buildRuntimeDetails(run, resolveOutputMode(endpoint)),
    },
    sourceMeta: [],
    warnings: [],
  };
}
