import { describe, expect, it } from 'vitest';
import { smartScpiLookup } from '../src/core/smartScpiAssistant';

describe('behavioral.smartScpiAssistant', () => {
  it('surfaces power harmonics setup commands for UI-style measurement requests', async () => {
    const result = await smartScpiLookup({
      query: 'add power measurement with harmonics',
      modelFamily: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    const headers = (result.data as Array<{ header?: string }>).map((row) => String(row.header || ''));
    expect(headers).toContain('POWer:ADDNew');
    expect(headers).toContain('POWer:POWer<x>:TYPe');
    expect(headers.some((header) => header.includes('POWer:POWer<x>:HARMONICS:'))).toBe(true);
  });

  it('surfaces standard measurement setup commands for frequency requests', async () => {
    const result = await smartScpiLookup({
      query: 'scpi for frequency measurement',
      modelFamily: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    const headers = (result.data as Array<{ header?: string }>).map((row) => String(row.header || ''));
    expect(headers).toContain('MEASUrement:ADDMEAS');
    expect(headers).toContain('MEASUrement:MEAS<x>:SOURCE');
    expect(headers.some((header) => header.startsWith('SEARCH:SEARCH<x>:TRIGger:A:DDR'))).toBe(false);
  });

  it('surfaces jitter summary anchors instead of only generic statistics commands', async () => {
    const result = await smartScpiLookup({
      query: 'add jitter summary on ch1',
      modelFamily: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    const headers = (result.data as Array<{ header?: string }>).map((row) => String(row.header || ''));
    expect(headers).toContain('MEASUrement:ADDMEAS');
    expect(headers).toContain('MEASUrement:MEAS<x>:JITTERSummary:TIE');
  });
});
