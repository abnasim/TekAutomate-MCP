import { describe, expect, it } from 'vitest';
import { getCommandsByHeaderBatch } from '../src/tools/getCommandsByHeaderBatch';
import { materializeScpiCommand } from '../src/tools/materializeScpiCommand';
import { materializeScpiCommands } from '../src/tools/materializeScpiCommands';
import { materializeTmDevicesCall } from '../src/tools/materializeTmDevicesCall';
import { searchTmDevices } from '../src/tools/searchTmDevices';

describe('behavioral.materializeCommands', () => {
  it('materializes a concrete SCPI set command from a canonical header and value', async () => {
    const result = await materializeScpiCommand({
      header: 'CH<x>:TERmination',
      family: 'MSO4/5/6 Series',
      commandType: 'set',
      placeholderBindings: { 'CH<x>': 'CH4' },
      value: 50,
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { command?: string }).command).toBe('CH4:TERmination 50');
  });

  it('infers placeholder bindings from a concrete header when explicit bindings are omitted', async () => {
    const result = await materializeScpiCommand({
      header: 'CH1:TERmination',
      family: 'MSO4/5/6 Series',
      commandType: 'set',
      value: 50,
    });

    expect(result.ok).toBe(true);
    expect((result.data as { command?: string }).command).toBe('CH1:TERmination 50');
    expect((result.data as { inferredPlaceholderBindings?: Record<string, unknown> }).inferredPlaceholderBindings).toMatchObject({
      'CH<x>': 'CH1',
      '<x>': '1',
    });
  });

  it('materializes a canonical SCPI query with placeholder instantiation only', async () => {
    const result = await materializeScpiCommand({
      header: 'TRIGger:{A|B}:EDGE:SOUrce',
      family: 'MSO4/5/6 Series',
      commandType: 'query',
      placeholderBindings: { '{A|B}': 'A' },
    });

    expect(result.ok).toBe(true);
    expect((result.data as { command?: string }).command).toBe('TRIGger:A:EDGE:SOUrce?');
  });

  it('materializes a measurement-source command from the canonical template header', async () => {
    const result = await materializeScpiCommand({
      header: 'MEASUrement:MEAS<x>:SOURCE',
      family: 'MSO4/5/6 Series',
      commandType: 'set',
      placeholderBindings: { 'MEAS<x>': 'MEAS1' },
      value: 'CH1',
    });

    expect(result.ok).toBe(true);
    expect((result.data as { command?: string }).command).toBe('MEASUrement:MEAS1:SOURCE CH1');
  });

  it('materializes indexed measurement sources from the concrete header when SOURCE1/SOURCE2 are required', async () => {
    const result = await materializeScpiCommands({
      items: [
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: 'MEASUrement:MEAS1:SOUrce1',
          family: 'MSO4/5/6 Series',
          commandType: 'set',
          value: 'CH4',
        },
        {
          header: 'MEASUrement:MEAS<x>:SOUrce<x>',
          concreteHeader: 'MEASUrement:MEAS1:SOUrce2',
          family: 'MSO4/5/6 Series',
          commandType: 'set',
          value: 'CH1',
        },
      ],
    });

    expect(result.ok).toBe(true);
    const rows = ((result.data as { results?: Array<{ data?: { command?: string } }> }).results || []);
    expect(rows[0]?.data?.command).toBe('MEASUrement:MEAS1:SOUrce1 CH4');
    expect(rows[1]?.data?.command).toBe('MEASUrement:MEAS1:SOUrce2 CH1');
  });

  it('falls back to the concrete header for malformed enum syntax while staying exact-verified', async () => {
    const result = await materializeScpiCommand({
      header: 'SEARCH:SEARCH<x>:TRIGger:A:BUS:CAN:ERRType',
      concreteHeader: 'SEARCH:SEARCH1:TRIGger:A:BUS:CAN:ERRType',
      family: 'MSO4/5/6 Series',
      commandType: 'set',
      value: 'ANYERRor',
    });

    expect(result.ok).toBe(true);
    expect((result.data as { command?: string }).command).toBe('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:ERRType ANYERRor');
  });

  it('batch-resolves exact SCPI headers in one call', async () => {
    const result = await getCommandsByHeaderBatch({
      headers: ['CH<x>:SCAle', 'CH<x>:COUPling', 'CH<x>:TERmination'],
      family: 'MSO4/5/6 Series',
    });

    expect(result.ok).toBe(true);
    expect(((result.data as { results?: unknown[] }).results || []).length).toBe(3);
    expect(((result.data as { missingHeaders?: unknown[] }).missingHeaders || []).length).toBe(0);
  });

  it('batch-materializes multiple SCPI commands in one call', async () => {
    const result = await materializeScpiCommands({
      items: [
        {
          header: 'CH<x>:SCAle',
          family: 'MSO4/5/6 Series',
          commandType: 'set',
          placeholderBindings: { 'CH<x>': 'CH1' },
          value: 0.5,
        },
        {
          header: 'CH<x>:TERmination',
          family: 'MSO4/5/6 Series',
          commandType: 'set',
          placeholderBindings: { 'CH<x>': 'CH1' },
          value: 50,
        },
      ],
    });

    expect(result.ok).toBe(true);
    const rows = ((result.data as { results?: Array<{ data?: { command?: string } }> }).results || []);
    expect(rows[0]?.data?.command).toBe('CH1:SCAle 0.5');
    expect(rows[1]?.data?.command).toBe('CH1:TERmination 50');
  });

  it('uses bus aliases and concrete headers to resolve B<x> placeholders', async () => {
    const result = await materializeScpiCommands({
      items: [
        {
          header: 'BUS:B<x>:CAN:SOUrce',
          concreteHeader: 'BUS:B1:CAN:SOUrce',
          family: 'MSO4/5/6 Series',
          commandType: 'set',
          value: 'CH2',
        },
        {
          header: 'TRIGger:A:BUS:B1:CAN:DATa:OFFSet',
          family: 'MSO4/5/6 Series',
          commandType: 'set',
          value: 5,
        },
      ],
    });

    expect(result.ok).toBe(true);
    const rows = ((result.data as { results?: Array<{ data?: { command?: string } }> }).results || []);
    expect(rows[0]?.data?.command).toBe('BUS:B1:CAN:SOUrce CH2');
    expect(rows[1]?.data?.command).toBe('TRIGger:A:BUS:B1:CAN:DATa:OFFSet 5');
  });

  it('materializes a tm_devices call from a verified method path', async () => {
    const result = await materializeTmDevicesCall({
      methodPath: 'ch[x].termination.write',
      model: 'MSO6B',
      placeholderBindings: { channel: 1 },
      arguments: ['FIFTY'],
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect((result.data as { code?: string }).code).toBe('scope.commands.ch[1].termination.write("FIFTY")');
  });

  it('prioritizes exact tm_devices method-path lookups during search', async () => {
    const result = await searchTmDevices({
      query: 'trigger.a.edge.source.write',
      model: 'MSO6B',
      limit: 3,
    });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as Array<{ methodPath?: string }>)[0]?.methodPath).toBe('trigger.a.edge.source.write');
  });
});
