import { assembleAiContext, compressStep } from './contextAssembler';

describe('contextAssembler', () => {
  it('compressStep keeps key flow fields', () => {
    const out = compressStep({
      id: '1',
      type: 'query',
      label: 'Q',
      params: { command: '*IDN?', outputVariable: 'idn', backend: 'pyvisa' },
    });
    expect(out).toMatchObject({
      id: '1',
      type: 'query',
      label: 'Q',
      command: '*IDN?',
      outputVariable: 'idn',
      backend: 'pyvisa',
    });
  });

  it('assembles context with debug token estimate', () => {
    const assembled = assembleAiContext({
      userMessage: 'analyze this flow',
      steps: [{ id: '1', type: 'connect', label: 'Connect' }],
      executionSource: 'steps',
      runStatus: 'done',
      runLog: 'Exit code: 0',
      code: 'print("ok")',
      history: [{ role: 'user', content: 'hello', timestamp: 1 }],
      retrievedChunksByCorpus: {
        scpi: [{ id: 'c1', corpus: 'scpi', title: 'IDN', body: '*IDN?', tags: [] }],
      },
    });
    expect(assembled.systemPrompt).toContain('Hard constraints');
    expect(assembled.userPrompt).toContain('Live flow (compressed)');
    expect(assembled.debug?.approxTokens).toBeGreaterThan(0);
  });
});

