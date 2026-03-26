export type FlowContext = {
  backend: string;
  modelFamily: string;
  deviceType: string;
  steps: Array<Record<string, unknown>>;
  host?: string;
  connectionType?: string;
  selectedStepId?: string | null;
  executionSource?: string;
  alias?: string;
  instrumentMap?: Array<Record<string, unknown>>;
};

export type BenchmarkCase = {
  id: string;
  level: string;
  userMessage: string;
  flowContext: FlowContext;
};

export const DEFAULT_INSTRUMENT_MAP = [
  {
    alias: 'scope1',
    backend: 'pyvisa',
    host: '127.0.0.1',
    connectionType: 'tcpip',
    deviceType: 'SCOPE',
    deviceDriver: 'MSO6B',
    visaBackend: 'system',
  },
];

export const CASE_ALIASES: Record<string, string> = {
  MEAS01: 'L2_MEA_01',
  TRIG01: 'L3_CHT_03',
  BUS04: 'L4_BUS_04',
  COMPLEX01: 'L7_CPX_01',
};

export const PYVISA_SCOPE_CONTEXT: FlowContext = {
  backend: 'pyvisa',
  modelFamily: 'MSO4/5/6 Series',
  deviceType: 'SCOPE',
  steps: [],
  host: '127.0.0.1',
  connectionType: 'tcpip',
  selectedStepId: null,
  executionSource: 'steps',
  alias: 'scope1',
  instrumentMap: [...DEFAULT_INSTRUMENT_MAP],
};

export const TM_DEVICES_SCOPE_CONTEXT: FlowContext = {
  backend: 'tm_devices',
  modelFamily: 'MSO4/5/6 Series',
  deviceType: 'SCOPE',
  steps: [],
  host: '127.0.0.1',
  connectionType: 'tcpip',
  selectedStepId: null,
  executionSource: 'steps',
  alias: 'scope1',
  instrumentMap: [...DEFAULT_INSTRUMENT_MAP],
};

export const PYVISA_AFG_CONTEXT: FlowContext = {
  backend: 'pyvisa',
  modelFamily: 'AFG31000',
  deviceType: 'AFG',
  steps: [],
  host: '127.0.0.1',
  connectionType: 'tcpip',
  selectedStepId: null,
  executionSource: 'steps',
  alias: 'afg1',
  instrumentMap: [
    {
      alias: 'afg1',
      backend: 'pyvisa',
      host: '127.0.0.1',
      connectionType: 'tcpip',
      deviceType: 'AFG',
      deviceDriver: 'AFG31000',
      visaBackend: 'system',
    },
  ],
};

export const PYVISA_SMU_CONTEXT: FlowContext = {
  backend: 'pyvisa',
  modelFamily: 'Keithley 2450 SMU',
  deviceType: 'SMU',
  steps: [],
  host: '127.0.0.1',
  connectionType: 'tcpip',
  selectedStepId: null,
  executionSource: 'steps',
  alias: 'smu1',
  instrumentMap: [
    {
      alias: 'smu1',
      backend: 'pyvisa',
      host: '127.0.0.1',
      connectionType: 'tcpip',
      deviceType: 'SMU',
      deviceDriver: 'Keithley2450',
      visaBackend: 'system',
    },
  ],
};

export const CASES: BenchmarkCase[] = [
  { id: 'L1_BAS_01', level: 'Level 1 - Basics', userMessage: 'Connect to scope and print the IDN', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L1_BAS_02', level: 'Level 1 - Basics', userMessage: 'Reset scope to factory defaults', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L1_BAS_03', level: 'Level 1 - Basics', userMessage: 'Take a screenshot and save it', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L1_BAS_04', level: 'Level 1 - Basics', userMessage: 'Save CH1 waveform to a binary file', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L1_BAS_05', level: 'Level 1 - Basics', userMessage: 'Check the error queue and print any errors', flowContext: PYVISA_SCOPE_CONTEXT },

  { id: 'L2_MEA_01', level: 'Level 2 - Measurements', userMessage: 'Add frequency and amplitude measurements on CH1', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L2_MEA_02', level: 'Level 2 - Measurements', userMessage: 'Add rise time, fall time, pk2pk, and mean on CH2', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L2_MEA_03', level: 'Level 2 - Measurements', userMessage: 'Add overshoot and undershoot on CH1, then query both results', flowContext: PYVISA_SCOPE_CONTEXT },

  { id: 'L3_CHT_01', level: 'Level 3 - Channel + Trigger', userMessage: 'Set CH1 to 500mV DC 50 ohm', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L3_CHT_02', level: 'Level 3 - Channel + Trigger', userMessage: 'Set CH1 to 1V DC and CH2 to 500mV AC', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L3_CHT_03', level: 'Level 3 - Channel + Trigger', userMessage: 'Set edge trigger on CH1 rising at 1V normal mode', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L3_CHT_04', level: 'Level 3 - Channel + Trigger', userMessage: 'Set trigger holdoff to 50ms and mode to auto', flowContext: PYVISA_SCOPE_CONTEXT },

  { id: 'L4_BUS_01', level: 'Level 4 - Bus Decode', userMessage: 'Set up I2C decode on B1 clock CH1 data CH2', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L4_BUS_02', level: 'Level 4 - Bus Decode', userMessage: 'Set up CAN FD on B1 source CH2 500kbps ISO standard', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L4_BUS_03', level: 'Level 4 - Bus Decode', userMessage: 'Set up UART on B1 CH1 115200 baud 8N1', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L4_BUS_04', level: 'Level 4 - Bus Decode', userMessage: 'Set up search on B1 for CAN FD error frames', flowContext: PYVISA_SCOPE_CONTEXT },

  { id: 'L5_SAV_01', level: 'Level 5 - Save / Recall', userMessage: 'Recall session from C:/tests/baseline.tss then add frequency measurement on CH1', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L5_SAV_02', level: 'Level 5 - Save / Recall', userMessage: 'Save setup to C:/setups/test.set and take a screenshot', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L5_SAV_03', level: 'Level 5 - Save / Recall', userMessage: 'Enable FastFrame 100 frames single sequence then save CH1 waveform', flowContext: PYVISA_SCOPE_CONTEXT },

  { id: 'L6_TMD_01', level: 'Level 6 - tm_devices', userMessage: 'Set CH1 scale to 200mV and offset to 0 using tm_devices', flowContext: TM_DEVICES_SCOPE_CONTEXT },
  { id: 'L6_TMD_02', level: 'Level 6 - tm_devices', userMessage: 'Configure edge trigger CH1 rising 1V using tm_devices', flowContext: TM_DEVICES_SCOPE_CONTEXT },

  { id: 'L7_CPX_01', level: 'Level 7 - Complex Multi-step', userMessage: 'Set CH1 1V DC 50ohm edge trigger rising 0.5V normal mode single acquisition add frequency amplitude pk2pk query all results save waveform and screenshot', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L7_CPX_02', level: 'Level 7 - Complex Multi-step', userMessage: 'Reset scope, set CH1 500mV DC 50ohm, set CH2 1V AC, add frequency on CH1, run single sequence, save screenshot', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L7_CPX_03', level: 'Level 7 - Complex Multi-step', userMessage: 'Recall session from C:/tests/baseline.tss, add amplitude on CH1, query result, save waveform and screenshot', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L7_CPX_04', level: 'Level 7 - Complex Multi-step', userMessage: 'Set up CAN FD on B1 source CH2 500kbps ISO standard, set edge trigger on CH2 rising 1.65V, save screenshot', flowContext: PYVISA_SCOPE_CONTEXT },

  { id: 'L8_ENG_01', level: 'Level 8 - Engineering / Technical', userMessage: 'Power rail check: set CH1 50mV DC 50ohm, add mean RMS pk2pk high low on CH1, query results', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_02', level: 'Level 8 - Engineering / Technical', userMessage: 'Power rail check: add positive overshoot on CH1 and frequency on CH2, query both, save CH1 waveform as CSV', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_03', level: 'Level 8 - Engineering / Technical', userMessage: 'CAN FD decode on B1 source CH2 500kbps nominal 2Mbps data phase ISO standard', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_04', level: 'Level 8 - Engineering / Technical', userMessage: 'Search on B1 for CAN FD error frames and query FastFrame timestamps for all frames', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_05', level: 'Level 8 - Engineering / Technical', userMessage: 'Set CH1 and CH2 to 3.3V DC 1Mohm and configure I2C decode on B1 with CH1 clock and CH2 data at 1.65V thresholds', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_06', level: 'Level 8 - Engineering / Technical', userMessage: 'Add setup time measurement between CH1 falling and CH2 falling edges', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_07', level: 'Level 8 - Engineering / Technical', userMessage: 'Add hold time measurement between CH2 falling and CH1 rising edges', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_08', level: 'Level 8 - Engineering / Technical', userMessage: 'Set horizontal scale to 500ps per div and record length to 10 million samples', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_09', level: 'Level 8 - Engineering / Technical', userMessage: 'Enable fast acquisition with temperature palette and save screenshot of eye diagram', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_10', level: 'Level 8 - Engineering / Technical', userMessage: 'Set CH4 to 2V DC 1Mohm, trigger on CH4 rising at 1V normal mode, single acquisition', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_11', level: 'Level 8 - Engineering / Technical', userMessage: 'Add delay measurement from CH4 rising to CH1 crossing 100mV', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_12', level: 'Level 8 - Engineering / Technical', userMessage: 'Add delay measurement from CH4 rising to CH2 crossing 250mV and from CH4 rising to CH3 crossing 500mV', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'L8_ENG_13', level: 'Level 8 - Engineering / Technical', userMessage: 'Save all 4 channels as binary waveforms and take a screenshot', flowContext: PYVISA_SCOPE_CONTEXT },
  { id: 'AFG01', level: 'Level 9 - AFG', userMessage: 'Set sine wave 1kHz 2Vpp 50ohm output on', flowContext: PYVISA_AFG_CONTEXT },
  { id: 'SMU01', level: 'Level 10 - SMU', userMessage: 'Source 3.3V current limit 100mA output on then measure current', flowContext: PYVISA_SMU_CONTEXT },
];
