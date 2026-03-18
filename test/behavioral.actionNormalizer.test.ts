import { normalizeActionsJsonPayload } from '../src/core/actionNormalizer';

describe('behavioral.actionNormalizer', () => {
  it('normalizes common assistant param drift in replace_flow actions', () => {
    const normalized = normalizeActionsJsonPayload({
      summary: 'Normalize drift.',
      findings: [],
      suggestedFixes: [],
      actions: [
        {
          action_type: 'replace_flow',
          flow: {
            name: 'Generated Flow',
            description: 'Server-normalized flow',
            backend: 'pyvisa',
            deviceType: 'SCOPE',
            steps: [
              { id: '1', type: 'connect', name: 'Connect scope', params: { instrumentId: 'scope1' } },
              { id: '2', type: 'query', title: 'Query IDN', params: { query: '*IDN?' } },
              { id: '3', type: 'sleep', params: { seconds: '2' } },
              { id: '4', type: 'save_screenshot', params: { file_path: 'C:/Temp/capture.png' } },
              { id: '5', type: 'save_waveform', name: 'Save CH2 WFM', params: { file_path: 'C:/Temp/CH2.wfm' } },
              { id: '6', type: 'disconnect', params: {} },
            ],
          },
        },
      ],
    });

    const flow = (normalized.actions as Array<Record<string, unknown>>)[0].flow as Record<string, unknown>;
    const steps = flow.steps as Array<Record<string, unknown>>;

    expect(steps[0]).toMatchObject({
      type: 'connect',
      label: 'Connect scope',
      params: { instrumentIds: ['scope1'], printIdn: true },
    });
    expect(steps[1]).toMatchObject({
      type: 'query',
      label: 'Query IDN',
      params: { command: '*IDN?', saveAs: 'idn' },
    });
    expect(steps[2]).toMatchObject({
      type: 'sleep',
      params: { duration: 2 },
    });
    expect(steps[3]).toMatchObject({
      type: 'save_screenshot',
      params: { filename: 'capture.png', scopeType: 'modern', method: 'pc_transfer' },
    });
    expect(steps[4]).toMatchObject({
      type: 'save_waveform',
      label: 'Save CH2 WFM',
      params: { source: 'CH2', filename: 'CH2.wfm', format: 'wfm' },
    });
    expect(steps[5]).toMatchObject({
      type: 'disconnect',
      params: { instrumentIds: [] },
    });
  });
});
