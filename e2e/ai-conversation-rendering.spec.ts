import { test, expect, type Page } from '@playwright/test';
import { gotoApp, handleDialogs } from './helpers';

type MockChatResponse = {
  text: string;
  displayText?: string;
  openaiThreadId?: string;
};

async function seedConversationState(page: Page, backend: 'pyvisa' | 'tm_devices' = 'pyvisa') {
  handleDialogs(page);
  await page.addInitScript(
    ({ chosenBackend }) => {
      localStorage.setItem('tekautomate_wizard_shown', 'true');
      localStorage.setItem('tekautomate_tour_completed', 'true');
      localStorage.setItem('tek_automator_auth', 'granted');
      localStorage.setItem(
        'tekautomate.ai.chat.state',
        JSON.stringify({
          history: [],
          provider: 'openai',
          model: 'gpt-5.4-mini',
          mode: 'mcp_ai',
          interactionMode: 'chat',
          apiKey: 'test-openai-key',
          routingStrategy: 'assistant',
          openaiAssistantId: '',
          openaiThreadId: '',
          toolCallMode: false,
        })
      );
      localStorage.setItem(
        'tekautomate.instrument.preferences',
        JSON.stringify({
          backend: chosenBackend,
        })
      );
    },
    { chosenBackend: backend }
  );
}

async function gotoExecute(page: Page) {
  await gotoApp(page);
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: /^Execute$/i }).click();
  await expect(page.getByText('AI Assistant')).toBeVisible({ timeout: 15000 });
}

async function ensureChatMode(page: Page) {
  const chatButtons = page.getByRole('button', { name: /^Chat$/i });
  if ((await chatButtons.count()) > 0) {
    await chatButtons.first().click();
  }
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder(/Ask about jitter|Ask for a flow build/i);
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(prompt);
  await page.getByRole('button', { name: /^Send$/i }).click();
}

function compactWaveformFlowResponse(): MockChatResponse {
  return {
    text:
      'Compact waveform-capture flow ready.\n\n' +
      JSON.stringify({
        name: 'Compact Waveform Capture',
        description: 'Setup, single acquisition, save CH1/CH2 waveforms, and save screenshot.',
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: [], printIdn: true } },
          {
            id: 'g1',
            type: 'group',
            label: 'Setup',
            params: {},
            collapsed: false,
            children: [
              { id: '2', type: 'write', label: 'Enable CH1', params: { command: 'SELect:CH1 ON' } },
              { id: '3', type: 'write', label: 'Enable CH2', params: { command: 'SELect:CH2 ON' } },
              { id: '4', type: 'write', label: 'Single acquisition', params: { command: 'ACQuire:STOPAfter SEQuence' } },
              { id: '5', type: 'write', label: 'Run', params: { command: 'ACQuire:STATE RUN' } },
            ],
          },
          {
            id: 'g2',
            type: 'group',
            label: 'Save Results',
            params: {},
            collapsed: false,
            children: [
              { id: '6', type: 'save_waveform', label: 'Save CH1', params: { source: 'CH1', filename: 'CH1.wfm', format: 'wfm' } },
              { id: '7', type: 'save_waveform', label: 'Save CH2', params: { source: 'CH2', filename: 'CH2.wfm', format: 'wfm' } },
              { id: '8', type: 'save_screenshot', label: 'Save screenshot', params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' } },
            ],
          },
          { id: '9', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } },
        ],
      }),
  };
}

function tmDevicesFlowResponse(): MockChatResponse {
  return {
    text:
      'Here is the tm_devices version as a TekAutomate flow.\n\n' +
      JSON.stringify({
        name: 'TM Devices Capture',
        description: 'Capture and save via tm_devices commands.',
        backend: 'tm_devices',
        deviceType: 'SCOPE',
        steps: [
          { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: [], printIdn: true } },
          {
            id: 'g1',
            type: 'group',
            label: 'tm_devices Flow',
            params: {},
            collapsed: false,
            children: [
              {
                id: '2',
                type: 'tm_device_command',
                label: 'Single acquisition',
                params: {
                  code: "scope.commands.acquire.stopafter.write('SEQUENCE')",
                  model: 'DPO7000',
                  description: 'Configure single sequence',
                },
              },
              {
                id: '3',
                type: 'tm_device_command',
                label: 'Run acquisition',
                params: {
                  code: "scope.commands.acquire.state.write('RUN')",
                  model: 'DPO7000',
                  description: 'Start acquisition',
                },
              },
            ],
          },
          { id: '4', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } },
        ],
      }),
  };
}

test.describe('AI conversation rendering', () => {
  test('chat -> build it renders parsed flow cleanly instead of dumping JSON', async ({ page }) => {
    test.setTimeout(180000);
    await seedConversationState(page, 'pyvisa');

    let requestCount = 0;
    await page.route('**/ai/chat', async (route) => {
      requestCount += 1;
      let payload: MockChatResponse;
      if (requestCount >= 2) {
        payload = compactWaveformFlowResponse();
      } else {
        payload = {
          text: 'I can build that as a compact capture flow. Say "build it" and I will turn it into a TekAutomate flow.',
        };
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await gotoExecute(page);
    await ensureChatMode(page);
    await sendPrompt(page, 'Create a compact waveform-capture flow: setup, single acquisition, save CH1/CH2 waveforms, and save screenshot.');
    await expect(page.getByText(/say "build it"|i can build that/i)).toBeVisible({ timeout: 15000 });

    await sendPrompt(page, 'build it');
    await expect.poll(() => requestCount).toBeGreaterThanOrEqual(2);
    const apply = page.getByRole('button', { name: /^Use this \d+-step flow$|^Use this flow$/i }).last();
    await expect(apply).toBeVisible({ timeout: 15000 });

    await expect(page.getByText('Compact waveform-capture flow ready.')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/"steps"|\"type\":\"connect\"/i)).toHaveCount(0);

    await apply.click();
    await expect(page.getByRole('button', { name: /^Applied$/i }).last()).toBeVisible({ timeout: 15000 });

    const workspaceText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
    expect(workspaceText).toContain('Save CH1');
    expect(workspaceText).toContain('Save CH2');
    expect(workspaceText).toContain('Save screenshot');
  });

  test('tm_devices flow handoff stays structured and does not surface Python download affordance', async ({ page }) => {
    test.setTimeout(180000);
    await seedConversationState(page, 'tm_devices');

    let requestCount = 0;
    await page.route('**/ai/chat', async (route) => {
      requestCount += 1;
      const payload: MockChatResponse = requestCount >= 2
        ? tmDevicesFlowResponse()
        : { text: 'I can build that as a tm_devices Steps flow. Say "build it".' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await gotoExecute(page);
    await ensureChatMode(page);
    await sendPrompt(page, 'Create a compact waveform-capture flow with tm_devices.');
    await expect(page.getByText(/tm_devices steps flow|say "build it"/i)).toBeVisible({ timeout: 15000 });

    await sendPrompt(page, 'build it');
    await expect.poll(() => requestCount).toBeGreaterThanOrEqual(2);
    const flowCard = page.getByText('Here is the tm_devices version as a TekAutomate flow.');
    await expect(flowCard).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Download \.py/i })).toHaveCount(0);
    const actionButton = page.getByRole('button', { name: /^Use this \d+-step flow$|^Use this flow$|^Applied$/i }).last();
    await expect(actionButton).toBeVisible({ timeout: 15000 });
    if (((await actionButton.textContent()) || '').trim() !== 'Applied') {
      await actionButton.click();
      await expect(actionButton).toHaveText(/Applied/i, { timeout: 15000 });
    }

    const workspaceText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
    expect(workspaceText).toContain('TM DEVICE COMMAND');
    expect(workspaceText).toContain("scope.commands.acquire.state.write('RUN')");
  });

  test('chat affirmations like yes promote an agreed flow change into build/apply', async ({ page }) => {
    test.setTimeout(180000);
    await seedConversationState(page, 'pyvisa');

    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    await page.route('**/ai/chat', async (route) => {
      requestCount += 1;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requestBodies.push(body);

      if (requestCount === 1) {
        const firstPayload: MockChatResponse = {
          displayText:
            'I can rewrite your flow for offline-only mode. Say yes and I will apply the offline-only changes.',
          text:
            'I can rewrite your flow for offline-only mode.\n' +
            'ACTIONS_JSON: ' +
            JSON.stringify({
              summary: 'Prepared offline-only flow update.',
              findings: [],
              suggestedFixes: [],
              actions: [
                {
                  id: 'offline_replace',
                  action_type: 'replace_flow',
                  payload: {
                    steps: [
                      { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: [], printIdn: true } },
                      {
                        id: 'g1',
                        type: 'group',
                        label: 'Offline Measurements',
                        params: {},
                        collapsed: false,
                        children: [
                          { id: '2', type: 'write', label: 'Measurement 1 type', params: { command: 'MEASUrement:MEAS1:TYPe JITTERSUMMARY' } },
                          { id: '3', type: 'write', label: 'Measurement 1 source', params: { command: 'MEASUrement:MEAS1:SOUrce1 CH1' } },
                          { id: '4', type: 'write', label: 'Measurement 1 state', params: { command: 'MEASUrement:MEAS1:STATE ON' } },
                          { id: '5', type: 'query', label: 'Read jitter summary', params: { command: 'MEASUrement:MEAS1:VALue?', saveAs: 'jitter_summary' } },
                        ],
                      },
                      { id: '6', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } },
                    ],
                  },
                },
              ],
            }),
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(firstPayload),
        });
        return;
      }

      const secondPayload: MockChatResponse = {
        text:
          'ACTIONS_JSON: ' +
          JSON.stringify({
            summary: 'Applied the offline-only flow update.',
            findings: [],
            suggestedFixes: [],
            actions: [
              {
                id: 'offline_replace_confirmed',
                action_type: 'replace_flow',
                payload: {
                  steps: [
                    { id: '1', type: 'connect', label: 'Connect', params: { instrumentIds: [], printIdn: true } },
                    {
                      id: 'g1',
                      type: 'group',
                      label: 'Offline Measurements',
                      params: {},
                      collapsed: false,
                      children: [
                        { id: '2', type: 'write', label: 'Measurement 1 type', params: { command: 'MEASUrement:MEAS1:TYPe JITTERSUMMARY' } },
                        { id: '3', type: 'write', label: 'Measurement 1 source', params: { command: 'MEASUrement:MEAS1:SOUrce1 CH1' } },
                        { id: '4', type: 'write', label: 'Measurement 1 state', params: { command: 'MEASUrement:MEAS1:STATE ON' } },
                        { id: '5', type: 'query', label: 'Read jitter summary', params: { command: 'MEASUrement:MEAS1:VALue?', saveAs: 'jitter_summary' } },
                      ],
                    },
                    { id: '6', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } },
                  ],
                },
              },
            ],
          }),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(secondPayload),
      });
    });

    await gotoExecute(page);
    await ensureChatMode(page);
    await sendPrompt(page, 'offline only');
    await expect(page.getByText(/offline-only mode/i)).toBeVisible({ timeout: 15000 });

    await sendPrompt(page, 'yes');
    await expect.poll(() => requestCount).toBeGreaterThanOrEqual(2);
    expect(String(requestBodies[1]?.outputMode || '')).toBe('steps_json');
    expect(Array.isArray(requestBodies[1]?.flowContext && (requestBodies[1].flowContext as Record<string, unknown>).steps)).toBe(true);

    const apply = page.getByRole('button', { name: /^Use this \d+-step flow$|^Use this flow$/i }).last();
    await expect(apply).toBeVisible({ timeout: 15000 });
    await apply.click();
    await expect(page.getByRole('button', { name: /^Applied$/i }).last()).toBeVisible({ timeout: 15000 });

    const workspaceText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
    expect(workspaceText).toContain('Offline Measurements');
    expect(workspaceText).toContain('MEASUrement:MEAS1:TYPe JITTERSUMMARY');
    expect(workspaceText).not.toContain('ACQuire:MODe HIRes');
  });

  test('reasoning-style chat stays talkative instead of being collapsed into build handoff', async ({ page }) => {
    test.setTimeout(180000);
    await seedConversationState(page, 'pyvisa');

    await page.route('**/ai/chat', async (route) => {
      const payload: MockChatResponse = {
        text:
          'For offline-only analysis, I would remove live acquisition control and keep the measurement setup on the saved waveform.\n\n' +
          'A practical flow would keep `MEASUrement:MEAS1:TYPe JITTERSUMMARY`, `MEASUrement:MEAS1:SOUrce1 CH1`, and the result query, while dropping `ACQuire:MODe HIRes` and any RUN/STOP step.\n\n' +
          'That keeps the workflow aligned with offline waveform analysis rather than live capture.',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });

    await gotoExecute(page);
    await ensureChatMode(page);
    await sendPrompt(page, 'How should I change my flow for offline-only analysis?');

    await expect(page.getByText(/remove live acquisition control/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/That keeps the workflow aligned with offline waveform analysis/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Flow outline:/i)).toHaveCount(0);
    await expect(page.getByText(/Say `?build it`?/i)).toHaveCount(0);
  });
});
