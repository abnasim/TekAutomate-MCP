import { applyAiActionsToSteps, canMaterializeAiAction, parseAiActionResponse, type StepLike } from './aiActions';

describe('aiActions normalization', () => {
  it('normalizes replace_step style payload', () => {
    const json = JSON.stringify({
      summary: 's',
      findings: [{ issue: 'bad step' }],
      suggestedFixes: [{ note: 'replace' }],
      confidence: 'high',
      actions: [
        {
          type: 'replace_step',
          stepId: 's1',
          newStep: { type: 'query', label: 'Wait', params: { command: '*OPC?', saveAs: 'opc' } },
        },
      ],
    });
    const parsed = parseAiActionResponse(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.actions[0].action_type).toBe('replace_step');
    expect(parsed?.findings[0]).toContain('bad step');
  });

  it('parses actions-only wrapper payloads', () => {
    const json = JSON.stringify({
      result: {
        actions: [
          {
            type: 'move_step',
            stepId: 'a',
            targetGroupId: 'g2',
            position: 0,
          },
        ],
      },
    });
    const parsed = parseAiActionResponse(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.actions.length).toBe(1);
    expect(parsed?.actions[0].action_type).toBe('move_step');
  });

  it('normalizes builder action schema with targetStepId/newStep', () => {
    const json = JSON.stringify({
      summary: 'Added fastframe steps.',
      actions: [
        {
          action_type: 'insert_step_after',
          targetStepId: '3',
          newStep: { type: 'write', label: 'Enable FastFrame', params: { command: 'HOR:FAST:STATE ON' } },
        },
      ],
    });
    const parsed = parseAiActionResponse(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.actions[0].action_type).toBe('insert_step_after');
    expect(parsed?.actions[0].target_step_id).toBe('3');
    expect((parsed?.actions[0].payload as Record<string, unknown>)?.new_step).toBeTruthy();
  });

  it('parses stringified newStep objects from assistant-style replace_step payloads', () => {
    const json = JSON.stringify({
      summary: 'Replace waveform save step.',
      actions: [
        {
          type: 'replace_step',
          targetStepId: '2',
          newStep: JSON.stringify({
            id: '2',
            type: 'save_waveform',
            label: 'Save CH1 as WFM',
            params: { source: 'CH1', filename: 'ch1.wfm', format: 'wfm' },
          }),
        },
      ],
    });
    const parsed = parseAiActionResponse(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.actions[0].action_type).toBe('replace_step');
    expect(parsed?.actions[0].target_step_id).toBe('2');
    expect((parsed?.actions[0].payload as Record<string, unknown>)?.new_step).toMatchObject({
      type: 'save_waveform',
      label: 'Save CH1 as WFM',
    });
  });

  it('wraps a full flow JSON object into replace_flow actions', () => {
    const json = JSON.stringify({
      name: 'Save All Data as TSS',
      description: 'Saves all waveforms as .wfm, setup, screenshot, zips them, and renames the zip to .tss',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        { id: '9', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    });
    const parsed = parseAiActionResponse(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.actions).toHaveLength(1);
    expect(parsed?.actions[0].action_type).toBe('replace_flow');
    expect((parsed?.actions[0].payload as Record<string, unknown>)?.steps).toHaveLength(2);
    expect(parsed?.summary).toContain('Saves all waveforms');
  });

  it('splits legacy params-object set_step_param into one action per field', () => {
    const json = JSON.stringify({
      summary: 'Fix screenshot params.',
      actions: [
        {
          type: 'set_step_param',
          targetStepId: 'shot1',
          param: 'params',
          value: {
            scopeType: 'modern',
            method: 'pc_transfer',
          },
        },
      ],
    });
    const parsed = parseAiActionResponse(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.actions.length).toBe(2);
    expect(parsed?.actions.map((a) => a.payload?.param)).toEqual(['scopeType', 'method']);
    expect(parsed?.actions.every((a) => a.target_step_id === 'shot1')).toBe(true);
  });
});

describe('applyAiActionsToSteps extended actions', () => {
  const base: StepLike[] = [
    {
      id: 'g1',
      type: 'group',
      label: 'Group 1',
      children: [
        { id: 'a', type: 'write', label: 'A', params: {} },
      ],
      params: {},
    },
    {
      id: 'g2',
      type: 'group',
      label: 'Group 2',
      children: [],
      params: {},
    },
  ];

  it('moves step into target group', () => {
    const out = applyAiActionsToSteps(base, [
      {
        id: 'm1',
        action_type: 'move_step',
        target_step_id: 'a',
        payload: { target_group_id: 'g2', position: 0 },
      },
    ]);
    const g1 = out.find((s) => s.id === 'g1');
    const g2 = out.find((s) => s.id === 'g2');
    expect(g1?.children?.length).toBe(0);
    expect(g2?.children?.[0]?.id).toBe('a');
  });

  it('replaces step preserving id', () => {
    const out = applyAiActionsToSteps(base, [
      {
        id: 'r1',
        action_type: 'replace_step',
        target_step_id: 'a',
        payload: { new_step: { type: 'query', label: 'Busy', params: { command: 'BUSY?', saveAs: 'busy' } } },
      },
    ]);
    const replaced = out.find((s) => s.id === 'g1')?.children?.[0];
    expect(replaced?.id).toBe('a');
    expect(replaced?.type).toBe('query');
    expect(replaced?.label).toBe('Busy');
  });

  it('does not allow replacing non-python step with python unless explicitly allowed', () => {
    const out = applyAiActionsToSteps(base, [
      {
        id: 'r2',
        action_type: 'replace_step',
        target_step_id: 'a',
        payload: {
          new_step: { type: 'python', label: 'Python step', params: { code: 'print(1)' } },
        },
      },
    ]);
    const same = out.find((s) => s.id === 'g1')?.children?.[0];
    expect(same?.type).toBe('write');
  });

  it('canonicalizes insert_step_after aliases and rejects python inserts by default', () => {
    const outAlias = applyAiActionsToSteps(base, [
      {
        id: 'i1',
        action_type: 'insert_step_after',
        target_step_id: 'a',
        payload: { type: 'scpi_query', params: { command: '*IDN?', saveAs: 'idn' } },
      },
    ]);
    const inserted = outAlias.find((s) => s.id === 'g1')?.children?.[1];
    expect(inserted?.type).toBe('query');

    const outPython = applyAiActionsToSteps(base, [
      {
        id: 'i2',
        action_type: 'insert_step_after',
        target_step_id: 'a',
        payload: { type: 'python', params: { code: 'print(1)' } },
      },
    ]);
    expect(outPython.find((s) => s.id === 'g1')?.children?.length).toBe(1);
  });

  it('preserves inserted ids so later actions can target newly inserted steps in the same apply pass', () => {
    const out = applyAiActionsToSteps([
      { id: 'anchor', type: 'comment', label: 'Anchor', params: { text: 'x' } },
    ], [
      {
        id: 'i_chain_1',
        action_type: 'insert_step_after',
        target_step_id: 'anchor',
        payload: {
          new_step: {
            id: 'g2',
            type: 'group',
            label: 'Add CH1 Measurements',
            params: {},
            children: [
              { id: 'm1', type: 'write', label: 'Add frequency', params: { command: 'MEASUrement:ADDMEAS FREQUENCY' } },
            ],
          },
        },
      },
      {
        id: 'i_chain_2',
        action_type: 'insert_step_after',
        target_step_id: 'g2',
        payload: {
          new_step: {
            id: 'g3',
            type: 'group',
            label: 'Read CH1 Measurement Results',
            params: {},
            children: [
              { id: 'q1', type: 'query', label: 'Query frequency', params: { command: 'MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?', saveAs: 'freq' } },
            ],
          },
        },
      },
    ]);
    expect(out.map((step) => step.id)).toEqual(['anchor', 'g2', 'g3']);
    expect(out[1].children).toHaveLength(1);
    expect(out[2].children).toHaveLength(1);
  });

  it('supports replace_flow for full-flow rebuild with canonical types', () => {
    const out = applyAiActionsToSteps(base, [
      {
        id: 'rf1',
        action_type: 'replace_flow',
        payload: {
          steps: [
            { id: 'n1', type: 'connect', label: 'Connect', params: {} },
            { id: 'n2', type: 'scpi_write', label: 'Mode', params: { command: 'ACQ:MODE SAMPLE' } },
            { id: 'n3', type: 'disconnect', label: 'Disconnect', params: {} },
          ],
        },
      },
    ]);
    expect(out.length).toBe(3);
    expect(out[1].type).toBe('write');
    expect(out[1].params?.command).toBe('ACQ:MODE SAMPLE');
  });

  it('accepts assistant-style visa_* full-flow steps with query params.query', () => {
    const out = applyAiActionsToSteps(base, [
      {
        id: 'rf2',
        action_type: 'replace_flow',
        payload: {
          steps: [
            { id: 'n1', type: 'connect', label: 'Connect', params: {} },
            { id: 'n2', type: 'visa_write', label: 'Reset', params: { command: '*RST' } },
            { id: 'n3', type: 'visa_query', label: 'Read freq', params: { query: 'MEAS:FREQ?', saveAs: 'freq' } },
            { id: 'n4', type: 'disconnect', label: 'Disconnect', params: {} },
          ],
        },
      },
    ]);
    expect(out.length).toBe(4);
    expect(out[1].type).toBe('write');
    expect(out[1].params?.command).toBe('*RST');
    expect(out[2].type).toBe('query');
    expect(out[2].params?.command).toBe('MEAS:FREQ?');
    expect(out[2].params?.saveAs).toBe('freq');
  });

  it('adds connect and disconnect when a replace_flow proposal omits them', () => {
    const out = applyAiActionsToSteps([], [
      {
        id: 'rf_missing_edges',
        action_type: 'replace_flow',
        payload: {
          steps: [
            { id: 'n2', type: 'write', label: 'Reset', params: { command: '*RST' } },
            { id: 'n3', type: 'save_screenshot', label: 'Save Screenshot', params: { filename: 'capture.png', scopeType: 'modern', method: 'pc_transfer' } },
          ],
        },
      },
    ]);
    expect(out).toHaveLength(4);
    expect(out[0].type).toBe('connect');
    expect(out[1].type).toBe('write');
    expect(out[2].type).toBe('save_screenshot');
    expect(out[3].type).toBe('disconnect');
  });

  it('deduplicates query variable names when assistant output repeats result names', () => {
    const out = applyAiActionsToSteps(base, [
      {
        id: 'rf3',
        action_type: 'replace_flow',
        payload: {
          steps: [
            { id: 'n1', type: 'connect', label: 'Connect', params: {} },
            { id: 'n2', type: 'query', label: 'Query MEAN value on CH3', params: { command: 'MEAS:MEAN?', saveAs: 'result' } },
            { id: 'n3', type: 'query', label: 'Query RMS value on CH3', params: { command: 'MEAS:RMS?', saveAs: 'result' } },
            { id: 'n4', type: 'disconnect', label: 'Disconnect', params: {} },
          ],
        },
      },
    ]);
    const queryVars = out.filter((step) => step.type === 'query').map((step) => step.params?.saveAs);
    expect(queryVars).toHaveLength(2);
    expect(queryVars.every(Boolean)).toBe(true);
    expect(new Set(queryVars).size).toBe(2);
  });

  it('keeps compact semicolon write steps intact and only auto-groups long chains', () => {
    const compact = applyAiActionsToSteps([], [
      {
        id: 'rf_compact',
        action_type: 'replace_flow',
        payload: {
          steps: [
            { id: 'n1', type: 'connect', label: 'Connect', params: {} },
            {
              id: 'n2',
              type: 'write',
              label: 'Configure CH1',
              params: { command: 'CH1:SCA 0.2;CH1:COUP DC;CH1:IMP 50;CH1:LAB \"VDD_CORE\"' },
            },
            { id: 'n3', type: 'disconnect', label: 'Disconnect', params: {} },
          ],
        },
      },
    ]);
    expect(compact[1].type).toBe('write');
    expect(compact[1].params?.command).toContain('CH1:SCA 0.2;CH1:COUP DC;CH1:IMP 50;CH1:LAB');

    const longChain = applyAiActionsToSteps([], [
      {
        id: 'rf_long',
        action_type: 'replace_flow',
        payload: {
          steps: [
            { id: 'n1', type: 'connect', label: 'Connect', params: {} },
            {
              id: 'n2',
              type: 'write',
              label: 'Long Config',
              params: { command: 'A 1;B 2;C 3;D 4;E 5' },
            },
            { id: 'n3', type: 'disconnect', label: 'Disconnect', params: {} },
          ],
        },
      },
    ]);
    expect(longChain[1].type).toBe('group');
    expect(longChain[1].children).toHaveLength(5);
  });

  it('rejects replace_flow actions that only contain unsupported pseudo-step types', () => {
    const action = {
      id: 'rf_invalid',
      action_type: 'replace_flow' as const,
      payload: {
        steps: [
          { type: 'set_channel', label: 'Set Channel', params: { channel: 1 } },
          { type: 'repeat', label: 'Repeat', params: { iterations: 10 } },
        ],
      },
    };
    expect(canMaterializeAiAction(action)).toBe(false);
    expect(applyAiActionsToSteps([], [action])).toEqual([]);
  });
});
