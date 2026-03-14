import type { ToolResult } from './schemas';

interface Endpoint {
  executorUrl: string;
  visaResource: string;
  backend: string;
}

async function runPython(
  endpoint: Endpoint,
  code: string,
  timeoutSec = 60
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    const res = await fetch(`${endpoint.executorUrl.replace(/\/$/, '')}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 1,
        action: 'run_python',
        code,
        timeout_sec: timeoutSec,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return {
      ok: json.ok === true,
      stdout: typeof json.stdout === 'string' ? json.stdout : '',
      stderr: typeof json.stderr === 'string' ? json.stderr : '',
      error: typeof json.error === 'string' ? json.error : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: err instanceof Error ? err.message : 'Executor unreachable',
    };
  }
}

export async function getInstrumentStateProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
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
      rawStdout: run.stdout,
      rawStderr: run.stderr,
    },
    sourceMeta: [],
    warnings: [],
  };
}

export async function probeCommandProxy(
  endpoint: Endpoint,
  command: string
): Promise<ToolResult<Record<string, unknown>>> {
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
  return {
    ok: true,
    data: { response: run.stdout.trim(), stderr: run.stderr.trim() },
    sourceMeta: [],
    warnings: [],
  };
}

export async function getVisaResourcesProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
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
    data: { resources: run.stdout.trim(), stderr: run.stderr.trim() },
    sourceMeta: [],
    warnings: [],
  };
}

export async function getEnvironmentProxy(endpoint: Endpoint): Promise<ToolResult<Record<string, unknown>>> {
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
    data: { environment: run.stdout.trim(), stderr: run.stderr.trim() },
    sourceMeta: [],
    warnings: [],
  };
}
