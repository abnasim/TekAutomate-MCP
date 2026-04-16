/// <reference types="jest" />

import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from './stepToPython';

const tcpipConfig: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

describe('snapshot regression', () => {
  it('empty script', () => {
    const code = generatePythonFromSteps([], tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('single write', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'write', params: { command: 'CH1:SCALE 1.0' } },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('single query', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('write + query + sleep sequence', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'write', params: { command: 'CH1:SCALE 1.0' } },
      { id: '2', type: 'query', params: { command: '*IDN?', saveAs: 'idn' } },
      { id: '3', type: 'sleep', params: { duration: 0.5 } },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('nested group', () => {
    const steps: GeneratorStep[] = [
      {
        id: 'g1',
        type: 'group',
        label: 'Acquisition Setup',
        children: [
          { id: '1', type: 'write', params: { command: 'ACQ:STATE OFF' } },
          { id: '2', type: 'query', params: { command: '*OPC?', saveAs: 'opc' } },
          { id: '3', type: 'write', params: { command: 'ACQ:STATE ON' } },
        ],
      },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('set_and_query', () => {
    const steps: GeneratorStep[] = [
      {
        id: '1',
        type: 'set_and_query',
        params: {
          command: 'CH1:SCALE',
          paramValues: { value: '1.0' },
          saveAs: 'scale_val',
        },
      },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('python snippet', () => {
    const steps: GeneratorStep[] = [
      {
        id: '1',
        type: 'python',
        params: { code: 'print(f"Scale: {scale_val}")\nresult = scale_val.strip()' },
      },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('comment step', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'comment', params: { text: 'Configure acquisition' } },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('parameter substitution', () => {
    const steps: GeneratorStep[] = [
      {
        id: '1',
        type: 'write',
        params: {
          command: 'OUTPut{ch}:STATe {state}',
          cmdParams: [{ name: 'ch' }, { name: 'state' }],
          paramValues: { ch: 1, state: 'ON' },
        },
      },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('socket connection', () => {
    const config: GeneratorConfig = {
      backend: 'pyvisa',
      host: '10.0.0.1',
      port: 5025,
      connectionType: 'socket',
      timeout: 5000,
    };
    const code = generatePythonFromSteps([], config);
    expect(code).toMatchSnapshot();
  });

  it('USB connection', () => {
    const config: GeneratorConfig = {
      backend: 'pyvisa',
      connectionType: 'usb',
      usbVendorId: '0x0699',
      usbProductId: '0x0527',
      timeout: 5000,
    };
    const code = generatePythonFromSteps([], config);
    expect(code).toMatchSnapshot();
  });

  it('GPIB connection', () => {
    const config: GeneratorConfig = {
      backend: 'pyvisa',
      connectionType: 'gpib',
      gpibBoard: 0,
      gpibAddress: 5,
      timeout: 5000,
    };
    const code = generatePythonFromSteps([], config);
    expect(code).toMatchSnapshot();
  });

  it('full realistic workflow', () => {
    const steps: GeneratorStep[] = [
      { id: '1', type: 'write', params: { command: 'ACQ:STATE OFF' } },
      { id: '2', type: 'query', params: { command: '*OPC?', saveAs: '_' } },
      { id: '3', type: 'sleep', params: { duration: 0.2 } },
      { id: '4', type: 'write', params: { command: 'DATA:SOURCE CH1' } },
      { id: '5', type: 'write', params: { command: 'DATA:START 1' } },
      { id: '6', type: 'write', params: { command: 'DATA:STOP 10000' } },
      { id: '7', type: 'query', params: { command: 'CURVE?', saveAs: 'waveform_data' } },
      { id: '8', type: 'write', params: { command: 'ACQ:STATE ON' } },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('deeply nested groups', () => {
    const steps: GeneratorStep[] = [
      {
        id: 'g1',
        type: 'group',
        label: 'Outer',
        children: [
          {
            id: 'g2',
            type: 'group',
            label: 'Inner',
            children: [
              { id: '1', type: 'write', params: { command: 'CH1:SCALE 1.0' } },
            ],
          },
        ],
      },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });

  it('multiple param substitutions', () => {
    const steps: GeneratorStep[] = [
      {
        id: '1',
        type: 'write',
        params: {
          command: 'SOURce{ch}:FREQuency:FIXed {freq}',
          cmdParams: [{ name: 'ch' }, { name: 'freq' }],
          paramValues: { ch: 1, freq: '1000000' },
        },
      },
    ];
    const code = generatePythonFromSteps(steps, tcpipConfig);
    expect(code).toMatchSnapshot();
  });
});
