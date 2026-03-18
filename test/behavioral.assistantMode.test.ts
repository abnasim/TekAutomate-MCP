import { describe, expect, it } from 'vitest';
import { postCheckResponse } from '../src/core/postCheck';

describe('behavioral.assistantMode', () => {
  it('wraps a raw full-flow JSON reply into applyable ACTIONS_JSON', async () => {
    const text = JSON.stringify({
      name: 'Save All Data as TSS',
      description: 'Saves all waveforms as .wfm, setup, screenshot, zips them, and renames the zip to .tss',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        { id: '2', type: 'save_waveform', label: 'Save CH1 Waveform', params: { source: 'CH1', filename: 'CH1.wfm', format: 'wfm' } },
        { id: '9', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    });

    const result = await postCheckResponse(text, { backend: 'pyvisa', originalSteps: [] }, { assistantMode: true });

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('ACTIONS_JSON:');
    expect(result.text).toContain('"type":"replace_flow"');
    expect(result.text).toContain('"type":"save_waveform"');
  });

  it('normalizes stringified newStep objects from assistant replies', async () => {
    const text = JSON.stringify({
      summary: 'Update waveform save steps.',
      findings: [],
      suggestedFixes: [],
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

    const result = await postCheckResponse(
      text,
      { backend: 'pyvisa', originalSteps: [{ id: '2', type: 'save_waveform', params: {} }] },
      { assistantMode: true }
    );

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"type":"replace_step"');
    expect(result.text).toContain('"newStep":{"id":"2","type":"save_waveform"');
  });

  it('splits assistant params-object updates into concrete set_step_param actions', async () => {
    const text = JSON.stringify({
      summary: 'Fix screenshot defaults.',
      findings: [],
      suggestedFixes: [],
      actions: [
        {
          action_type: 'set_step_param',
          target_step_id: 'shot1',
          payload: {
            param: 'params',
            value: {
              scopeType: 'modern',
              method: 'pc_transfer',
            },
          },
        },
      ],
    });

    const result = await postCheckResponse(text, { backend: 'pyvisa', originalSteps: [] }, { assistantMode: true });

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"param":"scopeType"');
    expect(result.text).toContain('"param":"method"');
    expect(result.text).not.toContain('"param":"params"');
  });

  it('drops unsupported pseudo-step replace_flow actions in assistant mode', async () => {
    const text = JSON.stringify({
      summary: 'Pseudo workflow.',
      findings: [],
      suggestedFixes: [],
      actions: [
        {
          type: 'replace_flow',
          flow: {
            name: 'Pseudo Flow',
            description: 'Not really TekAutomate',
            backend: 'pyvisa',
            deviceType: 'SCOPE',
            steps: [
              { id: '1', type: 'set_channel', label: 'Set Channel', params: { channel: 1 } },
              { id: '2', type: 'repeat', label: 'Repeat', params: { iterations: 10 } },
            ],
          },
        },
      ],
    });

    const result = await postCheckResponse(text, { backend: 'pyvisa', originalSteps: [] }, { assistantMode: true });

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"actions":[]');
    expect(result.text).toContain('invalid apply actions were removed');
  });

  it('disables apply in assistant mode when SCPI is not exactly verified from the source-of-truth library', async () => {
    const text = JSON.stringify({
      name: 'Guessed Trigger Flow',
      description: 'Contains shorthand that should fail closed.',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        {
          id: '2',
          type: 'write',
          label: 'Guessed trigger source',
          params: { command: 'TRIG:A:EDGE:SOU CH4' },
        },
        {
          id: '3',
          type: 'query',
          label: 'Guessed measurement readback',
          params: { command: 'MEASU:MEAS1:RESU:CURR?', saveAs: 'result' },
        },
        { id: '4', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    });

    const result = await postCheckResponse(
      text,
      { backend: 'pyvisa', modelFamily: 'MSO4/5/6 Series', originalSteps: [] },
      { assistantMode: true }
    );

    expect(result.errors).toContain('Unverified command: TRIG:A:EDGE:SOU');
    expect(result.errors).toContain('Unverified command: MEASU:MEAS1:RESU:CURR?');
    expect(result.text).toContain('"actions":[]');
    expect(result.text).toContain('Apply was disabled because one or more SCPI commands did not exactly match');
  });

  it('disables hosted apply when raw SCPI survived without materialization and verification tools', async () => {
    const text = JSON.stringify({
      name: 'Exact But Ungated Flow',
      description: 'Exact SCPI should still fail closed if hosted tools skipped materialize/verify.',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        {
          id: '2',
          type: 'write',
          label: 'Set termination',
          params: { command: 'CH1:TERMINATION 50' },
        },
        { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    });

    const result = await postCheckResponse(
      text,
      { backend: 'pyvisa', modelFamily: 'MSO4/5/6 Series', originalSteps: [] },
      {
        assistantMode: true,
        toolTrace: [
          { name: 'search_scpi' },
          { name: 'get_command_by_header' },
          { name: 'get_commands_by_header_batch' },
        ],
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"actions":[]');
    expect(result.text).toContain('did not use MCP exact materialization before returning JSON');
    expect(result.text).toContain('finalize_scpi_commands or materialize_scpi_command/materialize_scpi_commands');
  });

  it('keeps hosted apply when raw SCPI was materialized and verified through MCP', async () => {
    const text = JSON.stringify({
      name: 'Exact Verified Flow',
      description: 'Exact SCPI with hosted materialization + verify should stay applyable.',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        {
          id: '2',
          type: 'write',
          label: 'Set termination',
          params: { command: 'CH1:TERMINATION 50' },
        },
        { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    });

    const result = await postCheckResponse(
      text,
      { backend: 'pyvisa', modelFamily: 'MSO4/5/6 Series', originalSteps: [] },
      {
        assistantMode: true,
        toolTrace: [
          { name: 'search_scpi' },
          { name: 'get_command_by_header' },
          { name: 'materialize_scpi_commands' },
          { name: 'verify_scpi_commands' },
        ],
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"type":"replace_flow"');
    expect(result.text).not.toContain('"actions":[]');
  });

  it('keeps hosted apply for pre-verified SCPI when materialized through MCP even if verify_scpi_commands was skipped', async () => {
    const text = JSON.stringify({
      name: 'Exact Materialized Common Flow',
      description: 'Common pre-verified SCPI should not require hosted verify tool every time.',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
        {
          id: '2',
          type: 'write',
          label: 'Set termination',
          params: { command: 'CH1:TERMINATION 50' },
        },
        { id: '3', type: 'disconnect', label: 'Disconnect', params: {} },
      ],
    });

    const result = await postCheckResponse(
      text,
      { backend: 'pyvisa', modelFamily: 'MSO4/5/6 Series', originalSteps: [] },
      {
        assistantMode: true,
        toolTrace: [
          { name: 'search_scpi' },
          { name: 'get_command_by_header' },
          { name: 'materialize_scpi_commands' },
        ],
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"type":"replace_flow"');
    expect(result.text).not.toContain('"actions":[]');
  });

  it('fills connect and disconnect instrumentIds from the single workspace alias for chat applyability', async () => {
    const text = JSON.stringify({
      name: 'Connect And Screenshot',
      description: 'Simple flow with missing instrumentIds arrays.',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: [], printIdn: true } },
        {
          id: '2',
          type: 'save_screenshot',
          label: 'Save Screenshot',
          params: { filename: 'capture.png', scopeType: 'modern', method: 'pc_transfer' },
        },
        { id: '3', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } },
      ],
    });

    const result = await postCheckResponse(
      text,
      {
        backend: 'pyvisa',
        modelFamily: 'MSO4/5/6 Series',
        originalSteps: [],
        instrumentMap: [{ alias: 'scope1' }],
      },
      { assistantMode: true }
    );

    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"instrumentIds":["scope1"]');
    expect(result.text).toContain('direct chat apply compatibility');
  });

  it('downgrades long prose truncation to a warning instead of an error', async () => {
    const prose = 'This is a long explanatory sentence. '.repeat(30);
    const text = `${prose}\n\nACTIONS_JSON: ${JSON.stringify({
      summary: 'Do the thing.',
      findings: [],
      suggestedFixes: [],
      actions: [
        {
          type: 'replace_flow',
          flow: {
            name: 'Connect Only',
            description: 'Simple flow',
            backend: 'pyvisa',
            deviceType: 'SCOPE',
            steps: [
              { id: '1', type: 'connect', label: 'Connect', params: { printIdn: true } },
              { id: '2', type: 'disconnect', label: 'Disconnect', params: {} },
            ],
          },
        },
      ],
    })}`;

    const result = await postCheckResponse(
      text,
      { backend: 'pyvisa', modelFamily: 'MSO4/5/6 Series', originalSteps: [] },
      { assistantMode: true }
    );

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain('Prose exceeded 400 characters and was truncated.');
    expect(result.text).toContain('ACTIONS_JSON:');
    expect(result.text.length).toBeLessThan(text.length);
  });
});
