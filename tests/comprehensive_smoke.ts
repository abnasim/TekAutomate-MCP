import { performance } from 'perf_hooks';

type FlowContext = {
  backend: string;
  modelFamily: string;
  deviceType: string;
  steps: unknown[];
  host?: string;
  connectionType?: string;
  selectedStepId?: string | null;
  executionSource?: string;
};

type TestCase = {
  id: string;
  userMessage: string;
  flowContext: FlowContext;
};

const TESTS: TestCase[] = [
  // === MEASUREMENTS ===
  { id: 'MEAS01', userMessage: 'Add frequency, amplitude, rise time and pk2pk on CH1', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'MEAS02', userMessage: 'Add positive overshoot and negative overshoot measurements on CH2', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'MEAS03', userMessage: 'Add delay measurement between CH1 and CH2', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === TRIGGER ===
  { id: 'TRIG01', userMessage: 'Set edge trigger on CH1 rising at 1.5V normal mode', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'TRIG02', userMessage: 'Set pulse width trigger on CH2, positive polarity, wider than 100ns', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'TRIG03', userMessage: 'Configure B trigger on CH1 rising edge, 5 events after A trigger', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === HORIZONTAL ===
  { id: 'HORIZ01', userMessage: 'Set timebase to 1us per div, record length 10000', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'HORIZ02', userMessage: 'Enable FastFrame 100 frames, include reference frame', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === VERTICAL ===
  { id: 'VERT01', userMessage: 'Set CH1 scale 500mV coupling DC termination 50 ohm, CH2 scale 1V AC coupled', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === BUS DECODE ===
  { id: 'BUS01', userMessage: 'Set up I2C decode on B1, clock CH1, data CH2', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'BUS02', userMessage: 'Set up SPI decode on B2, clock CH1, data CH2, select CH3, CPOL rising, MSB first', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'BUS03', userMessage: 'Set up UART on B1 source CH1 9600 baud 8 bits no parity', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'BUS04', userMessage: 'Set up CAN FD on B1 source CH2 500kbps data phase 2Mbps ISO standard', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'BUS05', userMessage: 'Set up LIN decode B1 CH1 19200 baud LIN 2.x standard', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === SAVE AND RECALL ===
  { id: 'SAVE01', userMessage: 'Save CH1 and CH2 waveforms as binary files to C:/data/', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'SAVE02', userMessage: 'Save setup to C:/setups/test.set and take a screenshot', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'SAVE03', userMessage: 'Recall session from C:/sessions/baseline.tss then add frequency measurement', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === TM_DEVICES ===
  { id: 'TM01', userMessage: 'Set CH1 scale to 200mV and offset to 0 using tm_devices', flowContext: { backend: 'tm_devices', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'TM02', userMessage: 'Configure edge trigger CH1 rising 1V using tm_devices', flowContext: { backend: 'tm_devices', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'TM03', userMessage: 'Add frequency and amplitude measurements on CH1 using tm_devices', flowContext: { backend: 'tm_devices', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === ACQUISITION ===
  { id: 'ACQ01', userMessage: 'Set acquisition mode to average 64 waveforms then run single sequence', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'ACQ02', userMessage: 'Enable fast acquisition temperature palette, run continuous', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === VALIDATION ===
  {
    id: 'VAL01',
    userMessage: 'Validate this flow',
    flowContext: {
      backend: 'pyvisa',
      modelFamily: 'MSO6B',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', params: {} },
        { id: '2', type: 'query', params: { command: '*IDN?' } }, // missing saveAs
        { id: '3', type: 'disconnect', params: {} },
      ],
    },
  },
  {
    id: 'VAL02',
    userMessage: 'Validate this flow',
    flowContext: {
      backend: 'pyvisa',
      modelFamily: 'MSO6B',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'write', params: { command: 'CH1:SCAle 1.0' } }, // missing connect
        { id: '2', type: 'disconnect', params: {} },
      ],
    },
  },

  // === MULTI-STEP COMPLEX ===
  { id: 'COMPLEX01', userMessage: 'Full capture: set CH1 1V scale, edge trigger 0.5V rising, single acquisition, save CH1 waveform and screenshot', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },
  { id: 'COMPLEX02', userMessage: 'Set up CAN FD decode on B1, add CAN frame count measurement, save screenshot', flowContext: { backend: 'pyvisa', modelFamily: 'MSO6B', deviceType: 'SCOPE', steps: [] } },

  // === LEGACY DPO ===
  { id: 'DPO01', userMessage: 'Add frequency measurement on CH1', flowContext: { backend: 'pyvisa', modelFamily: 'DPO7000', deviceType: 'SCOPE', steps: [] } },
  { id: 'DPO02', userMessage: 'Set up CAN decode on B1 source CH1 500kbps', flowContext: { backend: 'pyvisa', modelFamily: 'DPO5000', deviceType: 'SCOPE', steps: [] } },
];

const MCP_HOST = process.env.MCP_HOST || 'http://localhost:8787';
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const CASE_FILTER = process.env.CASE_FILTER;

if (!API_KEY) {
  console.error('Set OPENAI_API_KEY');
  process.exit(1);
}

const filterSet = CASE_FILTER
  ? new Set(CASE_FILTER.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const selected = filterSet ? TESTS.filter((t) => filterSet.has(t.id)) : TESTS;

function extractActionsJson(text: string): { actionsLength: number } {
  const cleaned = text
    .replace(/ACTIONS_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ')
    .replace(/```\s*(\n|$)/g, '')
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '');

  let obj: any = null;
  const objMatch = cleaned.match(/ACTIONS_JSON:\s*(\{[\s\S]*\})\s*$/);
  if (objMatch) {
    try {
      obj = JSON.parse(objMatch[1]);
    } catch {
      obj = null;
    }
  }
  if (!obj) {
    const arrMatch = cleaned.match(/ACTIONS_JSON:\s*(\[[\s\S]*\])\s*$/);
    if (arrMatch) {
      try {
        obj = { actions: JSON.parse(arrMatch[1]) };
      } catch {
        obj = null;
      }
    }
  }
  const actions = obj && Array.isArray(obj.actions) ? obj.actions : [];
  return { actionsLength: actions.length };
}

async function runCase(test: TestCase) {
  const body = {
    userMessage: test.userMessage,
    outputMode: 'steps_json',
    provider: 'openai',
    apiKey: API_KEY,
    model: MODEL,
    flowContext: {
      ...test.flowContext,
      host: '127.0.0.1',
      connectionType: 'tcpip',
      selectedStepId: null,
      executionSource: 'steps',
    },
    runContext: { runStatus: 'idle', logTail: '', auditOutput: '', exitCode: null },
  };

  const t0 = performance.now();
  try {
    const res = await fetch(`${MCP_HOST.replace(/\/$/, '')}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const totalMs = Math.round(performance.now() - t0);
    const raw = await res.text();
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      console.log(`${test.id} | FAIL | ${res.status} | ${totalMs}ms | JSON parse fail`);
      return;
    }
    const ok = data?.ok === true;
    const errors = Array.isArray(data?.errors) ? data.errors.length : 0;
    const { actionsLength } = extractActionsJson(String(data?.text || ''));
    const modelMs = data?.metrics?.modelMs ?? '-';
    const status = !ok ? 'FAIL' : errors > 0 ? 'WARN' : actionsLength > 0 ? 'PASS' : 'WARN';
    console.log(
      `${test.id} | ${status} | total:${totalMs}ms model:${modelMs} | errors:${errors} | actions:${actionsLength}`
    );
  } catch (e) {
    const totalMs = Math.round(performance.now() - t0);
    console.log(`${test.id} | FAIL | ${totalMs}ms | ${e}`);
  }
}

(async () => {
  for (const test of selected) {
    await runCase(test);
  }
})();
