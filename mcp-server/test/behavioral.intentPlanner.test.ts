import { describe, expect, it } from 'vitest';
import { getCommandFile, parseIntent, planIntent, resolveIntent } from '../src/core/intentPlanner';

describe('behavioral.intentPlanner', () => {
  it('parses the scope sample into the expected planner shape', async () => {
    const intent = await parseIntent({
      userMessage:
        'Set CH1 1V DC 50ohm, edge trigger CH1 rising 0.5V normal mode, single acquisition, add frequency amplitude pk2pk on CH1, save waveform and screenshot',
    });

    expect(intent).toMatchObject({
      deviceType: 'SCOPE',
      groups: ['CHANNEL_SETUP', 'TRIGGER', 'MEASUREMENT', 'ACQUISITION', 'SAVE', 'WAVEFORM_TRANSFER'],
      channels: [{ channel: 'CH1', scaleVolts: 1, coupling: 'DC', terminationOhms: 50 }],
      trigger: {
        type: 'EDGE',
        source: 'CH1',
        slope: 'RISe',
        levelVolts: 0.5,
        mode: 'NORMal',
      },
      measurements: [
        { type: 'FREQUENCY', source1: 'CH1' },
        { type: 'AMPLITUDE', source1: 'CH1' },
        { type: 'PK2Pk', source1: 'CH1' },
      ],
      acquisition: { stopAfter: 'SEQuence' },
      save: { screenshot: true, waveformSources: ['CH1'], format: 'bin' },
      unresolved: [],
    });
  });

  it('detects command files for each supported device family', () => {
    expect(getCommandFile('AFG', '')).toBe('afg.json');
    expect(getCommandFile('AWG', '')).toBe('awg.json');
    expect(getCommandFile('SMU', '')).toBe('smu.json');
    expect(getCommandFile('RSA', '')).toBe('rsa.json');
    expect(getCommandFile('SCOPE', 'DPO7000')).toBe('MSO_DPO_5k_7k_70K.json');
    expect(getCommandFile('SCOPE', 'MSO58')).toBe('mso_2_4_5_6_7.json');
  });

  it('resolves scope commands with full record metadata', async () => {
    const output = await resolveIntent({
      userMessage:
        'Set CH1 1V DC 50ohm, edge trigger CH1 rising 0.5V normal mode, single acquisition, add frequency amplitude pk2pk on CH1, save waveform and screenshot',
      flowContext: {
        modelFamily: 'MSO4/5/6 Series',
        deviceType: 'SCOPE',
      },
    });

    expect(output.resolvedCommands.length).toBeGreaterThan(0);
    expect(output.resolvedCommands.every((command) => command.verified)).toBe(true);
    expect(output.resolvedCommands.every((command) => typeof command.sourceFile === 'string')).toBe(true);
    expect(output.resolvedCommands.some((command) => command.syntax.set || command.syntax.query)).toBe(true);
    expect(output.resolvedCommands.some((command) => command.arguments.length > 0)).toBe(true);
  });

  it('keeps MEAS source assignment between ADDMEAS and result queries', async () => {
    const output = await planIntent({
      userMessage:
        'Set CH1 1V DC 50ohm, edge trigger CH1 rising 0.5V normal mode, single acquisition, add frequency amplitude pk2pk on CH1, save waveform and screenshot',
      flowContext: {
        modelFamily: 'MSO4/5/6 Series',
        deviceType: 'SCOPE',
      },
    });

    const commands = output.resolvedCommands.map((command) => command.concreteCommand);
    expect(commands).toContain('MEASUrement:MEAS1:SOUrce1 CH1');
    expect(commands).toContain('MEASUrement:MEAS2:SOUrce1 CH1');
    expect(commands).toContain('MEASUrement:MEAS3:SOUrce1 CH1');
  });

  it('uses SENSe protection commands for SMU compliance', async () => {
    const output = await planIntent({
      userMessage: 'Source 3.3V current limit 100mA output on then measure current',
      flowContext: {
        modelFamily: 'Keithley 2450 SMU',
        deviceType: 'SMU',
      },
    });

    const commands = output.resolvedCommands.map((command) => command.concreteCommand);
    expect(commands).toContain(':SENSe:CURRent:PROTection 0.1');
    expect(commands).not.toContain(':SOURce:VOLTage:ILIMit 0.1');
  });

  it('parses CAN FD error-frame asks as SEARCH intent instead of decode-only intent', async () => {
    const intent = await parseIntent({
      userMessage: 'Search on B1 for CAN FD error frames and query FastFrame timestamps for all frames',
      flowContext: {
        modelFamily: 'MSO4/5/6 Series',
        deviceType: 'SCOPE',
      },
    });

    expect(intent.groups).toContain('SEARCH');
    expect(intent.search).toMatchObject({
      type: 'BUS',
      bus: 'B1',
      protocol: 'CAN',
      searchType: 'ERRFRAME',
      condition: 'FRAMEtype',
      frameType: 'ERRor',
    });
  });

  it('parses overshoot and undershoot measurement wording', async () => {
    const intent = await parseIntent({
      userMessage: 'Add overshoot and undershoot on CH1, then query both results',
      flowContext: {
        modelFamily: 'MSO4/5/6 Series',
        deviceType: 'SCOPE',
      },
    });

    expect(intent.measurements).toEqual([
      { type: 'POVERSHOOT', source1: 'CH1' },
      { type: 'NOVERSHOOT', source1: 'CH1' },
    ]);
  });

  it('parses and resolves channel offset', async () => {
    const output = await planIntent({
      userMessage: 'Set CH1 scale to 200mV and offset to 0',
      flowContext: {
        modelFamily: 'MSO4/5/6 Series',
        deviceType: 'SCOPE',
      },
    });

    const commands = output.resolvedCommands.map((command) => command.concreteCommand);
    expect(commands).toContain('CH1:SCAle 0.2');
    expect(commands).toContain('CH1:OFFSet 0');
  });
});
