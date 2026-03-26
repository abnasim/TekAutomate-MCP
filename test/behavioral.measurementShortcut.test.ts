import { describe, expect, it } from 'vitest';
import { runToolLoop } from '../src/core/toolLoop';

describe('behavioral.measurementShortcut', () => {
  it('keeps MCP-only measurement requests on the deterministic smart scpi path without needing an API key', async () => {
    const result = await runToolLoop({
      userMessage: 'Add frequency, amplitude, pk2pk, mean, rms, and positive overshoot measurements on CH1 and keep any existing scope measurements.',
      outputMode: 'steps_json',
      mode: 'mcp_only',
      provider: 'openai',
      apiKey: '',
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

    expect(result.errors).toEqual([]);
    expect(result.metrics?.usedShortcut).toBe(false);
    expect((result.debug as { resolutionPath?: string } | undefined)?.resolutionPath).toContain('deterministic:smart_scpi');
    expect(result.text).toContain('MEASUrement:ADDMEAS');
    expect(result.text).toContain('FREQUENCY');
    expect(result.text).not.toContain('Incorrect API key');
  });

  it('does not require a hosted provider key for MCP-only measurement lookup prompts', async () => {
    const result = await runToolLoop({
      userMessage: 'Add 6 measurements on channel 1 and do not overwrite existing measurements already on the scope.',
      outputMode: 'steps_json',
      mode: 'mcp_only',
      provider: 'openai',
      apiKey: '',
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

    expect(result.errors).toEqual([]);
    expect(result.metrics?.usedShortcut).toBe(false);
    expect((result.debug as { resolutionPath?: string } | undefined)?.resolutionPath).toContain('deterministic:smart_scpi');
    expect(result.text).toContain('MEASUrement:ADDMEAS');
    expect(result.text).not.toContain('Incorrect API key');
  });
});
