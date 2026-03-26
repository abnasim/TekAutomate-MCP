import { describe, expect, it } from 'vitest';
import { buildMeasurementSearchPlan, findMeasurementCatalogMatches } from '../src/core/measurementCatalog';

describe('behavioral.measurementCatalog', () => {
  it('matches power harmonics UI language and exposes result-token hints', () => {
    const matches = findMeasurementCatalogMatches('add power measurement with harmonics');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.entry.tab).toBe('Power');
    expect(matches[0]?.entry.label).toBe('Harmonics');
    expect(matches[0]?.entry.section).toBe('Input Analysis');

    const plan = buildMeasurementSearchPlan('add power measurement with harmonics');
    expect(plan).not.toBeNull();
    expect(plan?.wantsResults).toBe(false);
    expect(plan?.exactHeaders).toContain('POWer:ADDNew');
    expect(plan?.exactHeaders).toContain('POWer:POWer<x>:HARMONICS:VSOURce');
    expect(plan?.resultTokens).toContain('THDF');
    expect(plan?.resultTokens).toContain('THDR');
  });

  it('matches jitter summary from the UI taxonomy', () => {
    const matches = findMeasurementCatalogMatches('add jitter summary on ch1');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.entry.tab).toBe('Jitter');
    expect(matches[0]?.entry.label).toBe('Jitter Summary');

    const plan = buildMeasurementSearchPlan('add jitter summary on ch1');
    expect(plan).not.toBeNull();
    expect(plan?.exactHeaders).toContain('MEASUrement:ADDMEAS');
    expect(plan?.exactHeaders).toContain('MEASUrement:MEAS<x>:JITTERSummary:TIE');
    expect(plan?.resultTokens).toContain('TIE');
    expect(plan?.resultTokens).toContain('RJ');
  });

  it('switches to result-oriented headers when the query explicitly asks for results', () => {
    const plan = buildMeasurementSearchPlan('query power harmonics results');
    expect(plan).not.toBeNull();
    expect(plan?.wantsResults).toBe(true);
    expect(plan?.exactHeaders).toContain('POWer:POWer<x>:RESUlts:CURRentacq:FREQUENCY?');
  });

  it('matches wbg timing measurement labels like td(on)', () => {
    const matches = findMeasurementCatalogMatches('measure td on for mosfet');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.entry.tab).toBe('WBG-DPT');
    expect(matches[0]?.entry.label).toBe('Td(on)');
  });
});
