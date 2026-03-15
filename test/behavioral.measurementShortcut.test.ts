import { describe, expect, it } from 'vitest';
import { runToolLoop } from '../src/core/toolLoop';

describe('behavioral.measurementShortcut', () => {
  it('short-circuits a standard multi-measurement CH1 request without tool calls', async () => {
    const result = await runToolLoop({
      userMessage: 'Add frequency, amplitude, pk2pk, mean, rms, and positive overshoot measurements on CH1 and keep any existing scope measurements.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5-mini',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO6B',
        deviceType: 'SCOPE',
        steps: [
          { id: '1', type: 'connect', params: {} },
          { id: '2', type: 'save_screenshot', params: { filename: 'scope.png', scopeType: 'modern', method: 'pc_transfer' } },
          { id: '3', type: 'disconnect', params: {} },
        ],
        selectedStepId: null,
        executionSource: 'steps',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
      history: [],
    });

    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.toolCalls).toBe(0);
    expect(result.text).toContain('MEASUrement:ADDMEAS FREQUENCY');
    expect(result.text).toContain('MEASUrement:ADDMEAS PK2PK');
    expect(result.text).toContain('MEASUrement:ADDMEAS RMS');
    expect(result.text).not.toContain('search_scpi');
  });

  it('uses a default 6-measurement set when the user asks for six CH1 measurements without naming each one', async () => {
    const result = await runToolLoop({
      userMessage: 'Add 6 measurements on channel 1 and do not overwrite existing measurements already on the scope.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5-mini',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO6B',
        deviceType: 'SCOPE',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
      history: [],
    });

    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.text).toContain('MEASUrement:ADDMEAS FREQUENCY');
    expect(result.text).toContain('MEASUrement:ADDMEAS AMPLITUDE');
    expect(result.text).toContain('MEASUrement:ADDMEAS PK2PK');
    expect(result.text).toContain('MEASUrement:ADDMEAS MEAN');
    expect(result.text).toContain('MEASUrement:ADDMEAS RMS');
    expect(result.text).toContain('MEASUrement:ADDMEAS POVERSHOOT');
  });
});
