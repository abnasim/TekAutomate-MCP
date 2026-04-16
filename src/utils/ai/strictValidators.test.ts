import {
  validateBlocklyXml,
  validateStepsJson,
  verifyScpiCommands,
  type CommandLibraryIndex,
  type TmDevicesIndex,
} from './strictValidators';

function makeCommandLibrary(entries: Record<string, Array<{ commandId: string; sourceFile: string; group?: string }>>): CommandLibraryIndex {
  const map = new Map<string, Array<{ key: string; commandId: string; sourceFile: string; group?: string }>>();
  Object.entries(entries).forEach(([key, refs]) => {
    map.set(
      key,
      refs.map((r) => ({
        key,
        commandId: r.commandId,
        sourceFile: r.sourceFile,
        group: r.group,
      }))
    );
  });
  return { commandMap: map };
}

function makeTmDevicesIndex(paths: string[]): TmDevicesIndex {
  return {
    methodPathsByRoot: new Map([
      ['mso6b_commands.mso6bcommands', new Set(paths.map((p) => p.toLowerCase()))],
    ]),
  };
}

describe('verifyScpiCommands', () => {
  it('verifies known SCPI command from source-of-truth index', async () => {
    const library = makeCommandLibrary({
      '*IDN?': [{ commandId: '*IDN?', sourceFile: 'mso_4_5_6_7.json' }],
      '*IDN': [{ commandId: '*IDN?', sourceFile: 'mso_4_5_6_7.json' }],
    });
    const result = await verifyScpiCommands(
      [{ command: '*IDN?', mode: 'scpi' }],
      { commandLibrary: library, tmDevices: makeTmDevicesIndex([]) }
    );
    expect(result.valid).toBe(true);
    expect(result.items[0].references[0].sourceFile).toBe('mso_4_5_6_7.json');
  });

  it('rejects unknown SCPI command', async () => {
    const library = makeCommandLibrary({});
    const result = await verifyScpiCommands(
      [{ command: 'FAKE:COMMAND 1', mode: 'scpi' }],
      { commandLibrary: library, tmDevices: makeTmDevicesIndex([]) }
    );
    expect(result.valid).toBe(false);
    expect(result.items[0].reason).toMatch(/could not verify/i);
  });

  it('verifies tm_devices command path against method tree', async () => {
    const result = await verifyScpiCommands(
      [{ command: "scope.commands.acquire.state.write('RUN')", mode: 'tm_devices' }],
      {
        commandLibrary: makeCommandLibrary({}),
        tmDevices: makeTmDevicesIndex(['acquire.state.write']),
      }
    );
    expect(result.valid).toBe(true);
    expect(result.items[0].references[0].sourceFile).toBe('tm_devices_full_tree.json');
  });
});

describe('validateStepsJson', () => {
  it('passes valid minimal flow', async () => {
    const library = makeCommandLibrary({
      '*IDN?': [{ commandId: '*IDN?', sourceFile: 'mso_4_5_6_7.json' }],
      '*IDN': [{ commandId: '*IDN?', sourceFile: 'mso_4_5_6_7.json' }],
    });
    const result = await validateStepsJson(
      {
        name: 'Flow',
        backend: 'pyvisa',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          {
            id: '2',
            type: 'query',
            label: 'IDN',
            params: { command: '*IDN?', saveAs: 'idn' },
          },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
      },
      { commandLibrary: library, tmDevices: makeTmDevicesIndex([]) }
    );
    expect(result.valid).toBe(true);
  });

  it('fails when query step is missing saveAs', async () => {
    const result = await validateStepsJson(
      {
        name: 'Flow',
        backend: 'pyvisa',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: {} },
          { id: '2', type: 'query', label: 'Q', params: { command: '*IDN?' } },
          { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
        ],
      },
      { commandLibrary: makeCommandLibrary({}), tmDevices: makeTmDevicesIndex([]) }
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('saveAs'))).toBe(true);
  });
});

describe('validateBlocklyXml', () => {
  it('passes valid XML structure', () => {
    const xml = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <variables><variable>v</variable></variables>
  <block type="connect_scope" id="c1" x="20" y="20">
    <field name="DEVICE_NAME">scope</field>
    <field name="BACKEND">pyvisa</field>
    <next>
      <block type="scpi_query" id="q1">
        <field name="DEVICE_CONTEXT">scope</field>
        <field name="COMMAND">*IDN?</field>
        <field name="VARIABLE">idn</field>
      </block>
    </next>
  </block>
</xml>`;
    const result = validateBlocklyXml(xml, { backend: 'pyvisa' });
    expect(result.valid).toBe(true);
  });

  it('fails for missing xmlns and duplicate ids', () => {
    const xml = `
<xml>
  <block type="connect_scope" id="dup" x="20" y="20"></block>
  <block type="disconnect" id="dup"></block>
</xml>`;
    const result = validateBlocklyXml(xml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('xmlns'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Duplicate block id'))).toBe(true);
  });

  it('fails non tm_devices block usage when backend is tm_devices', () => {
    const xml = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="connect_scope" id="c1" x="20" y="20">
    <field name="BACKEND">tm_devices</field>
    <next>
      <block type="scpi_write" id="w1">
        <field name="COMMAND">*CLS</field>
      </block>
    </next>
  </block>
</xml>`;
    const result = validateBlocklyXml(xml, { backend: 'tm_devices' });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('requires tm_devices_* command blocks'))
    ).toBe(true);
  });
});
