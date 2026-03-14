import { validateActionPayload } from '../src/tools/validateActionPayload';

describe('behavioral.noPython', () => {
  it('rejects python replacement when original step is not python', async () => {
    const result = await validateActionPayload({
      originalSteps: [{ id: '2', type: 'write', params: {} }],
      actionsJson: {
        actions: [
          {
            action_type: 'replace_step',
            target_step_id: '2',
            payload: { new_step: { id: '2', type: 'python', params: { code: 'print(1)' } } },
          },
        ],
      },
    });
    const data = result.data as { valid: boolean; errors: string[] };
    expect(data.valid).toBe(false);
    expect(data.errors.some((e) => /python substitution/i.test(e))).toBe(true);
  });
});
