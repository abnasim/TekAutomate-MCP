import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { gotoApp, handleDialogs } from './helpers';

const MCP_HOST = 'http://localhost:8787';
const MODEL = 'gpt-5.4-mini';
const OUTPUT_DIR = path.join(process.cwd(), 'tmp', 'ui-batch-results');
const CASE_COUNT = 5;
const FOLLOW_UP = 'Also add a comment step before disconnect that says reviewed by operator.';

const SURPRISE_PROMPTS = [
  'Build a practical oscilloscope validation flow for the current model using only valid TekAutomate step types, and explain why you chose that sequence.',
  'Suggest one useful TekAutomate workflow for this scope that a test engineer would actually reuse, then build it using only valid TekAutomate step types.',
  'Give me a smart measurement workflow for the current scope context and include the flow steps using only valid TekAutomate step types.',
  'Create a compact but useful capture-and-measure flow for this instrument, using only valid TekAutomate step types, and explain the purpose briefly.',
  'Build a quick communication sanity-check flow with IDN, ESR, OPC, and error queue checks using only valid TekAutomate step types.',
];

interface CaseReport {
  caseId: string;
  prompt: string;
  initialAssistantText: string;
  buildSummaryText: string;
  buildApplied: boolean;
  followUpPrompt: string;
  followUpSummaryText: string;
  followUpApplied: boolean;
  finalWorkspaceText: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function seedAiState(page: Page) {
  handleDialogs(page);
  await page.addInitScript(
    ({ mcpHost, model }) => {
      localStorage.setItem('tekautomate_wizard_shown', 'true');
      localStorage.setItem('tekautomate_tour_completed', 'true');
      localStorage.setItem('tek_automator_auth', 'granted');
      localStorage.setItem('tekautomate.mcp.host', mcpHost);
      localStorage.setItem(
        'tekautomate.ai.chat.state',
        JSON.stringify({
          history: [],
          provider: 'openai',
          model,
          mode: 'mcp_ai',
          interactionMode: 'chat',
          apiKey: '',
          routingStrategy: 'assistant',
          openaiAssistantId: '',
          openaiThreadId: '',
          toolCallMode: false,
        })
      );
    },
    { mcpHost: MCP_HOST, model: MODEL }
  );
}

async function gotoExecute(page: Page) {
  await seedAiState(page);
  await gotoApp(page);
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: /^Execute$/i }).click();
  await expect(page.getByText('AI Assistant')).toBeVisible({ timeout: 15000 });
}

async function ensureChatMode(page: Page) {
  const chatButtons = page.getByRole('button', { name: /^Chat$/i });
  const count = await chatButtons.count();
  if (count > 0) {
    await chatButtons.first().click();
  }
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder(/Ask about jitter|Ask for a flow build/i);
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(prompt);
  await page.getByRole('button', { name: /^Send$/i }).click();
}

async function waitForAssistantTurnCount(page: Page, expectedCount: number) {
  await expect(page.locator('.bg-slate-100, .dark\\:bg-white\\/5').filter({ hasText: /./ })).toHaveCount(expectedCount, {
    timeout: 90000,
  }).catch(() => {});
  await expect(page.getByRole('button', { name: /^Send$/i })).toHaveText(/Send/i, { timeout: 90000 });
}

async function latestAssistantBubble(page: Page): Promise<Locator> {
  const bubbles = page
    .locator('div.bg-slate-100')
    .filter({ hasNot: page.getByRole('button', { name: /^Apply|^Applied|^Review replace-flow suggestion/i }) });
  const count = await bubbles.count();
  return bubbles.nth(Math.max(0, count - 1));
}

async function applyLatestSuggestion(page: Page) {
  const applyButton = page
    .getByRole('button', { name: /^Apply|^Review replace-flow suggestion|^Applied$|^Use this \d+-step flow$/i })
    .last();
  await expect(applyButton).toBeVisible({ timeout: 90000 });
  const label = ((await applyButton.textContent()) || '').trim();
  if (/^Applied$/i.test(label)) return true;
  await applyButton.click();
  await expect(applyButton).toHaveText(/Applied/i, { timeout: 30000 });
  return true;
}

async function openWorkspaceText(page: Page): Promise<string> {
  const main = page.locator('main');
  await expect(main).toBeVisible({ timeout: 15000 });
  return (await main.innerText()).replace(/\s+/g, ' ').trim();
}

async function runCase(page: Page, prompt: string, index: number): Promise<CaseReport> {
  const caseId = `case_${String(index + 1).padStart(2, '0')}`;
  await gotoExecute(page);
  await ensureChatMode(page);

  await sendPrompt(page, prompt);
  await expect(page.getByText(/build it|switch to Build|I can build/i).last()).toBeVisible({ timeout: 90000 });
  const initialAssistantText = await (await latestAssistantBubble(page)).innerText();

  await sendPrompt(page, 'build it');
  await expect(page.getByText(/ACTIONS_JSON payload/i).last()).toBeVisible({ timeout: 90000 });
  const buildSummaryText = await (await latestAssistantBubble(page)).innerText();
  const buildApplied = await applyLatestSuggestion(page);

  await sendPrompt(page, FOLLOW_UP);
  await expect(page.getByText(/ACTIONS_JSON payload/i).last()).toBeVisible({ timeout: 90000 });
  const followUpSummaryText = await (await latestAssistantBubble(page)).innerText();
  const followUpApplied = await applyLatestSuggestion(page);

  const finalWorkspaceText = await openWorkspaceText(page);
  return {
    caseId,
    prompt,
    initialAssistantText,
    buildSummaryText,
    buildApplied,
    followUpPrompt: FOLLOW_UP,
    followUpSummaryText,
    followUpApplied,
    finalWorkspaceText,
  };
}

test.describe('AI surprise batch', () => {
  test('runs 5 chat->build->apply->follow-up loops and saves artifacts', async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    ensureDir(OUTPUT_DIR);
    const reports: CaseReport[] = [];

    for (let i = 0; i < CASE_COUNT; i += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const prompt = SURPRISE_PROMPTS[i];
      const report = await runCase(page, prompt, i);
      reports.push(report);

      const screenshotPath = path.join(OUTPUT_DIR, `${report.caseId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${report.caseId}.json`),
        JSON.stringify(report, null, 2),
        'utf8'
      );
      await context.close();
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(reports, null, 2), 'utf8');
    expect(reports).toHaveLength(CASE_COUNT);
  });
});
