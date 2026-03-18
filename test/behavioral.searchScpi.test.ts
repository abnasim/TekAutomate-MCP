import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { searchScpi } from '../src/tools/searchScpi';
import { getCommandByHeader } from '../src/tools/getCommandByHeader';
import { loadCommandIndex } from '../src/core/commandIndex';

describe('behavioral.searchScpi', () => {
  it('filters search results to the requested modern MSO family', async () => {
    const result = await searchScpi({
      query: 'trigger edge source level mode',
      modelFamily: 'MSO4/5/6 Series',
      limit: 10,
      commandType: 'set',
    });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as Array<{ sourceFile?: string }>).length).toBeGreaterThan(0);
    expect((result.data as Array<{ sourceFile?: string }>).every((row) => row.sourceFile === 'mso_2_4_5_6_7.json')).toBe(true);
  });

  it('can directly look up embedded syntax-array channel commands', async () => {
    const result = await getCommandByHeader({
      header: 'CH<x>:SCAle',
      family: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { header?: string }).header).toBe('CH<x>:SCAle');
  });

  it('can directly look up the manual override for channel termination', async () => {
    const result = await getCommandByHeader({
      header: 'CH<x>:TERmination',
      family: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { header?: string; sourceFile?: string }).header).toBe('CH<x>:TERmination');
    expect((result.data as { sourceFile?: string }).sourceFile).toBe('mso_manual_overrides.json');
  });

  it('returns rich command details, not just a stripped header summary', async () => {
    const result = await getCommandByHeader({
      header: 'CH<x>:TERmination',
      family: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { description?: string }).description).toContain('vertical termination');
    expect((result.data as { relatedCommands?: string[] }).relatedCommands).toContain('CH<x>:COUPling');
    expect((result.data as { manualReference?: { section?: string } }).manualReference?.section).toBe('Vertical');
    expect((result.data as { examples?: Array<{ description?: string }> }).examples?.[0]?.description).toBeTruthy();
    expect((result.data as { arguments?: Array<{ description?: string }> }).arguments?.[1]?.description).toContain('ohms');
  });

  it('can directly look up the Search and Mark manual override for AutoEthernet MAC length', async () => {
    const result = await getCommandByHeader({
      header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:AUTOETHERnet:MAC:LENgth:VALue',
      family: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { header?: string; sourceFile?: string }).header).toBe(
      'SEARCH:SEARCH<x>:TRIGger:A:BUS:AUTOETHERnet:MAC:LENgth:VALue'
    );
    expect((result.data as { sourceFile?: string }).sourceFile).toBe('mso_manual_overrides.json');
    expect((result.data as { description?: string }).description).toContain('AutoEthernet');
  });

  it('can directly look up the Search and Mark manual override for DDR read/write reference levels', async () => {
    const result = await getCommandByHeader({
      header: 'SEARCH:SEARCH<x>:TRIGger:A:DDRREADWRITE:REFLevel:DATA:HIGH',
      family: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { header?: string; sourceFile?: string }).header).toBe(
      'SEARCH:SEARCH<x>:TRIGger:A:DDRREADWRITE:REFLevel:DATA:HIGH'
    );
    expect((result.data as { sourceFile?: string }).sourceFile).toBe('mso_manual_overrides.json');
    expect((result.data as { description?: string }).description).toContain('DDR read/write');
  });

  it('canonicalizes concrete indexed headers back to the source-of-truth template header', async () => {
    const lookups = [
      { input: 'CH1:TERmination', expected: 'CH<x>:TERmination' },
      { input: 'CH2:SCAle', expected: 'CH<x>:SCAle' },
      { input: 'CH3:COUPling', expected: 'CH<x>:COUPling' },
      { input: 'MEASUrement:MEAS1:SOURCE', expected: 'MEASUrement:MEAS<x>:SOURCE' },
      { input: 'MEASUrement:MEAS2:RESUlts:CURRentacq:MEAN', expected: 'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN' },
    ];

    for (const lookup of lookups) {
      const result = await getCommandByHeader({
        header: lookup.input,
        family: 'MSO4/5/6 Series',
      });

      expect(result.ok, lookup.input).toBe(true);
      expect(result.data, lookup.input).not.toBeNull();
      expect((result.data as { header?: string }).header, lookup.input).toBe(lookup.expected);
    }
  });

  it('can resolve the common MSO scope setup headers from source-of-truth files', async () => {
    const headers = [
      'CH<x>:SCAle',
      'CH<x>:COUPling',
      'CH<x>:TERmination',
      'CH<x>:LABel:NAMe',
      'TRIGger:{A|B}:EDGE:SOUrce',
      'TRIGger:{A|B}:EDGE:SLOpe',
      'TRIGger:A:MODe',
      'HORizontal:RECOrdlength',
      'ACQuire:STOPAfter',
      'ACQuire:STATE',
      'MEASUrement:ADDMEAS',
      'MEASUrement:MEAS<x>:SOURCE',
      'MEASUrement:MEAS<x>:RESUlts:CURRentacq:MEAN',
    ];

    for (const header of headers) {
      const result = await getCommandByHeader({
        header,
        family: 'MSO4/5/6 Series',
      });

      expect(result.ok, header).toBe(true);
      expect(result.data, header).not.toBeNull();
      expect((result.data as { header?: string }).header, header).toBe(header);
    }
  });

  it('prefers legacy manual override records over the legacy vendor extract when headers collide', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'tek-command-index-'));
    try {
      await writeFile(
        path.join(tmpDir, 'MSO_DPO_5k_7k_70K.json'),
        JSON.stringify({
          commands_by_section: {
            Acquisition: [
              {
                command: 'ACQuire:MODe:ACTUal',
                header: 'ACQuire:MODe:ACTUal',
                description: 'Base legacy extract record',
                shortDescription: 'Base legacy extract record',
                syntax: ['ACQuire:MODe:ACTUal?'],
                commandType: 'query',
                instruments: { families: ['DPO7000'], models: [], exclusions: [] },
              },
            ],
          },
        })
      );
      await writeFile(
        path.join(tmpDir, 'legacy_scope_manual_overrides.json'),
        JSON.stringify([
          {
            command: 'ACQuire:MODe:ACTUal',
            header: 'ACQuire:MODe:ACTUal',
            description: 'Manual override record',
            shortDescription: 'Manual override record',
            commandType: 'query',
            instruments: { families: ['DPO7000'], models: [], exclusions: [] },
            syntax: { query: 'ACQuire:MODe:ACTUal?' },
            commandGroup: 'Acquisition',
          },
        ])
      );

      const index = await loadCommandIndex({
        commandsDir: tmpDir,
        files: ['MSO_DPO_5k_7k_70K.json', 'legacy_scope_manual_overrides.json'],
      });
      const record = index.getByHeader('ACQuire:MODe:ACTUal', 'DPO7000');

      expect(record).not.toBeNull();
      expect(record?.sourceFile).toBe('legacy_scope_manual_overrides.json');
      expect(record?.description).toContain('Manual override');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
