/**
 * A: Parameter Exposure & Binding
 *
 * For every step type that accepts params, verify:
 *  - params flow into generated code correctly
 *  - required params left blank produce safe defaults (no crash)
 *  - optional params stay undefined when empty
 *  - multi-param commands substitute all placeholders
 */
/// <reference types="jest" />

import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from './stepToPython';

const cfg: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

const gen = (steps: GeneratorStep[]) => generatePythonFromSteps(steps, cfg);

describe('A: Parameter Exposure & Binding', () => {
  // ─── write step ───
  describe('write step param binding', () => {
    it('simple command without params appears verbatim', () => {
      const code = gen([{ id: '1', type: 'write', params: { command: 'ACQ:STATE RUN' } }]);
      expect(code).toContain('scpi.write("ACQ:STATE RUN")');
    });

    it('single {param} substituted from paramValues', () => {
      const code = gen([{
        id: '1', type: 'write', params: {
          command: 'CH1:SCALE {scale}',
          cmdParams: [{ name: 'scale', default: '1' }],
          paramValues: { scale: 2.5 },
        },
      }]);
      expect(code).toContain('scpi.write("CH1:SCALE 2.5")');
      expect(code).not.toContain('{scale}');
    });

    it('multiple {params} all substituted', () => {
      const code = gen([{
        id: '1', type: 'write', params: {
          command: 'OUTPut{ch}:STATe {state}',
          cmdParams: [{ name: 'ch' }, { name: 'state' }],
          paramValues: { ch: 2, state: 'OFF' },
        },
      }]);
      expect(code).toContain('OUTPut2:STATe OFF');
      expect(code).not.toContain('{ch}');
      expect(code).not.toContain('{state}');
    });

    it('param falls back to default when paramValues is empty', () => {
      const code = gen([{
        id: '1', type: 'write', params: {
          command: 'CH{ch}:SCALE {scale}',
          cmdParams: [{ name: 'ch', default: '1' }, { name: 'scale', default: '1.0' }],
          paramValues: {},
        },
      }]);
      expect(code).toContain('CH1:SCALE 1.0');
    });

    it('param with no default and no value stays as placeholder (safe)', () => {
      const code = gen([{
        id: '1', type: 'write', params: {
          command: 'CH{ch}:SCALE {scale}',
          cmdParams: [{ name: 'ch' }, { name: 'scale' }],
          paramValues: {},
        },
      }]);
      expect(code).toContain('scpi.write(');
    });

    it('case-insensitive param matching works', () => {
      const code = gen([{
        id: '1', type: 'write', params: {
          command: 'OUTPut{CH}:STATe {State}',
          cmdParams: [{ name: 'CH' }, { name: 'State' }],
          paramValues: { ch: 1, state: 'ON' },
        },
      }]);
      expect(code).toContain('OUTPut1:STATe ON');
    });
  });

  // ─── query step ───
  describe('query step param binding', () => {
    it('query command without params', () => {
      const code = gen([{
        id: '1', type: 'query', params: { command: '*IDN?', saveAs: 'idn' },
      }]);
      expect(code).toContain('idn = scpi.query("*IDN?").strip()');
    });

    it('query with {param} substituted', () => {
      const code = gen([{
        id: '1', type: 'query', params: {
          command: 'CH{ch}:SCALE?',
          cmdParams: [{ name: 'ch' }],
          paramValues: { ch: 3 },
          saveAs: 'scale',
        },
      }]);
      expect(code).toContain('scale = scpi.query("CH3:SCALE?").strip()');
      expect(code).not.toContain('{ch}');
    });

    it('query without saveAs defaults to "result"', () => {
      const code = gen([{
        id: '1', type: 'query', params: { command: '*OPT?' },
      }]);
      expect(code).toContain('result = scpi.query("*OPT?").strip()');
    });

    it('query saveAs creates correct variable name', () => {
      const code = gen([{
        id: '1', type: 'query', params: { command: '*IDN?', saveAs: 'my_idn_var' },
      }]);
      expect(code).toContain('my_idn_var = scpi.query("*IDN?").strip()');
      expect(code).toContain('log_cmd("*IDN?", my_idn_var)');
    });
  });

  // ─── set_and_query step ───
  describe('set_and_query step param binding', () => {
    it('set_and_query emits write then query', () => {
      const code = gen([{
        id: '1', type: 'set_and_query', params: {
          command: 'CH1:SCALE',
          cmdParams: [],
          paramValues: { value: '2.0' },
          saveAs: 'verified',
        },
      }]);
      expect(code).toContain('scpi.write("CH1:SCALE 2.0")');
      expect(code).toContain('verified = scpi.query("CH1:SCALE?").strip()');
    });

    it('set_and_query with {param} in command', () => {
      const code = gen([{
        id: '1', type: 'set_and_query', params: {
          command: 'CH{ch}:SCALE',
          cmdParams: [{ name: 'ch' }],
          paramValues: { ch: 2, value: '5.0' },
          saveAs: 'result',
        },
      }]);
      expect(code).toContain('scpi.write("CH2:SCALE 5.0")');
      expect(code).toContain('result = scpi.query("CH2:SCALE?").strip()');
    });

    it('set_and_query with no value param just writes header', () => {
      const code = gen([{
        id: '1', type: 'set_and_query', params: {
          command: 'CH1:SCALE',
          cmdParams: [],
          paramValues: {},
          saveAs: 'r',
        },
      }]);
      expect(code).toContain('scpi.write("CH1:SCALE")');
      expect(code).toContain('r = scpi.query("CH1:SCALE?").strip()');
    });
  });

  // ─── sleep step ───
  describe('sleep step param binding', () => {
    it('duration param flows to time.sleep', () => {
      const code = gen([{ id: '1', type: 'sleep', params: { duration: 1.5 } }]);
      expect(code).toContain('time.sleep(1.5)');
    });

    it('missing duration defaults to 0', () => {
      const code = gen([{ id: '1', type: 'sleep', params: {} }]);
      expect(code).toContain('time.sleep(0)');
    });

    it('string duration coerced to number', () => {
      const code = gen([{ id: '1', type: 'sleep', params: { duration: '3' as unknown as number } }]);
      expect(code).toContain('time.sleep(3)');
    });

    it('NaN duration safely becomes 0', () => {
      const code = gen([{ id: '1', type: 'sleep', params: { duration: 'abc' as unknown as number } }]);
      expect(code).toContain('time.sleep(0)');
    });
  });

  // ─── comment step ───
  describe('comment step param binding', () => {
    it('text param flows to Python comment', () => {
      const code = gen([{ id: '1', type: 'comment', params: { text: 'Setup scope channels' } }]);
      expect(code).toContain('# Setup scope channels');
    });

    it('empty text falls back to label', () => {
      const code = gen([{ id: '1', type: 'comment', label: 'My Note', params: {} }]);
      expect(code).toContain('# My Note');
    });

    it('no text and no label still emits comment', () => {
      const code = gen([{ id: '1', type: 'comment', params: {} }]);
      expect(code).toContain('#');
    });
  });

  // ─── python step ───
  describe('python step param binding', () => {
    it('code param emitted as indented Python', () => {
      const code = gen([{
        id: '1', type: 'python', params: { code: 'x = 42\nprint(x)' },
      }]);
      expect(code).toContain('    x = 42');
      expect(code).toContain('    print(x)');
    });

    it('empty code param produces no output for that step', () => {
      const code = gen([
        { id: '1', type: 'python', params: { code: '' } },
        { id: '2', type: 'write', params: { command: '*RST' } },
      ]);
      expect(code).toContain('scpi.write("*RST")');
    });
  });

  // ─── group step ───
  describe('group step param binding', () => {
    it('group label becomes Python comment', () => {
      const code = gen([{
        id: 'g1', type: 'group', label: 'Acquisition Setup', params: {},
        children: [{ id: '1', type: 'write', params: { command: 'ACQ:STATE ON' } }],
      }]);
      expect(code).toContain('# Group: Acquisition Setup');
      expect(code).toContain('scpi.write("ACQ:STATE ON")');
    });

    it('children params bind independently', () => {
      const code = gen([{
        id: 'g1', type: 'group', label: 'G', params: {},
        children: [
          { id: '1', type: 'write', params: { command: 'CH{ch}:SCALE {s}', cmdParams: [{ name: 'ch' }, { name: 's' }], paramValues: { ch: 1, s: 0.5 } } },
          { id: '2', type: 'query', params: { command: 'CH{ch}:SCALE?', cmdParams: [{ name: 'ch' }], paramValues: { ch: 1 }, saveAs: 'v' } },
        ],
      }]);
      expect(code).toContain('CH1:SCALE 0.5');
      expect(code).toContain('v = scpi.query("CH1:SCALE?").strip()');
    });
  });

  // ─── connection config binding ───
  describe('connection config binding', () => {
    it('TCPIP host flows to resource string', () => {
      const code = gen([]);
      expect(code).toContain('TCPIP::192.168.1.100::INSTR');
    });

    it('socket config flows to resource string', () => {
      const code = generatePythonFromSteps([], { ...cfg, connectionType: 'socket', port: 4000 });
      expect(code).toContain('TCPIP::192.168.1.100::4000::SOCKET');
    });

    it('USB config flows to resource string', () => {
      const code = generatePythonFromSteps([], {
        ...cfg, connectionType: 'usb',
        usbVendorId: '0x0699', usbProductId: '0x0368', usbSerial: 'C012345',
      });
      expect(code).toContain('USB0::0x0699::0x0368::C012345::INSTR');
    });

    it('GPIB config flows to resource string', () => {
      const code = generatePythonFromSteps([], {
        ...cfg, connectionType: 'gpib', gpibBoard: 0, gpibAddress: 5,
      });
      expect(code).toContain('GPIB0::5::INSTR');
    });

    it('timeout flows to argparse default', () => {
      const code = generatePythonFromSteps([], { ...cfg, timeout: 10000 });
      expect(code).toContain('default=10000');
    });
  });
});
