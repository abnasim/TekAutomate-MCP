import { postCheckResponse } from '../src/core/postCheck';

describe('behavioral.responseFormat', () => {
  it('flags prose over 400 characters', async () => {
    const long = 'x'.repeat(420);
    const text = `${long}\nACTIONS_JSON: {"summary":"ok","findings":[],"suggestedFixes":[],"actions":[]}`;
    const result = await postCheckResponse(text, { backend: 'pyvisa', originalSteps: [] });
    expect(result.errors.some((e) => /400/i.test(e))).toBe(true);
  });
});
