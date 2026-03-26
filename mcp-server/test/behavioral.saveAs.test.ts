import { validateActionPayload } from '../src/tools/validateActionPayload';

describe('behavioral.saveAs', () => {
  it('flags query step without saveAs in replace_flow', async () => {
    const result = await validateActionPayload({
      actionsJson: {
        actions: [
          {
            action_type: 'replace_flow',
            payload: {
              steps: [
                { id: '1', type: 'connect', params: {} },
                { id: '2', type: 'query', params: { command: '*IDN?' } },
                { id: '3', type: 'disconnect', params: {} },
              ],
            },
          },
        ],
      },
    });
    const data = result.data as { valid: boolean; errors: string[] };
    expect(data.valid).toBe(false);
    expect(data.errors.some((e) => /saveAs/i.test(e))).toBe(true);
  });
});
