import { postCheckResponse } from '../src/core/postCheck';

describe('behavioral.tekhsi', () => {
  it('flags unexpected TekHSI text on non-TekHSI backend', async () => {
    const text =
      'Use TekHSI. ACTIONS_JSON: {"summary":"ok","findings":[],"suggestedFixes":[],"actions":[]}';
    const result = await postCheckResponse(text, { backend: 'pyvisa', originalSteps: [] });
    expect(result.errors.some((e) => /TekHSI/i.test(e))).toBe(true);
  });
});
