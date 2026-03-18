import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssistantUserPrompt,
  buildHostedOpenAiResponsesRequest,
  buildHostedResponsesTools,
  runToolLoop,
} from '../src/core/toolLoop';

describe('behavioral.hostedResponses', () => {
  afterEach(() => {
    delete process.env.OPENAI_PROMPT_VERSION;
    delete process.env.COMMAND_VECTOR_STORE_ID;
    vi.restoreAllMocks();
  });

  it('builds a stored Responses request with prompt id and previous response cursor', () => {
    process.env.OPENAI_PROMPT_VERSION = '12';
    const payload = buildHostedOpenAiResponsesRequest(
      {
        userMessage: 'Save setup',
        outputMode: 'steps_json',
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4.1',
        openaiAssistantId: 'pmpt_12345',
        openaiThreadId: 'resp_prev_123',
        history: [
          { role: 'user', content: 'older user turn' },
          { role: 'assistant', content: 'older assistant turn' },
        ],
        flowContext: {
          backend: 'pyvisa',
          host: '127.0.0.1',
          connectionType: 'tcpip',
          modelFamily: 'MSO4/5/6 Series',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
        },
        runContext: {
          runStatus: 'idle',
          logTail: '',
          auditOutput: '',
          exitCode: null,
        },
      },
      'Current user request'
    ) as Record<string, unknown>;

    expect(payload.model).toBe('gpt-4.1');
    expect(payload.store).toBe(true);
    expect(payload.stream).toBe(false);
    expect(payload.temperature).toBe(0.1);
    expect(payload.previous_response_id).toBe('resp_prev_123');
    expect((payload.prompt as Record<string, unknown>).id).toBe('pmpt_12345');
    expect((payload.prompt as Record<string, unknown>).version).toBe('12');
    expect(payload.input).toEqual([{ role: 'user', content: 'Current user request' }]);
  });

  it('uses the requested hosted model instead of forcing gpt-4.1', () => {
    const payload = buildHostedOpenAiResponsesRequest(
      {
        userMessage: 'Save setup',
        outputMode: 'steps_json',
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-5.4',
        openaiAssistantId: 'pmpt_12345',
        flowContext: {
          backend: 'pyvisa',
          host: '127.0.0.1',
          connectionType: 'tcpip',
          modelFamily: 'MSO4/5/6 Series',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
        },
        runContext: {
          runStatus: 'idle',
          logTail: '',
          auditOutput: '',
          exitCode: null,
        },
      },
      'Current user request'
    ) as Record<string, unknown>;

    expect(payload.model).toBe('gpt-5.4');
    expect(payload.temperature).toBeUndefined();
  });

  it('seeds recent history only when there is no previous response cursor', () => {
    const payload = buildHostedOpenAiResponsesRequest(
      {
        userMessage: 'Save screenshot',
        outputMode: 'steps_json',
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4.1',
        openaiAssistantId: 'pmpt_12345',
        history: [
          { role: 'user', content: 'first turn' },
          { role: 'assistant', content: 'first reply' },
        ],
        flowContext: {
          backend: 'pyvisa',
          host: '127.0.0.1',
          connectionType: 'tcpip',
          modelFamily: 'MSO4/5/6 Series',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
        },
        runContext: {
          runStatus: 'idle',
          logTail: '',
          auditOutput: '',
          exitCode: null,
        },
      },
      'Current user request'
    ) as Record<string, unknown>;

    expect(payload.previous_response_id).toBeUndefined();
    expect(payload.input).toEqual([
      { role: 'user', content: 'first turn' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'Current user request' },
    ]);
  });

  it('omits the static contract when a hosted prompt is configured', () => {
    process.env.COMMAND_VECTOR_STORE_ID = 'vs_test_123';
    const prompt = buildAssistantUserPrompt(
      {
        userMessage: 'Save screenshot',
        outputMode: 'steps_json',
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4.1',
        openaiAssistantId: 'pmpt_12345',
        flowContext: {
          backend: 'pyvisa',
          host: '127.0.0.1',
          connectionType: 'tcpip',
          modelFamily: 'MSO4/5/6 Series',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
          deviceType: 'SCOPE',
        },
        runContext: {
          runStatus: 'idle',
          logTail: '',
          auditOutput: '',
          exitCode: null,
        },
      },
      [],
      { hostedPromptConfigured: true }
    );

    expect(prompt).toContain('Hosted Responses prompt is configured.');
    expect(prompt).toContain('Treat the stored prompt as the authority for TekAutomate schema, apply rules, Blockly rules, and tool-usage policy.');
    expect(prompt).toContain('Use this runtime message only for dynamic workspace context, current request details, and any preloaded verification findings for this turn.');
    expect(prompt).toContain('Hosted file_search is available for this turn.');
    expect(prompt).toContain('Treat file_search results as source discovery only.');
    expect(prompt).toContain('If SCPI or tm_devices syntax is not verified by retrieved MCP tool results for this turn, fail closed instead of guessing.');
    expect(prompt).not.toContain('TekAutomate schema rules:');
    expect(prompt).not.toContain('Never invent pseudo-step types such as set_channel');
    expect(prompt).not.toContain('save_screenshot -> params { filename: "capture.png", scopeType: "modern|legacy", method: "pc_transfer" }');
    expect(prompt).toContain('User request:');
    expect(prompt).toContain('Save screenshot');
  });

  it('uses a chat-friendly JSON-block contract for inline fallback mode', () => {
    const prompt = buildAssistantUserPrompt(
      {
        userMessage: 'Save screenshot',
        outputMode: 'steps_json',
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4.1',
        flowContext: {
          backend: 'pyvisa',
          host: '127.0.0.1',
          connectionType: 'tcpip',
          modelFamily: 'MSO4/5/6 Series',
          steps: [],
          selectedStepId: null,
          executionSource: 'steps',
          deviceType: 'SCOPE',
        },
        runContext: {
          runStatus: 'idle',
          logTail: '',
          auditOutput: '',
          exitCode: null,
        },
      }
    );

    expect(prompt).toContain('Chat response contract:');
    expect(prompt).toContain('prefer one or more parseable ```json``` blocks');
    expect(prompt).toContain('Use only real TekAutomate step types');
    expect(prompt).toContain('Never invent pseudo-step types such as set_channel');
    expect(prompt).toContain('For query steps, use params.command, never params.query, and always include params.saveAs.');
    expect(prompt).toContain('For sleep steps, use duration, never seconds.');
    expect(prompt).toContain('prefer finalize_scpi_commands');
    expect(prompt).not.toContain('no markdown fences');
  });

  it('builds narrowed hosted Responses tools for pyvisa steps_json turns', () => {
    process.env.COMMAND_VECTOR_STORE_ID = 'vs_test_123';
    const tools = buildHostedResponsesTools({
      userMessage: 'Set CH1 to 500mV DC 50 ohm',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'search_scpi')).toBe(true);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'get_command_group')).toBe(true);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'get_commands_by_header_batch')).toBe(true);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'materialize_scpi_command')).toBe(true);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'materialize_scpi_commands')).toBe(true);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'materialize_tm_devices_call')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'validate_action_payload')).toBe(true);
    expect(tools.some((tool) => tool.type === 'file_search')).toBe(true);
  });

  it('uses a batch-materialize fast path for common preloaded SCPI turns', () => {
    process.env.COMMAND_VECTOR_STORE_ID = 'vs_test_123';
    const tools = buildHostedResponsesTools({
      userMessage: 'Set CH1 to 500mV DC 50 ohm',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    }, 'initial', { batchMaterializeOnly: true });

    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'finalize_scpi_commands')).toBe(true);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'materialize_scpi_command')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'materialize_scpi_commands')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'search_scpi')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'get_command_by_header')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'get_commands_by_header_batch')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'verify_scpi_commands')).toBe(false);
    expect(tools.some((tool) => tool.type === 'function' && tool.name === 'validate_action_payload')).toBe(false);
    expect(tools.some((tool) => tool.type === 'file_search')).toBe(false);

    const finalizeTools = buildHostedResponsesTools({
      userMessage: 'Set CH1 to 500mV DC 50 ohm',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    }, 'finalize', { batchMaterializeOnly: true });

    expect(finalizeTools).toEqual([]);
  });

  it('uses hosted Responses tool calls for steps_json assistant builds', async () => {
    const finalFlow = {
      name: 'Generated Flow',
      description: 'Minimal verified flow',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', params: { printIdn: true } },
        { id: '2', type: 'disconnect', params: {} },
      ],
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp_1',
          output: [
            {
              type: 'function_call',
              name: 'search_scpi',
              call_id: 'call_1',
              arguments: JSON.stringify({
                query: 'Connect to scope and print the IDN',
                modelFamily: 'MSO4/5/6 Series',
                limit: 8,
              }),
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp_2',
          output_text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
          output: [
            {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
                },
              ],
            },
          ],
        }),
      } as Response);

    const result = await runToolLoop({
      userMessage: 'Connect to scope and print the IDN',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.assistantThreadId).toBeUndefined();
    expect(result.text).toContain('*IDN?');
    expect(result.text).toContain('"type":"query"');
  });

  it('short-circuits hosted structured reset requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Reset scope to factory defaults',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.text).toContain('"type":"replace_flow"');
    expect(result.text).toContain('"type":"recall"');
    expect(result.text).toContain('"recallType":"FACTORY"');
  });

  it('short-circuits hosted structured common channel setup requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Set CH1 to 500mV DC 50 ohm',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"type":"replace_flow"');
    expect(result.text).toContain('CH1:');
  });

  it('short-circuits common hosted edit requests into insert actions when the flow already exists', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Set CH1 to 500mV DC 50 ohm and set trigger on CH1 rising at 100mV normal mode',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: ['scope1'], printIdn: true } },
          { id: '2', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: ['scope1'] } },
        ],
        selectedStepId: '1',
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('"type":"insert_step_after"');
    expect(result.text).toContain('"targetStepId":"1"');
    expect(result.text).toContain('CH1:');
    expect(result.text).toContain('TRIGger:A:EDGE:SOUrce CH1');
  });

  it('short-circuits hosted structured I2C decode and bus-trigger requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'Set CH1 to 3.3V DC 1Mohm for SCL, CH2 to 3.3V DC 1Mohm for SDA. Set up I2C decode on B1 clock CH1 threshold 1.65V data CH2 threshold 1.65V. Set trigger on B1 I2C address 0x48 direction write. Single acquisition. Save both channels as binary and screenshot.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('Configure B1 I2C decode');
    expect(result.text).toContain('BUS:B1:I2C:CLOCk:SOUrce CH1');
    expect(result.text).toContain('Configure B1 I2C trigger');
    expect(result.text).toContain('TRIGger:A:BUS:B1:I2C:ADDRess:MODe ADDR7');
    expect(result.text).toContain('"type":"save_waveform"');
    expect(result.text).toContain('"type":"save_screenshot"');
  });

  it('short-circuits I2C setup and hold measurement requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'I2C signal integrity test: CH1 SCL 3.3V DC 1Mohm, CH2 SDA 3.3V DC 1Mohm. Set up I2C decode B1 clock CH1 1.65V data CH2 1.65V. Add setup time and hold time measurements. Trigger on I2C address 0x48 write. Single sequence. Query setup and hold results. Save both channels binary. Screenshot.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('Configure B1 I2C decode');
    expect(result.text).toContain('Configure B1 I2C trigger');
    expect(result.text).toContain('MEASUrement:MEAS1:TYPe SETUP');
    expect(result.text).toContain('MEASUrement:MEAS1:SOUrce1 CH1');
    expect(result.text).toContain('MEASUrement:MEAS1:SOUrce2 CH2');
    expect(result.text).toContain('MEASUrement:MEAS2:TYPe HOLD');
    expect(result.text).toContain('MEASUrement:MEAS2:SOUrce1 CH1');
    expect(result.text).toContain('MEASUrement:MEAS2:SOUrce2 CH2');
    expect(result.text).toContain('"saveAs":"ch1_ch2_setup"');
    expect(result.text).toContain('"saveAs":"ch1_ch2_hold"');
    expect(result.text).toContain('"type":"save_waveform"');
    expect(result.text).toContain('"type":"save_screenshot"');
  });

  it('short-circuits hosted structured CAN decode/search/FastFrame requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'Set up CAN FD decode on B1 source CH2 500kbps nominal 2Mbps data phase ISO standard. Set up search on B1 for CAN FD error frames. Set edge trigger on CH2 rising at 1.65V normal mode. Enable FastFrame 500 frames single sequence. After capture query FastFrame timestamp for all frames, save CH2 waveform as binary and screenshot.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('BUS:B1:CAN:SOUrce 2');
    expect(result.text).toContain('BUS:B1:CAN:BITRate RATE500K');
    expect(result.text).toContain('BUS:B1:CAN:FD:BITRate RATE2M');
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition FRAMEtype');
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype ERRor');
    expect(result.text).toContain('HORizontal:FASTframe:COUNt 500');
    expect(result.text).toContain('HORizontal:FASTframe:TIMEStamp:ALL?');
  });

  it('short-circuits simple existing-flow fastframes edits for the exact "add 50 fastframes" phrasing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'add 50 fastframes',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: ['scope1'], printIdn: true } },
          { id: '2', type: 'write', label: 'Existing write', params: { command: 'CH1:SCAle 0.5' } },
          { id: '3', type: 'save_screenshot', label: 'Screenshot', params: { filename: 'shot.png' } },
        ],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('HORizontal:FASTframe:STATE ON');
    expect(result.text).toContain('HORizontal:FASTframe:COUNt 50');
    expect(result.text).toContain('"type":"insert_step_after"');
  });

  it('short-circuits hosted structured delay-measurement requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'Set CH1 to 200mV DC 50ohm VDD_CORE, CH4 to 2V DC 1Mohm PGOOD. Set trigger on CH4 rising edge 1V normal mode. Single acquisition. Add delay measurement from CH4 rising to CH1 crossing 100mV. Query all results and take screenshot.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('MEASUrement:MEAS1:SOUrce1 CH4');
    expect(result.text).toContain('MEASUrement:MEAS1:SOUrce2 CH1');
    expect(result.text).toContain('MEASUrement:MEAS1:DELay:EDGE1 RISe');
    expect(result.text).toContain('MEASUrement:MEAS1:DELay:EDGE2 RISe');
    expect(result.text).toContain('MEASUrement:MEAS1:REFLevels2:METHod ABSolute');
    expect(result.text).toContain('MEASUrement:MEAS1:REFLevels2:ABSolute:RISEMid 0.1');
    expect(result.text).toContain('"saveAs":"delay_ch4_to_ch1"');
  });

  it('short-circuits hosted structured eye/jitter measurement requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'Set CH1 to 200mV DC 50ohm for high speed serial data. Set horizontal scale to 500ps per div record length 10 million samples. Set trigger to edge CH1 rising at 0V normal mode. Enable fast acquisition with temperature palette. Set acquisition to run continuous for 30 seconds. Add eye height eye width and jitter measurements on CH1. Query all results. Save screenshot of eye diagram.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('MEASUrement:DELETEALL');
    expect(result.text).toContain('MEASUrement:MEAS1:TYPe EYEHIGH');
    expect(result.text).toContain('MEASUrement:MEAS2:TYPe WIDTHBER');
    expect(result.text).toContain('MEASUrement:MEAS3:TYPe TIE');
    expect(result.text).toContain('ACQuire:FASTAcq:PALEtte TEMPerature');
    expect(result.text).toContain('HORizontal:RECOrdlength 10000000');
    expect(result.text).toContain('"saveAs":"ch1_eye_height"');
    expect(result.text).toContain('"saveAs":"ch1_eye_width"');
    expect(result.text).toContain('"saveAs":"ch1_jitter"');
  });

  it('short-circuits hosted structured deeper CAN search requests through the server-side common shortcut', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'Set up CAN FD decode on B1 source CH2 500kbps nominal 2Mbps data phase ISO standard. Set up search on B1 for CAN FD any error with BRS bit 1 and ESI bit 0. Single acquisition.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:CONDition FDBITS');
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FD:BRSBit ONE');
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FD:ESIBit ZERo');
  });

  it('strips hosted applyable SCPI when the model skipped materialization and verification tools', async () => {
    const finalFlow = {
      name: 'Generated Flow',
      description: 'Exact SCPI but lookup-only hosted path',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', params: { printIdn: true } },
        { id: '2', type: 'write', params: { command: 'CH1:TERMINATION 50' } },
        { id: '3', type: 'disconnect', params: {} },
      ],
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp_lookup_only_1',
          output: [
            {
              type: 'function_call',
              name: 'search_scpi',
              call_id: 'call_lookup_only_1',
              arguments: JSON.stringify({
                query: 'Set CH1 termination to 50 ohm',
                modelFamily: 'MSO4/5/6 Series',
                limit: 8,
              }),
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp_lookup_only_2',
          output_text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
          output: [
            {
              id: 'msg_lookup_only_2',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
                },
              ],
            },
          ],
        }),
      } as Response);

    const result = await runToolLoop({
      userMessage: 'Set CH1 termination to 50 ohm',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.text).toContain('CH1:TERmination 50');
    expect(result.text).toContain('"replace_flow"');
  });

  it('forces a final hosted answer pass after repeated tool rounds', async () => {
    const finalFlow = {
      name: 'Generated Flow',
      description: 'Forced final answer after tool rounds',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', params: { printIdn: true } },
        { id: '2', type: 'disconnect', params: {} },
      ],
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (let i = 1; i <= 4; i += 1) {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: `resp_${i}`,
          output: [
            {
              type: 'function_call',
              name: 'search_scpi',
              call_id: `call_${i}`,
              arguments: JSON.stringify({
                query: `round ${i}`,
                modelFamily: 'MSO4/5/6 Series',
                limit: 8,
              }),
            },
          ],
        }),
      } as Response);
    }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'resp_final',
        output_text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
        output: [
          {
            id: 'msg_final',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
              },
            ],
          },
        ],
      }),
    } as Response);

    const result = await runToolLoop({
      userMessage: 'Build a verified flow from repeated source-of-truth retrieval',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const lastBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body || '{}')) as Record<string, unknown>;
    expect(lastBody.previous_response_id).toBe('resp_4');
    expect(lastBody.tools).toBeUndefined();
    expect(Array.isArray(lastBody.input)).toBe(true);
    expect((lastBody.input as Array<Record<string, unknown>>)[0]?.type).toBe('function_call_output');
    expect((lastBody.input as Array<Record<string, unknown>>)[1]?.role).toBe('user');
    expect(String((lastBody.input as Array<Record<string, unknown>>)[1]?.content || '')).toContain('Tool retrieval is complete for this turn');

    expect(result.assistantThreadId).toBe('resp_final');
    expect(result.metrics?.iterations).toBe(5);
    expect(result.text).toContain('"type":"replace_flow"');
  });

  it('forces a final hosted answer pass immediately after verify_scpi_commands', async () => {
    const finalFlow = {
      name: 'Verified Flow',
      description: 'Final answer after verification',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      steps: [
        { id: '1', type: 'connect', params: { printIdn: true } },
        { id: '2', type: 'disconnect', params: {} },
      ],
    };

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp_verify',
          output: [
            {
              type: 'function_call',
              name: 'verify_scpi_commands',
              call_id: 'call_verify',
              arguments: JSON.stringify({
                commands: ['*IDN?'],
                modelFamily: 'MSO4/5/6 Series',
              }),
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'resp_final_verify',
          output_text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
          output: [
            {
              id: 'msg_verify_final',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: `\`\`\`json\n${JSON.stringify(finalFlow)}\n\`\`\``,
                },
              ],
            },
          ],
        }),
      } as Response);

    const result = await runToolLoop({
      userMessage: 'Build a verified connect flow',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body || '{}')) as Record<string, unknown>;
    expect(secondBody.tools).toBeUndefined();
    expect(Array.isArray(secondBody.input)).toBe(true);
    expect((secondBody.input as Array<Record<string, unknown>>)[0]?.type).toBe('function_call_output');
    expect(result.assistantThreadId).toBe('resp_final_verify');
    expect(result.text).toContain('"type":"replace_flow"');
  });

  it('short-circuits hosted measurement requests through the deterministic shortcut path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Add frequency and amplitude measurements on CH1 and query both results',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-4.1',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.assistantThreadId).toBeUndefined();
    expect(result.text).toContain('"type":"replace_flow"');
    expect(result.text).toContain('MEASUrement:DELETEALL');
    expect(result.text).toContain('MEASUrement:MEAS1:TYPe FREQUENCY');
    expect(result.text).toContain('MEASUrement:MEAS1:SOURCE CH1');
    expect(result.text).toContain('MEASUrement:MEAS2:TYPe AMPLITUDE');
    expect(result.text).toContain('"saveAs":"ch1_frequency"');
    expect(result.text).toContain('"saveAs":"ch1_amplitude"');
  });

  it('short-circuits generic measurement-workflow requests through the deterministic shortcut path using current scope context', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage:
        'Give me a smart measurement workflow for the current scope context and include the flow steps using only valid TekAutomate step types.',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: ['scope1'], printIdn: true } },
          { id: '2', type: 'comment', label: 'Comment', params: { text: 'existing flow' } },
          { id: '3', type: 'save_screenshot', label: 'Save screenshot', params: { filename: 'capture.png', scopeType: 'modern', method: 'pc_transfer' } },
          { id: '4', type: 'save_waveform', label: 'Save waveform', params: { source: 'CH1', filename: 'ch1.bin', format: 'bin' } },
          { id: '5', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } },
        ],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.metrics?.iterations).toBe(0);
    expect(result.assistantThreadId).toBeUndefined();
    expect(result.text).toContain('"type":"insert_step_after"');
    expect(result.text).toContain('MEASUrement:DELETEALL');
    expect(result.text).toContain('MEASUrement:MEAS1:TYPe FREQUENCY');
    expect(result.text).toContain('MEASUrement:MEAS1:SOURCE CH1');
    expect(result.text).toContain('MEASUrement:MEAS6:TYPe RMS');
    expect(result.text).toContain('"saveAs":"ch1_frequency"');
    expect(result.text).toContain('"saveAs":"ch1_rms"');
  });

  it('short-circuits planner-resolved AFG requests without calling OpenAI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Set sine wave 1kHz 2Vpp 50ohm output on',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'AFG31000',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'AFG',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.text).toContain('SOURce1:FREQuency:FIXed 1000');
    expect(result.text).toContain('OUTPut1:STATe ON');
  });

  it('short-circuits planner-resolved SMU requests without calling OpenAI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Source 3.3V current limit 100mA output on then measure current',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'Keithley 2450 SMU',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SMU',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.text).toContain(':SENSe:CURRent:PROTection 0.1');
    expect(result.text).toContain(':SENSe:FUNCtion \\"CURRent\\"');
  });

  it('short-circuits CAN FD search requests through planner SEARCH commands', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Search on B1 for CAN FD error frames and query FastFrame timestamps for all frames',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:TYPe BUS');
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:SOUrce B1');
    expect(result.text).toContain('SEARCH:SEARCH1:TRIGger:A:BUS:CAN:FRAMEtype ERRor');
  });

  it('short-circuits direct IDN execution requests without planner or model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await runToolLoop({
      userMessage: 'Connect to scope and print the IDN',
      outputMode: 'steps_json',
      provider: 'openai',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      openaiAssistantId: 'pmpt_12345',
      flowContext: {
        backend: 'pyvisa',
        host: '127.0.0.1',
        connectionType: 'tcpip',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        selectedStepId: null,
        executionSource: 'steps',
        deviceType: 'SCOPE',
      },
      runContext: {
        runStatus: 'idle',
        logTail: '',
        auditOutput: '',
        exitCode: null,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.metrics?.usedShortcut).toBe(true);
    expect(result.text).toContain('*IDN?');
    expect(result.text).toContain('"type":"query"');
  });
});
