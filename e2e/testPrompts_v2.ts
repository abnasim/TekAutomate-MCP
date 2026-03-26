/**
 * TekAutomate AI Test Prompts v2
 * 20 cases — Steps UI (TC01-TC14) + Blockly XML (BL01-BL06)
 *
 * Coverage derived from uploaded template files:
 *   basic.json, screenshot.json, tm_devices.json,
 *   multi_device.json, tekexpress.json, advanced.json
 *
 * NOTE: Templates not fully validated yet — these prompts test
 * what the AI should produce, not what templates currently show.
 */

export interface TestPrompt {
  id: string;
  outputMode: 'steps_json' | 'blockly_xml';
  prompt: string;
  backend: string;
  modelFamily: string;
  stepValidation?: {
    mustHaveStepTypes?: string[];
    mustHaveCommands?: string[];
    mustNotHaveCommands?: string[];
    allowRawWaveformSave?: boolean;
    minStepCount?: number;
  };
  xmlValidation?: {
    mustHaveBlocks?: string[];
    mustNotHaveBlocks?: string[];
    mustHaveFields?: string[];
  };
  notes?: string;
}

export const TEST_PROMPTS_V2: TestPrompt[] = [

  // ── STEPS UI — TC01-TC14 ──────────────────────────────────────────────────

  {
    id: 'TC01',
    outputMode: 'steps_json',
    prompt: 'Connect to scope, query IDN and options, then disconnect',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['connect', 'query', 'disconnect'],
      mustHaveCommands: ['*IDN?', '*OPT?'],
      minStepCount: 4,
    },
    notes: 'Hello Scope pattern — most basic smoke test',
  },

  {
    id: 'TC02',
    outputMode: 'steps_json',
    prompt: 'Add FastFrame commands for 50 frames on CH1 and CH3',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write'],
      mustHaveCommands: ['HORizontal:FASTframe:STATE ON', 'HORizontal:FASTframe:COUNt 50'],
      minStepCount: 3,
    },
  },

  {
    id: 'TC03',
    outputMode: 'steps_json',
    prompt: 'Add frequency and amplitude measurements on CH1 using MEASUrement:ADDMEAS, save results to variables',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write', 'query'],
      mustHaveCommands: ['MEASUrement:ADDMEAS FREQUENCY', 'MEASUrement:ADDMEAS AMPLITUDE'],
      mustNotHaveCommands: ['DPOJET', 'IMMed:TYPe'],
      minStepCount: 5,
    },
    notes: 'Must use ADDMEAS not DPOJET. FREQUENCY not FREQ for this scope.',
  },

  {
    id: 'TC04',
    outputMode: 'steps_json',
    prompt: 'Add a screenshot step for an MSO5/6 scope, save to capture.png',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['save_screenshot'],
      mustNotHaveCommands: ['HARDCopy', 'SAVE:IMAGe'],
      minStepCount: 3,
    },
    notes: 'Must use save_screenshot step type with scopeType: modern. Never raw SCPI.',
  },

  {
    id: 'TC05',
    outputMode: 'steps_json',
    prompt: 'Save CH1 waveform to a .wfm file called ch1_capture.wfm',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['save_waveform'],
      allowRawWaveformSave: true,
      minStepCount: 3,
    },
    notes: 'Must use save_waveform step type not raw SCPI.',
  },

  {
    id: 'TC06',
    outputMode: 'steps_json',
    prompt: 'Load session file from C:/tests/demo.tss, wait 1 second for the scope to settle, then check for errors',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['recall', 'sleep', 'error_check'],
      minStepCount: 5,
    },
    notes: 'SESSION recall type, .tss extension. error_check with ALLEV?',
  },

  {
    id: 'TC07',
    outputMode: 'steps_json',
    prompt: 'Set up a single sequence acquisition, wait for OPC, then query the result',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write', 'query'],
      mustHaveCommands: ['ACQuire', '*OPC?'],
      minStepCount: 4,
    },
  },

  {
    id: 'TC08',
    outputMode: 'steps_json',
    prompt: 'Set CH1 scale to 1V, CH2 scale to 500mV, both DC coupling, horizontal scale 1us',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write'],
      mustHaveCommands: ['CH1:SCAle', 'CH2:SCAle', 'HORizontal:SCAle'],
      minStepCount: 5,
    },
  },

  {
    id: 'TC09',
    outputMode: 'steps_json',
    prompt: 'Set up edge trigger on CH1 at 1V threshold, rising edge, normal trigger mode',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write'],
      mustHaveCommands: ['TRIGger:A', 'CH1'],
      minStepCount: 4,
    },
  },

  {
    id: 'TC10',
    outputMode: 'steps_json',
    prompt: 'Set up CAN bus decode on B1 using CAN FD standard, 500kbps, data source CH2',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write'],
      mustHaveCommands: ['BUS:B1', 'CAN', 'CH2'],
      minStepCount: 4,
    },
    notes: 'Tests Bus group routing. Must call get_command_group first.',
  },

  {
    id: 'TC11',
    outputMode: 'steps_json',
    prompt: 'Set horizontal scale to 1ms per division, record length to 1M points, then start acquisition',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write'],
      mustHaveCommands: ['HORizontal:SCAle', 'HORizontal:RECOrdlength'],
      minStepCount: 4,
    },
  },

  {
    id: 'TC12',
    outputMode: 'steps_json',
    prompt: 'Add frequency, amplitude, and rise time measurements on CH1, read all three results into separate variables',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write', 'query'],
      mustHaveCommands: ['MEASUrement:ADDMEAS'],
      mustNotHaveCommands: ['DPOJET'],
      minStepCount: 8,
    },
  },

  {
    id: 'TC13',
    outputMode: 'steps_json',
    prompt: [
      'Create a full capture workflow for an MSO6B:',
      'connect, activate CH1 and CH3,',
      'enable FastFrame for 50 frames,',
      'single sequence acquisition,',
      'save screenshot,',
      'save CH1 waveform as ch1.wfm,',
      'then disconnect',
    ].join(' '),
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['write', 'save_screenshot', 'save_waveform', 'disconnect'],
      mustHaveCommands: ['HORizontal:FASTframe:STATE ON', 'HORizontal:FASTframe:COUNt 50'],
      mustNotHaveCommands: ['HARDCopy'],
      allowRawWaveformSave: true,
      minStepCount: 8,
    },
    notes: 'Full capture flow — most complex Steps UI test.',
  },

  {
    id: 'TC14',
    outputMode: 'steps_json',
    prompt: [
      'Save all waveforms as .wfm files for CH1, CH2, CH3, CH4,',
      'save the scope setup,',
      'take a screenshot,',
      'zip everything into session.tss,',
      'save to C:/TekCapture/',
    ].join(' '),
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    stepValidation: {
      mustHaveStepTypes: ['save_waveform', 'save_screenshot', 'python'],
      mustNotHaveCommands: ['${'],
      allowRawWaveformSave: true,
      minStepCount: 8,
    },
    notes: 'Session .tss workaround. Python block must contain zipfile and .tss rename.',
  },

  // ── BLOCKLY XML — BL01-BL06 ──────────────────────────────────────────────

  {
    id: 'BL01',
    outputMode: 'blockly_xml',
    prompt: 'Create a Blockly flow to connect to scope, query IDN, and disconnect',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    xmlValidation: {
      mustHaveBlocks: ['connect_scope', 'scpi_query', 'disconnect'],
      mustHaveFields: ['DEVICE_NAME', 'VARIABLE'],
    },
    notes: 'Hello Scope in Blockly. Must have xmlns, unique IDs, root x/y.',
  },

  {
    id: 'BL02',
    outputMode: 'blockly_xml',
    prompt: 'Create a Blockly flow: connect to scope, set CH1 scale to 1V DC coupling, do single acquisition, wait for OPC, save waveform to ch1.csv, disconnect',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    xmlValidation: {
      mustHaveBlocks: ['connect_scope', 'configure_channel', 'single_acquisition', 'wait_for_opc', 'save_waveform', 'disconnect'],
      mustHaveFields: ['CHANNEL', 'SCALE', 'SOURCE', 'FILENAME', 'FORMAT'],
    },
    notes: 'Basic Scope Setup pattern from template. Tests full Blockly block chain.',
  },

  {
    id: 'BL03',
    outputMode: 'blockly_xml',
    prompt: 'Create a Blockly screenshot flow for a legacy 5k/7k/70k scope: connect, query IDN, capture screenshot as dpo5k.png, disconnect',
    backend: 'pyvisa',
    modelFamily: 'MSO_DPO_5k',
    xmlValidation: {
      mustHaveBlocks: ['connect_scope', 'scpi_query', 'save_screenshot', 'disconnect'],
      mustHaveFields: ['SCOPE_TYPE', 'FILENAME'],
    },
    notes: 'Legacy screenshot. SCOPE_TYPE must be LEGACY not MODERN.',
  },

  {
    id: 'BL04',
    outputMode: 'blockly_xml',
    prompt: 'Create a Blockly flow using tm_devices backend to connect to MSO6B, configure CH1 at 1V 50 ohm, single acquisition, save waveform as WFM format, disconnect',
    backend: 'tm_devices',
    modelFamily: 'MSO6B',
    xmlValidation: {
      mustHaveBlocks: ['connect_scope', 'configure_channel', 'single_acquisition', 'save_waveform', 'disconnect'],
      mustHaveFields: ['BACKEND', 'DRIVER_NAME', 'TERMINATION'],
    },
    notes: 'tm_devices Scope Setup pattern. BACKEND=tm_devices, DRIVER_NAME=MSO6B.',
  },

  {
    id: 'BL05',
    outputMode: 'blockly_xml',
    prompt: [
      'Create a Blockly voltage sweep workflow using tm_devices:',
      'connect scope and SMU,',
      'loop voltage from 1 to 5V,',
      'for each voltage set SMU output, do single acquisition on scope,',
      'measure peak-to-peak on CH1,',
      'then disconnect both devices',
    ].join(' '),
    backend: 'tm_devices',
    modelFamily: 'MSO6B',
    xmlValidation: {
      mustHaveBlocks: ['connect_scope', 'controls_for', 'single_acquisition', 'measurement_immediate', 'disconnect'],
      mustHaveFields: ['VAR', 'FROM', 'TO', 'TYPE', 'SOURCE', 'VARIABLE'],
    },
    notes: 'Multi-device Voltage Sweep pattern. Two connect_scope blocks (scope + SMU).',
  },

  {
    id: 'BL06',
    outputMode: 'blockly_xml',
    prompt: 'Create a Blockly recall flow: connect to scope, recall session file C:/tests/baseline.tss, wait 1 second, capture screenshot as post_recall.png, disconnect',
    backend: 'pyvisa',
    modelFamily: 'MSO6B',
    xmlValidation: {
      mustHaveBlocks: ['connect_scope', 'recall', 'wait_seconds', 'save_screenshot', 'disconnect'],
      mustHaveFields: ['RECALL_TYPE', 'FILE_PATH', 'SCOPE_TYPE', 'FILENAME'],
    },
    notes: 'Recall SESSION type (.tss). Tests recall block field spec from policy fix.',
  },

];

// ── Validation helpers ────────────────────────────────────────────────────────

export function validateStepsOutput(
  steps: Array<{ type: string; params: Record<string, unknown>; label?: string }>,
  validation: TestPrompt['stepValidation']
): string[] {
  const errors: string[] = [];
  if (!validation) return errors;

  const types = steps.map(s => s.type);
  const allJson = JSON.stringify(steps);
  const allJsonLower = allJson.toLowerCase();

  // Structure checks
  if (types[0] !== 'connect') errors.push('First step must be connect');
  if (types[types.length - 1] !== 'disconnect') errors.push('Last step must be disconnect');

  // Query steps must have saveAs
  for (const step of steps) {
    if (step.type === 'query') {
      const p = step.params as Record<string, unknown>;
      if (!p.saveAs && !p.outputVariable) {
        errors.push(`Query step missing saveAs: ${step.label || JSON.stringify(step.params)}`);
      }
    }
  }

  // Required step types
  if (validation.mustHaveStepTypes) {
    for (const t of validation.mustHaveStepTypes) {
      if (t === 'save_waveform' && validation.allowRawWaveformSave) {
        const hasWaveformStep = types.includes('save_waveform');
        const hasRawWaveformSave = allJson.includes('SAVe:WAVEform');
        if (!hasWaveformStep && !hasRawWaveformSave) {
          errors.push('Missing required step type: save_waveform');
        }
        continue;
      }
      if (!types.includes(t)) errors.push(`Missing required step type: ${t}`);
    }
  }

  // Required commands (partial match)
  if (validation.mustHaveCommands) {
    for (const cmd of validation.mustHaveCommands) {
      if (!allJsonLower.includes(cmd.toLowerCase())) errors.push(`Missing required command: ${cmd}`);
    }
  }

  // Forbidden commands
  if (validation.mustNotHaveCommands) {
    for (const cmd of validation.mustNotHaveCommands) {
      if (allJsonLower.includes(cmd.toLowerCase())) errors.push(`Forbidden command present: ${cmd}`);
    }
  }

  // Min step count
  if (validation.minStepCount && steps.length < validation.minStepCount) {
    errors.push(`Too few steps: ${steps.length} < ${validation.minStepCount}`);
  }

  return errors;
}

export function validateBlocklyOutput(
  xml: string,
  validation: TestPrompt['xmlValidation']
): string[] {
  const errors: string[] = [];
  if (!validation) return errors;

  // Must have xmlns
  if (!xml.includes('xmlns="https://developers.google.com/blockly/xml"')) {
    errors.push('Missing required xmlns attribute');
  }

  // Required block types
  if (validation.mustHaveBlocks) {
    for (const block of validation.mustHaveBlocks) {
      if (!xml.includes(`type="${block}"`)) {
        errors.push(`Missing required block type: ${block}`);
      }
    }
  }

  // Forbidden blocks
  if (validation.mustNotHaveBlocks) {
    for (const block of validation.mustNotHaveBlocks) {
      if (xml.includes(`type="${block}"`)) {
        errors.push(`Forbidden block type present: ${block}`);
      }
    }
  }

  // Required fields
  if (validation.mustHaveFields) {
    for (const field of validation.mustHaveFields) {
      if (!xml.includes(`name="${field}"`)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Root block must have x and y
  if (!xml.match(/x="\d+" y="\d+"/)) {
    errors.push('Root block missing x/y position attributes');
  }

  // Check for group/comment/error_check in Blockly (not valid)
  for (const forbidden of ['type="group"', 'type="comment"', 'type="error_check"']) {
    if (xml.includes(forbidden)) {
      errors.push(`Invalid Blockly block: ${forbidden} (Steps UI only)`);
    }
  }

  return errors;
}
