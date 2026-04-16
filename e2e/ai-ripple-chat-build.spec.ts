import { test, expect, type Page } from '@playwright/test';
import { gotoApp, handleDialogs } from './helpers';

async function gotoExecuteWithMcpBuild(page: Page) {
  handleDialogs(page);
  await page.addInitScript(() => {
    localStorage.setItem('tekautomate_wizard_shown', 'true');
    localStorage.setItem('tekautomate_tour_completed', 'true');
    localStorage.setItem('tek_automator_auth', 'granted');
    localStorage.setItem('tekautomate.ai.chat.state', JSON.stringify({
      history: [],
      provider: 'openai',
      model: 'gpt-5.4-mini',
      mode: 'mcp_only',
      interactionMode: 'build',
      apiKey: '',
      routingStrategy: 'assistant',
      openaiAssistantId: '',
      openaiThreadId: '',
      toolCallMode: false,
    }));
  });
  await gotoApp(page);
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: /^Execute$/i }).click();
  await expect(page.getByText('AI Assistant')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('MCP only - deterministic build planner')).toBeVisible({ timeout: 15000 });
}

async function sendAssistantPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder(/Ask for a flow build/i);
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(prompt);
  await page.getByRole('button', { name: /^Send$/i }).click();
}

async function applyLatestSuggestion(page: Page) {
  const applyButton = page.getByRole('button', { name: /^Apply$|^Applied$|^Apply flow$|^Review replace-flow suggestion$/i }).last();
  await expect(applyButton).toBeVisible({ timeout: 30000 });
  if ((await applyButton.textContent())?.trim() === 'Applied') return;
  await applyButton.click();
  await expect(applyButton).toHaveText(/Applied/i, { timeout: 15000 });
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

test('AI build ripple flow then screenshot follow-up places screenshot after results', async ({ page }) => {
  test.setTimeout(180000);
  await gotoExecuteWithMcpBuild(page);

  await sendAssistantPrompt(
    page,
    'Set CH1 and CH2 both to 500mV DC 50ohm, add a math channel MATH1 as CH1 minus CH2, and measure ripple on MATH1 using Vpp and Vpk with the best approach you think is good.'
  );

  await expect(page.getByText(/Built \d+ verified planner steps without a model call\./i).first()).toBeVisible({ timeout: 60000 });
  await applyLatestSuggestion(page);

  const workspace = page.locator('main');
  await expect(workspace.getByText('ACQuire:MODe SAMple', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(workspace.getByText(/PEAKdetect/i)).toHaveCount(0);

  await sendAssistantPrompt(page, 'take a screenshot after reading results');
  await expect(page.getByText(/Built 0 command\(s\) for insertion\./i).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Target: g_auto_5/i)).toBeVisible({ timeout: 30000 });
  await applyLatestSuggestion(page);

  const workspaceText = normalizeText(await workspace.innerText());
  const readResultsIndex = workspaceText.indexOf('Read Results');
  const saveScreenshotIndex = workspaceText.indexOf('Save Screenshot');
  const disconnectIndex = workspaceText.indexOf('Disconnect');

  expect(readResultsIndex).toBeGreaterThan(-1);
  expect(saveScreenshotIndex).toBeGreaterThan(-1);
  expect(disconnectIndex).toBeGreaterThan(-1);
  expect(readResultsIndex).toBeLessThan(saveScreenshotIndex);
  expect(saveScreenshotIndex).toBeLessThan(disconnectIndex);
  expect(workspaceText).toContain('ACQuire:MODe SAMple');
  expect(workspaceText).not.toContain('ACQuire:MODe PEAKdetect');
});
