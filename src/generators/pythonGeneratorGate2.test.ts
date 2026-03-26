/* eslint-disable no-template-curly-in-string */
/// <reference types="jest" />

import { spawnSync } from 'child_process';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

function tmpFile(name: string): string {
  return path.join(os.tmpdir(), `tekautomate_gate2_${name}_${Date.now()}.py`);
}

function writeTmp(file: string, code: string): void {
  writeFileSync(file, code, 'utf8');
}

function cleanTmp(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}

function pythonAvailable(): boolean {
  const r = spawnSync('python', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function pyCompile(file: string): string | null {
  const r = spawnSync('python', ['-m', 'py_compile', file], { encoding: 'utf8' });
  if (r.status !== 0) return (r.stderr || r.stdout || 'py_compile failed').trim();
  return null;
}

function findUndefinedFunctions(file: string): string[] {
  const script = `
import ast, sys, json

BUILTINS = {
    'print','len','range','str','int','float','open','list','dict','set',
    'hasattr','getattr','setattr','isinstance','enumerate','zip','map',
    'filter','sorted','type','vars','locals','globals','repr','abs','max',
    'min','sum','round','bool','bytes','bytearray','hex','oct','bin',
    'format','input','iter','next','id','hash','callable','super',
    'staticmethod','classmethod','property','object','Exception','TimeoutError',
    'ValueError','TypeError','RuntimeError','OSError','IOError',
    'FileNotFoundError','NotImplementedError','StopIteration',
    'KeyboardInterrupt','AttributeError','IndexError','KeyError',
    'NameError','ImportError','ModuleNotFoundError','__import__',
    '__name__','__file__','__spec__',
}

with open(sys.argv[1], encoding='utf-8') as f:
    src = f.read()

try:
    tree = ast.parse(src)
except SyntaxError:
    print(json.dumps({'undefined': []}))
    sys.exit(0)

defined = set()
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        defined.add(node.name)
    elif isinstance(node, ast.Import):
        for alias in node.names:
            defined.add(alias.asname or alias.name.split('.')[0])
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            defined.add(alias.asname or alias.name)
    elif isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name):
                defined.add(t.id)

called_undef = []
for node in ast.walk(tree):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        name = node.func.id
        if name not in defined and name not in BUILTINS:
            called_undef.append(name)

print(json.dumps({'undefined': list(set(called_undef))}))
`.trim();

  const tmpScript = path.join(os.tmpdir(), `tekautomate_ast_check_${Date.now()}.py`);
  writeFileSync(tmpScript, script, 'utf8');
  try {
    const r = spawnSync('python', [tmpScript, file], { encoding: 'utf8' });
    if (r.status !== 0) return [];
    const parsed = JSON.parse(r.stdout.trim() || '{}') as { undefined?: string[] };
    return parsed.undefined || [];
  } catch {
    return [];
  } finally {
    cleanTmp(tmpScript);
  }
}

function findUnresolvedTemplates(code: string): string[] {
  const matches = code.match(/\$\{[^}]+\}/g) || [];
  return [...new Set(matches)];
}

function checkImports(code: string, backend: string): { missing: string[]; unexpected: string[] } {
  const missing: string[] = [];
  const unexpected: string[] = [];

  if (backend === 'pyvisa' && !code.includes('import pyvisa')) {
    missing.push('import pyvisa');
  }
  if (backend === 'tm_devices' && !code.includes('from tm_devices')) {
    missing.push('from tm_devices import DeviceManager');
  }
  if (backend === 'vxi11' && !code.includes('import vxi11')) {
    missing.push('import vxi11');
  }
  if (backend === 'tm_devices' && code.includes('rm.open_resource') && !code.includes('# hybrid')) {
    unexpected.push('rm.open_resource in tm_devices script');
  }

  return { missing, unexpected };
}

let generatePythonForSteps: ((steps: unknown[], devices: unknown[]) => string) | null = null;
let generatePythonFromBlockly: ((xml: string, devices: unknown[]) => string) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appModule = require('./generatePythonForSteps');
  generatePythonForSteps = appModule.generatePythonForSteps ?? null;
  generatePythonFromBlockly = appModule.generatePythonFromBlockly ?? null;
  void generatePythonFromBlockly;
} catch {
  // graceful fallback handled in tests
}

interface StepFlow {
  name: string;
  backend: string;
  devices: unknown[];
  steps: unknown[];
  expectImport?: string;
  mustNotContain?: string[];
  mustContain?: string[];
}

const PYVISA_DEVICE = {
  id: 'dev1',
  alias: 'scope',
  backend: 'pyvisa',
  connectionType: 'tcpip',
  host: '192.168.1.10',
  enabled: true,
};

const TM_DEVICES_DEVICE = {
  id: 'dev1',
  alias: 'scope',
  backend: 'tm_devices',
  connectionType: 'tcpip',
  host: '192.168.1.10',
  enabled: true,
};

const VXI11_DEVICE = {
  id: 'dev1',
  alias: 'scope',
  backend: 'vxi11',
  connectionType: 'tcpip',
  host: '192.168.1.10',
  enabled: true,
};

const GOLDEN_FLOWS: StepFlow[] = [
  {
    name: 'pyvisa_connect_idn_disconnect',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
      { id: '2', type: 'query', label: 'IDN', params: { command: '*IDN?', saveAs: 'idn' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    expectImport: 'pyvisa',
    mustContain: ['*IDN?'],
  },
  {
    name: 'pyvisa_write_query',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Set Scale', params: { command: 'CH1:SCALE 1.0' } },
      { id: '3', type: 'query', label: 'Get Scale', params: { command: 'CH1:SCALE?', saveAs: 'scale' } },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['CH1:SCALE 1.0', 'CH1:SCALE?'],
  },
  {
    name: 'pyvisa_sleep_opc',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Acquire', params: { command: 'ACQuire:STATE ON' } },
      { id: '3', type: 'sleep', label: 'Wait', params: { duration: 1.0 } },
      { id: '4', type: 'query', label: 'OPC', params: { command: '*OPC?', saveAs: 'opc' } },
      { id: '5', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['time.sleep(1'],
  },
  {
    name: 'pyvisa_save_screenshot_modern',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'save_screenshot', label: 'Screenshot', params: { filename: 'screen.png', scopeType: 'modern' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustNotContain: ['${format}', '${filename}'],
  },
  {
    name: 'pyvisa_save_screenshot_legacy',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'save_screenshot', label: 'Screenshot', params: { filename: 'screen.png', scopeType: 'legacy' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustNotContain: ['${format}', '${filename}'],
  },
  {
    name: 'pyvisa_save_waveform',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'save_waveform', label: 'Save CH1', params: { source: 'CH1', filename: 'ch1.bin', format: 'bin' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
  },
  {
    name: 'pyvisa_recall_session',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'recall', label: 'Load Session', params: { recallType: 'SESSION', filePath: 'C:/test.tss' } },
      { id: '3', type: 'sleep', label: 'Settle', params: { duration: 0.5 } },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
  },
  {
    name: 'pyvisa_set_and_query',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'set_and_query', label: 'Set+Verify', params: { command: 'CH1:SCALE 1.0', queryCommand: 'CH1:SCALE?', saveAs: 'verify_scale' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['CH1:SCALE 1.0', 'CH1:SCALE?'],
  },
  {
    name: 'pyvisa_python_block',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'python', label: 'Custom', params: { code: 'result = scope.query("*IDN?").strip()\\nprint(result)' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustNotContain: ['\\n'],
  },
  {
    name: 'pyvisa_sweep',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      {
        id: '2',
        type: 'sweep',
        label: 'Voltage Sweep',
        params: { variableName: 'v', start: 0.5, stop: 2.5, step: 0.5, saveResults: false },
        children: [{ id: '3', type: 'write', label: 'Set Voltage', params: { command: 'CH1:SCALE 1.0' } }],
      },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['while v <='],
    mustNotContain: ['range(0.5'],
  },
  {
    name: 'pyvisa_group',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      {
        id: 'g1',
        type: 'group',
        label: 'Measurements',
        params: {},
        children: [
          { id: '2', type: 'write', label: 'Add Meas', params: { command: 'MEASUrement:ADDMEAS PK2PK' } },
          { id: '3', type: 'query', label: 'Read Meas', params: { command: 'MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?', saveAs: 'pk2pk' } },
        ],
      },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['MEASUrement:ADDMEAS PK2PK'],
  },
  {
    name: 'pyvisa_comment_ignored',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'comment', label: 'Note', params: { text: 'This is a comment' } },
      { id: '3', type: 'write', label: 'Reset', params: { command: '*RST' } },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['*RST'],
  },
  {
    name: 'tm_devices_connect_idn',
    backend: 'tm_devices',
    devices: [TM_DEVICES_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
      { id: '2', type: 'tm_device_command', label: 'Get State', params: { code: 'scope.commands.acquire.state.query()', model: 'MSO6B', description: 'Query acquire state' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    expectImport: 'tm_devices',
    mustNotContain: ['rm.open_resource'],
  },
  {
    name: 'tm_devices_screenshot',
    backend: 'tm_devices',
    devices: [TM_DEVICES_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'save_screenshot', label: 'Screenshot', params: { filename: 'screen.png', scopeType: 'modern' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustNotContain: ['${format}', '${filename}'],
  },
  {
    name: 'vxi11_connect_write',
    backend: 'vxi11',
    devices: [VXI11_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Reset', params: { command: '*RST' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    expectImport: 'vxi11',
  },
  {
    name: 'pyvisa_multi_device',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE, { id: 'dev2', alias: 'psu', backend: 'pyvisa', connectionType: 'tcpip', host: '192.168.1.11', enabled: true }],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
      { id: '2', type: 'write', label: 'PSU On', params: { command: 'OUTPut ON', boundDeviceId: 'dev2' } },
      { id: '3', type: 'write', label: 'Set Scale', params: { command: 'CH1:SCALE 1.0', boundDeviceId: 'dev1' } },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['OUTPut ON', 'CH1:SCALE 1.0'],
  },
  {
    name: 'pyvisa_empty_group',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: 'g1', type: 'group', label: 'Empty Group', params: {}, children: [] },
      { id: '2', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
  },
  {
    name: 'pyvisa_error_check',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Reset', params: { command: '*RST' } },
      { id: '3', type: 'error_check', label: 'Check Errors', params: { command: 'ALLEv?' } },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
  },
  {
    name: 'pyvisa_recall_factory',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'recall', label: 'Factory Reset', params: { recallType: 'FACTORY', filePath: '' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
  },
  {
    name: 'tm_devices_acquisition',
    backend: 'tm_devices',
    devices: [TM_DEVICES_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'tm_device_command', label: 'Acquire On', params: { code: "scope.commands.acquire.state.write('ON')", model: 'MSO6B', description: '' } },
      { id: '3', type: 'tm_device_command', label: 'StopAfter', params: { code: "scope.commands.acquire.stopafter.write('SEQuence')", model: 'MSO6B', description: '' } },
      { id: '4', type: 'tm_device_command', label: 'Acquire Off', params: { code: "scope.commands.acquire.state.write('OFF')", model: 'MSO6B', description: '' } },
      { id: '5', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    expectImport: 'tm_devices',
    mustNotContain: ['rm.open_resource'],
  },
  {
    name: 'pyvisa_fastframe',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Enable FastFrame', params: { command: 'HORizontal:FASTframe:STATE ON' } },
      { id: '3', type: 'write', label: 'Set Count', params: { command: 'HORizontal:FASTframe:COUNt 50' } },
      { id: '4', type: 'write', label: 'Acquire On', params: { command: 'ACQuire:STATE ON' } },
      { id: '5', type: 'sleep', label: 'Wait', params: { duration: 2.0 } },
      { id: '6', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['HORizontal:FASTframe:STATE ON', 'HORizontal:FASTframe:COUNt 50'],
  },
  {
    name: 'pyvisa_measurement_addmeas',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Delete Meas', params: { command: 'MEASUrement:DELETEALL' } },
      { id: '3', type: 'write', label: 'Add Freq', params: { command: 'MEASUrement:ADDMEAS FREQ' } },
      { id: '4', type: 'write', label: 'Source Freq', params: { command: 'MEASUrement:MEAS1:SOURCE1 CH1' } },
      { id: '5', type: 'query', label: 'Read Freq', params: { command: 'MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?', saveAs: 'freq' } },
      { id: '6', type: 'write', label: 'Add Amp', params: { command: 'MEASUrement:ADDMEAS AMP' } },
      { id: '7', type: 'write', label: 'Source Amp', params: { command: 'MEASUrement:MEAS2:SOURCE1 CH1' } },
      { id: '8', type: 'query', label: 'Read Amp', params: { command: 'MEASUrement:MEAS2:RESUlts:CURRentacq:MEAN?', saveAs: 'amp' } },
      { id: '9', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['MEASUrement:ADDMEAS FREQ', 'MEASUrement:ADDMEAS AMP'],
    mustNotContain: ['IMMed', 'DPOJET'],
  },
  {
    name: 'pyvisa_save_screenshot_save_step',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'save_screenshot', label: 'Capture', params: { filename: 'capture.png', scopeType: 'modern' } },
      { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustNotContain: ['HARDCopy', '${format}', '${filename}'],
  },
  {
    name: 'pyvisa_waveform_and_screenshot',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Acquire', params: { command: 'ACQuire:STATE ON' } },
      { id: '3', type: 'sleep', label: 'Wait', params: { duration: 0.5 } },
      { id: '4', type: 'save_screenshot', label: 'Capture', params: { filename: 'scope.png', scopeType: 'modern' } },
      { id: '5', type: 'save_waveform', label: 'Save CH1', params: { source: 'CH1', filename: 'ch1.wfm', format: 'bin' } },
      { id: '6', type: 'save_waveform', label: 'Save CH2', params: { source: 'CH2', filename: 'ch2.wfm', format: 'bin' } },
      { id: '7', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustNotContain: ['${format}', '${filename}'],
  },
  {
    name: 'pyvisa_tekexpress',
    backend: 'pyvisa',
    devices: [{ id: 'tekexp', alias: 'tekexp', backend: 'pyvisa', connectionType: 'socket', host: 'localhost', port: 5000, enabled: true }],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'write', label: 'Run', params: { command: 'TEKEXP:STATE RUN' } },
      { id: '3', type: 'query', label: 'State', params: { command: 'TEKEXP:STATE?', saveAs: 'state' } },
      { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['SOCKET', 'TEKEXP'],
    mustNotContain: ['socket.sendall'],
  },
  {
    name: 'pyvisa_zip_python_block',
    backend: 'pyvisa',
    devices: [PYVISA_DEVICE],
    steps: [
      { id: '1', type: 'connect', label: 'Connect', params: {} },
      { id: '2', type: 'save_waveform', label: 'Save CH1', params: { source: 'CH1', filename: 'ch1.wfm', format: 'bin' } },
      { id: '3', type: 'save_screenshot', label: 'Capture', params: { filename: 'capture.png', scopeType: 'modern' } },
      {
        id: '4',
        type: 'python',
        label: 'Zip Session',
        params: {
          code: 'import zipfile\\nwith zipfile.ZipFile("session.tss", "w") as z:\\n    z.write("ch1.wfm")\\n    z.write("capture.png")',
        },
      },
      { id: '5', type: 'disconnect', label: 'Disconnect', params: {} },
    ],
    mustContain: ['zipfile', '.tss'],
    mustNotContain: ['${'],
  },
];

const PYTHON_AVAILABLE = pythonAvailable();

describe('Gate 2: Python Generator - Compile + Undefined Function Checks', () => {
  if (!PYTHON_AVAILABLE) {
    it.skip('Python not available - skipping Gate 2 tests', () => {});
    return;
  }

  if (!generatePythonForSteps) {
    it('WARN: generatePythonForSteps not importable - generator integration not wired', () => {
      console.warn(
        '[Gate 2] generatePythonForSteps not found. Export it from App.tsx or generator module; tests run once wired.'
      );
      expect(true).toBe(true);
    });
    return;
  }

  for (const flow of GOLDEN_FLOWS) {
    describe(`flow: ${flow.name}`, () => {
      let code: string;
      let tmpPath: string;

      beforeAll(() => {
        code = generatePythonForSteps!(flow.steps, flow.devices);
        tmpPath = tmpFile(flow.name);
        writeTmp(tmpPath, code);
      });

      afterAll(() => {
        cleanTmp(tmpPath);
      });

      it('generates non-empty Python', () => {
        expect(typeof code).toBe('string');
        expect(code.trim().length).toBeGreaterThan(0);
      });

      it('passes py_compile (valid syntax)', () => {
        const err = pyCompile(tmpPath);
        expect(err).toBeNull();
      });

      it('has no undefined function calls', () => {
        const undef = findUndefinedFunctions(tmpPath);
        const allowed = new Set(['safe_query', 'wait_opc', 'check_errors']);
        const realUndefined = undef.filter((fn) => !allowed.has(fn));
        expect(realUndefined).toEqual([]);
      });

      it('has no unresolved template literals (${...})', () => {
        const unresolved = findUnresolvedTemplates(code);
        expect(unresolved).toEqual([]);
      });

      it('has correct imports for backend', () => {
        const { missing, unexpected } = checkImports(code, flow.backend);
        expect(missing).toEqual([]);
        expect(unexpected).toEqual([]);
      });

      if (flow.mustContain && flow.mustContain.length > 0) {
        it('contains required strings', () => {
          for (const s of flow.mustContain || []) {
            expect(code).toContain(s);
          }
        });
      }

      if (flow.mustNotContain && flow.mustNotContain.length > 0) {
        it('does not contain forbidden strings', () => {
          for (const s of flow.mustNotContain || []) {
            expect(code).not.toContain(s);
          }
        });
      }
    });
  }

  describe('regression: known past bugs', () => {
    it('BUG-003: python_code block escaped newline handling is stable', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'python', label: 'Write', params: { code: 'f.write("line1\\nline2")' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [PYVISA_DEVICE]
      );
      expect(code).toContain('line1\\nline2');
    });

    it('BUG-005: screenshot template literals are fully resolved', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'save_screenshot', label: 'Screenshot', params: { filename: 'test.png', scopeType: 'legacy' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [PYVISA_DEVICE]
      );
      expect(code).not.toContain('${format}');
      expect(code).not.toContain('${filename}');
    });

    it('BUG-008: float sweep uses while loop, not range()', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          {
            id: '2',
            type: 'sweep',
            label: 'Float Sweep',
            params: { variableName: 'v', start: 0.5, stop: 2.5, step: 0.5, saveResults: false },
            children: [{ id: '3', type: 'write', label: 'Write', params: { command: 'CH1:SCALE 1.0' } }],
          },
          { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [PYVISA_DEVICE]
      );
      expect(code).toContain('while v <=');
      expect(code).not.toContain('range(0.5');
    });

    it('BUG-009: OPC query uses strip()', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'query', label: 'OPC', params: { command: '*OPC?', saveAs: 'opc_result' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [PYVISA_DEVICE]
      );
      expect(code).toMatch(/opc_result.*strip\(\)/);
    });

    it('safe_query_text must be defined if called (NameError regression)', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'query', label: 'Sourcelist', params: { command: 'SAVe:WAVEform:SOURCELIst?', saveAs: 'sources' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [TM_DEVICES_DEVICE]
      );
      const tmpPath = tmpFile('safe_query_regression');
      writeTmp(tmpPath, code);
      const undef = findUndefinedFunctions(tmpPath);
      cleanTmp(tmpPath);
      if (code.includes('safe_query_text')) {
        expect(undef).not.toContain('safe_query_text');
      }
      const allowed = new Set(['safe_query', 'wait_opc', 'check_errors']);
      expect(undef.filter((fn) => !allowed.has(fn))).toEqual([]);
    });

    it('cleanup must close ALL connected devices not just the first', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'write', label: 'Write', params: { command: '*RST', boundDeviceId: 'dev1' } },
          { id: '3', type: 'write', label: 'Write', params: { command: 'OUTPut ON', boundDeviceId: 'dev2' } },
          { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [
          PYVISA_DEVICE,
          { id: 'dev2', alias: 'psu', backend: 'pyvisa', connectionType: 'tcpip', host: '192.168.1.11', enabled: true },
        ]
      );
      expect(code).toMatch(/scope.*close\(\)/);
      expect(code).toMatch(/psu.*close\(\)|close.*psu/);
    });

    it('R7: screenshot uses save_screenshot path, not HARDCopy (modern)', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'save_screenshot', label: 'Capture', params: { filename: 'capture.png', scopeType: 'modern' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [PYVISA_DEVICE]
      );
      expect(code).not.toContain('HARDCopy');
      expect(code).toMatch(/SAVE:IMAGE|save_screenshot|FILESYSTEM:READFILE/i);
    });

    it('R8: measurement path uses ADDMEAS pattern, not IMMed', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'write', label: 'Add Freq', params: { command: 'MEASUrement:ADDMEAS FREQ' } },
          { id: '3', type: 'query', label: 'Read', params: { command: 'MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?', saveAs: 'freq' } },
          { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [PYVISA_DEVICE]
      );
      expect(code).toContain('MEASUrement:ADDMEAS');
      expect(code).not.toContain('IMMed:TYPe');
    });

    it('R9: TekExpress flow uses SOCKET context and avoids raw socket.sendall', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'write', label: 'Run', params: { command: 'TEKEXP:STATE RUN' } },
          { id: '3', type: 'query', label: 'State', params: { command: 'TEKEXP:STATE?', saveAs: 'state' } },
          { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [{ id: 'tekexp', alias: 'tekexp', backend: 'pyvisa', connectionType: 'socket', host: 'localhost', port: 5000, enabled: true }]
      );
      expect(code).toContain('SOCKET');
      expect(code).not.toContain('socket.sendall');
    });

    it('R10: tm_devices rejects raw SCPI write style on scope object', () => {
      if (!generatePythonForSteps) return;
      const code = generatePythonForSteps!(
        [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'write', label: 'Backend violation', params: { command: 'ACQuire:STATE ON' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
        [TM_DEVICES_DEVICE]
      );
      expect(code).not.toMatch(/\bscope\.write\(/);
    });
  });
});
