import { searchScpi } from '../src/tools/searchScpi';
import { verifyScpiCommands } from '../src/tools/verifyScpiCommands';

describe('behavioral.scpiVerified', () => {
  it('verifies a command returned by search_scpi', async () => {
    const lookup = await searchScpi({ query: '*IDN?', limit: 1 });
    expect(lookup.ok).toBe(true);
    const first = (lookup.data as Array<Record<string, unknown>>)[0];
    const header = (first?.header as string | undefined) || '*IDN?';

    const result = await verifyScpiCommands({ commands: [header] });
    const rows = result.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows[0]?.verified).toBe(true);
  });

  it('normalizes modelFamily tokens for family filtering', async () => {
    const lookup = await searchScpi({
      query: 'FastFrame',
      modelFamily: 'mso_5_series',
      limit: 5,
    });
    expect(lookup.ok).toBe(true);
    const rows = lookup.data as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('accepts exact long-form SCPI and rejects shorthand when exact syntax is required', async () => {
    const exact = await verifyScpiCommands({
      commands: [
        'TRIGger:A:EDGE:SOUrce CH4',
        'MEASUrement:MEAS3:RESUlts:CURRentacq:MEAN?',
      ],
      modelFamily: 'MSO4/5/6 Series',
      requireExactSyntax: true,
    });
    const exactRows = exact.data as Array<Record<string, unknown>>;
    expect(exactRows.every((row) => row.verified === true)).toBe(true);

    const shorthand = await verifyScpiCommands({
      commands: [
        'TRIG:A:EDGE:SOU CH4',
        'MEASU:MEAS3:RESU:CURR?',
      ],
      modelFamily: 'MSO4/5/6 Series',
      requireExactSyntax: true,
    });
    const shorthandRows = shorthand.data as Array<Record<string, unknown>>;
    expect(shorthandRows.every((row) => row.verified === false)).toBe(true);
  });
});
