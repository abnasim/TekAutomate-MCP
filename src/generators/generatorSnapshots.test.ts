/**
 * B: Python Output Snapshot Regression
 *
 * Saves known-good Python output for representative scenarios.
 * If the generator changes, snapshots must be explicitly updated.
 * This catches accidental regressions in formatting, imports, structure.
 */
/// <reference types="jest" />

import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from './stepToPython';

const cfg: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

describe('B: Python output snapshot regression', () => {
  it('empty steps → structural skeleton', () => {
    const code = generatePythonFromSteps([], cfg);
    expect(code).toMatchSnapshot();
  });

  it('single write step', () => {
    const code = generatePythonFromSteps([
      { id: '1', type: 'write', params: { command: 'ACQ:STATE RUN' } },
    ], cfg);
    expect(code).toMatchSnapshot();
  });

  it('single query with saveAs', () => {
    const code = generatePythonFromSteps([
      { id: '1', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
    ], cfg);
    expect(code).toMatchSnapshot();
  });

  it('realistic multi-step sequence', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'comment', params: { text: 'Configure acquisition' } },
      { id: '2', type: 'write', params: { command: 'ACQ:STATE STOP' } },
      { id: '3', type: 'write', params: {
        command: 'CH{ch}:SCALE {scale}',
        cmdParams: [{ name: 'ch', default: '1' }, { name: 'scale' }],
        paramValues: { ch: 1, scale: 0.5 },
      }},
      { id: '4', type: 'query', params: { command: '*OPC?', saveAs: 'opc' } },
      { id: '5', type: 'sleep', params: { duration: 1 } },
      { id: '6', type: 'write', params: { command: 'ACQ:STATE RUN' } },
      { id: '7', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
    ];
    const code = generatePythonFromSteps(steps, cfg);
    expect(code).toMatchSnapshot();
  });

  it('set_and_query step', () => {
    const code = generatePythonFromSteps([{
      id: '1', type: 'set_and_query', params: {
        command: 'CH1:SCALE',
        cmdParams: [],
        paramValues: { value: '2.0' },
        saveAs: 'verified',
      },
    }], cfg);
    expect(code).toMatchSnapshot();
  });

  it('nested groups', () => {
    const steps: GeneratorStep[] = [{
      id: 'g1', type: 'group', label: 'Outer', params: {},
      children: [
        { id: '1', type: 'write', params: { command: '*RST' } },
        {
          id: 'g2', type: 'group', label: 'Inner', params: {},
          children: [
            { id: '2', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
            { id: '3', type: 'sleep', params: { duration: 0.5 } },
          ],
        },
      ],
    }];
    const code = generatePythonFromSteps(steps, cfg);
    expect(code).toMatchSnapshot();
  });

  it('python snippet step', () => {
    const code = generatePythonFromSteps([{
      id: '1', type: 'python', params: { code: 'data = idn.split(",")\nprint(f"Model: {data[1]}")' },
    }], cfg);
    expect(code).toMatchSnapshot();
  });

  it('socket connection type', () => {
    const code = generatePythonFromSteps([
      { id: '1', type: 'write', params: { command: '*RST' } },
    ], { ...cfg, connectionType: 'socket', port: 5025 });
    expect(code).toMatchSnapshot();
  });

  it('USB connection type', () => {
    const code = generatePythonFromSteps([], {
      ...cfg, connectionType: 'usb',
      usbVendorId: '0x0699', usbProductId: '0x0368', usbSerial: 'C012345',
    });
    expect(code).toMatchSnapshot();
  });

  it('GPIB connection type', () => {
    const code = generatePythonFromSteps([], {
      ...cfg, connectionType: 'gpib', gpibBoard: 0, gpibAddress: 7,
    });
    expect(code).toMatchSnapshot();
  });

  it('with enablePrintMessages option', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'write', label: 'Reset', params: { command: '*RST' } },
      { id: '2', type: 'query', label: 'Get IDN', params: { command: '*IDN?', saveAs: 'idn' } },
      { id: '3', type: 'sleep', label: 'Wait', params: { duration: 1 } },
    ];
    const code = generatePythonFromSteps(steps, cfg, { enablePrintMessages: true });
    expect(code).toMatchSnapshot();
  });
});
