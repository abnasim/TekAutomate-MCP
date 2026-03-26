import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { gotoApp, handleDialogs } from './helpers';

const OUTPUT_DIR = path.join(process.cwd(), 'tmp', 'ui-build-batch-results');
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
  buildSummaryText: string;
  buildApplied: boolean;
  followUpPrompt: string;
  followUpSummaryText: string;
  followUpApplied: boolean;
  finalWorkspaceText: string;
  requestedCommentPresent: boolean;
  error?: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function seedBuildState(page: Page) {
  handleDialogs(page);
  await page.addInitScript(() => {
    localStorage.setItem('tekautomate_wizard_shown', 'true');
    localStorage.setItem('tekautomate_tour_completed', 'true');
    localStorage.setItem('tek_automator_auth', 'granted');
    localStorage.setItem(
      'tekautomate.ai.chat.state',
      JSON.stringify({
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
      })
    );
  });
}

async function gotoExecute(page: Page) {
  await seedBuildState(page);
  await gotoApp(page);
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: /^Execute$/i }).click();
  await expect(page.getByText('MCP only - deterministic build planner')).toBeVisible({ timeout: 15000 });
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder(/Ask for a flow build/i);
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(prompt);
  await page.getByRole('button', { name: /^Send$/i }).click();
}

function pendingApplyButtons(page: Page) {
  return page.getByRole('button', { name: /^Apply(?: \d+ changes?)?$|^Review replace-flow suggestion$|^Use this(?: \d+-step)? flow$/i });
}

async function waitForSuggestion(page: Page, previousPendingCount: number) {
  await expect
    .poll(async () => pendingApplyButtons(page).count(), { timeout: 90000 })
    .toBeGreaterThan(previousPendingCount);
}

async function latestAssistantCardText(page: Page): Promise<string> {
  const cards = page.locator('div.bg-slate-100');
  const count = await cards.count();
  return cards.nth(Math.max(0, count - 1)).innerText();
}

async function applyLatestSuggestion(page: Page): Promise<boolean> {
  const applyButton = pendingApplyButtons(page).last();
  await expect(applyButton).toBeVisible({ timeout: 90000 });
  await applyButton.click();
  await expect(page.getByRole('button', { name: /^Applied$/i }).last()).toBeVisible({ timeout: 30000 });
  return true;
}

async function workspaceText(page: Page): Promise<string> {
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
}

async function runCase(page: Page, prompt: string, index: number): Promise<CaseReport> {
  const caseId = `case_${String(index + 1).padStart(2, '0')}`;
  let buildSummaryText = '';
  let buildApplied = false;
  let followUpSummaryText = '';
  let followUpApplied = false;
  let finalWorkspaceText = '';
  let error = '';
  try {
    await gotoExecute(page);

    const buildPendingCount = await pendingApplyButtons(page).count();
    await sendPrompt(page, prompt);
    await waitForSuggestion(page, buildPendingCount);
    buildSummaryText = await latestAssistantCardText(page);
    buildApplied = await applyLatestSuggestion(page);

    const followUpPendingCount = await pendingApplyButtons(page).count();
    await sendPrompt(page, FOLLOW_UP);
    await waitForSuggestion(page, followUpPendingCount);
    followUpSummaryText = await latestAssistantCardText(page);
    followUpApplied = await applyLatestSuggestion(page);
    finalWorkspaceText = await workspaceText(page);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    finalWorkspaceText = await workspaceText(page).catch(() => '');
  }

  return {
    caseId,
    prompt,
    buildSummaryText,
    buildApplied,
    followUpPrompt: FOLLOW_UP,
    followUpSummaryText,
    followUpApplied,
    finalWorkspaceText,
    requestedCommentPresent: /reviewed by operator/i.test(finalWorkspaceText),
    error: error || undefined,
  };
}

test.describe('AI surprise build batch', () => {
  test('runs 5 surprise prompts in build mode with apply and follow-up', async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    ensureDir(OUTPUT_DIR);
    const reports: CaseReport[] = [];
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const report = await runCase(page, SURPRISE_PROMPTS[i], i);
      reports.push(report);

      await page.screenshot({ path: path.join(OUTPUT_DIR, `${report.caseId}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUTPUT_DIR, `${report.caseId}.json`), JSON.stringify(report, null, 2), 'utf8');
      await context.close();
    }
    fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(reports, null, 2), 'utf8');
    expect(reports).toHaveLength(CASE_COUNT);
  });
});
