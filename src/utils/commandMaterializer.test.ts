import { materializeCommandTemplate, resolveCommandSelection } from './commandMaterializer';

describe('commandMaterializer', () => {
  test('materializes choice and placeholder tokens with concrete values', () => {
    const result = materializeCommandTemplate('ACQuire:MODe {SAMple|PEAKdetect|<NR1>}', [
      { name: 'value', type: 'enumeration', options: ['SAMple', 'PEAKdetect'] },
    ]);
    expect(result).toBe('ACQuire:MODe SAMple');
  });

  test('uses query syntax for query commands', () => {
    const resolved = resolveCommandSelection(
      {
        scpi: 'MEASUrement:VALue',
        manualEntry: { commandType: 'query', syntax: { query: 'MEASUrement:VALue?' } },
      },
      'auto'
    );
    expect(resolved.intent).toBe('query');
    expect(resolved.command).toBe('MEASUrement:VALue?');
  });

  test('prefers set syntax for both commands in auto mode', () => {
    const resolved = resolveCommandSelection(
      {
        scpi: 'ACQuire:MODe',
        manualEntry: {
          commandType: 'both',
          syntax: {
            set: 'ACQuire:MODe {SAMple|PEAKdetect}',
            query: 'ACQuire:MODe?',
          },
        },
        params: [{ name: 'value', type: 'enumeration', options: ['PEAKdetect', 'SAMple'] }],
      },
      'auto'
    );
    expect(resolved.intent).toBe('write');
    expect(resolved.command).toContain('ACQuire:MODe');
    expect(resolved.command.endsWith('?')).toBe(false);
  });

  test('prefers query mode when requested and command supports it', () => {
    const resolved = resolveCommandSelection(
      {
        scpi: 'ACQuire:MODe',
        manualEntry: {
          commandType: 'both',
          syntax: {
            set: 'ACQuire:MODe {SAMple|PEAKdetect}',
            query: 'ACQuire:MODe?',
          },
        },
      },
      'prefer_query'
    );
    expect(resolved.intent).toBe('query');
    expect(resolved.command).toBe('ACQuire:MODe?');
  });

  test('adds concrete value when set command has params but no inline args', () => {
    const resolved = resolveCommandSelection(
      {
        scpi: 'ACQuire:MODe',
        manualEntry: { commandType: 'set' },
        params: [{ name: 'value', type: 'enumeration', options: ['SAMple', 'PEAKdetect'] }],
      },
      'auto'
    );
    expect(resolved.intent).toBe('write');
    expect(resolved.command).toBe('ACQuire:MODe SAMple');
  });
});
