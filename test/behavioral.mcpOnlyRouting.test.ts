import { describe, expect, it } from 'vitest';
import { runToolLoop } from '../src/core/toolLoop';

describe('behavioral.mcpOnlyRouting', () => {
  it('keeps MCP-only SCPI result queries on the deterministic smart SCPI path', async () => {
    const result = await runToolLoop({
      userMessage: 'query power harmonics results',
      outputMode: 'steps_json',
      mode: 'mcp_only',
      provider: 'openai',
      apiKey: '__mcp_only__',
      model: 'gpt-5.4',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
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

    expect(result.metrics?.usedShortcut).toBe(false);
    expect((result.debug as { resolutionPath?: string } | undefined)?.resolutionPath).toContain('deterministic:smart_scpi');
    expect(result.text).toContain('POWer:POWer<x>:RESUlts:CURRentacq:FREQUENCY');
  });
});
