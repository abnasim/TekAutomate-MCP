import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/core/contextBuilder';

describe('behavioral.contextBuilder', () => {
  it('uses planner output instead of raw search preload', async () => {
    const context = await buildContext({
      userMessage:
        'Set CH1 1V DC 50ohm, edge trigger CH1 rising 0.5V normal mode, single acquisition, add frequency amplitude pk2pk on CH1, save waveform and screenshot',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test',
      model: 'gpt-test',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(context).toContain('## PLANNER RESOLVED — USE THESE EXACT COMMANDS');
    expect(context).toContain('MEASUrement:MEAS1:SOUrce1 CH1');
    expect(context).toContain('## BUILT-IN STEP TYPES — USE THESE FOR SAVE/RECALL');
    expect(context).not.toContain('## MATCHED SCPI COMMANDS');
    expect(context).not.toContain('## MATCHED TM_DEVICES PATHS');
  });
});
