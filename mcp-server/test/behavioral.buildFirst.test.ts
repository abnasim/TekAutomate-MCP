import { postCheckResponse } from '../src/core/postCheck';
import { searchScpi } from '../src/tools/searchScpi';
import { validateActionPayload } from '../src/tools/validateActionPayload';

describe('behavioral.buildFirst', () => {
  it('integrates search + payload validation + post-check', async () => {
    const lookup = await searchScpi({ query: '*IDN?', limit: 1 });
    expect(lookup.ok).toBe(true);
    const command =
      ((lookup.data as Array<Record<string, unknown>>)[0]?.header as string | undefined) || '*IDN?';

    const payload = {
      summary: 'ok',
      findings: [],
      suggestedFixes: [],
      actions: [
        {
          action_type: 'replace_flow',
          payload: {
            steps: [
              { id: '1', type: 'connect', params: {} },
              { id: '2', type: 'query', params: { command, saveAs: 'idn' } },
              { id: '3', type: 'disconnect', params: {} },
            ],
          },
        },
      ],
    };
    const payloadCheck = await validateActionPayload({ actionsJson: payload });
    expect((payloadCheck.data as { valid: boolean }).valid).toBe(true);

    const text =
      `Built with defaults. ACTIONS_JSON: ${JSON.stringify(payload)}`;
    const result = await postCheckResponse(text, { backend: 'pyvisa', originalSteps: [] });
    expect(result.ok).toBe(true);
  });
});
