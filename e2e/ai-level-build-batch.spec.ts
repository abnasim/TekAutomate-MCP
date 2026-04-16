import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { gotoApp, handleDialogs } from './helpers';
import { CASES, type BenchmarkCase } from '../mcp-server/tests/level_cases';

type BuildMode = 'mcp_only' | 'mcp_ai';

interface CaseReport {
  caseId: string;
  level: string;
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

const MODE = (process.env.BATCH_MODE === 'mcp_ai' ? 'mcp_ai' : 'mcp_only') as BuildMode;
const CASE_COUNT = Math.max(1, Number(process.env.BATCH_COUNT || '5'));
const START_INDEX = Math.max(0, Number(process.env.BATCH_START || '0'));
const SHUFFLE_SEED = String(process.env.BATCH_SEED || 'tekautomate-level-batch');
const FOLLOW_UP =
  process.env.BATCH_FOLLOW_UP || 'Also add a comment step before disconnect that says reviewed by operator.';
const INCLUDE_NON_SCOPE = /^1|true|yes$/i.test(String(process.env.BATCH_INCLUDE_NON_SCOPE || ''));

const OUTPUT_DIR = path.join(
  process.cwd(),
  'tmp',
  'ui-level-batch-results',
  MODE,
  `batch_${String(START_INDEX + 1).padStart(2, '0')}_${String(START_INDEX + CASE_COUNT).padStart(2, '0')}`
);

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickBatchCases(): BenchmarkCase[] {
  const eligibleCases = INCLUDE_NON_SCOPE
    ? CASES
    : CASES.filter((item) => String(item.flowContext?.deviceType || '').toUpperCase() === 'SCOPE');
  const rng = mulberry32(hashString(`${MODE}:${SHUFFLE_SEED}`));
  const shuffled = [...eligibleCases]
    .map((item, index) => ({ item, index, sort: rng() }))
    .sort((a, b) => a.sort - b.sort || a.index - b.index)
    .map((entry) => entry.item);
  return shuffled.slice(START_INDEX, START_INDEX + CASE_COUNT);
}

async function seedBuildState(page: Page) {
  handleDialogs(page);
  await page.addInitScript(
    ({ mode }: { mode: BuildMode }) => {
      const byokKey = mode === 'mcp_ai' ? 'test-openai-key' : '';
      localStorage.setItem('tekautomate_wizard_shown', 'true');
      localStorage.setItem('tekautomate_tour_completed', 'true');
      localStorage.setItem('tek_automator_auth', 'granted');
      if (byokKey) {
        localStorage.setItem('tekautomate.ai.byok.api_key', byokKey);
        localStorage.setItem('tekautomate.ai.byok.api_key.openai', byokKey);
      } else {
        localStorage.removeItem('tekautomate.ai.byok.api_key');
        localStorage.removeItem('tekautomate.ai.byok.api_key.openai');
      }
      localStorage.setItem(
        'tekautomate.ai.chat.state',
        JSON.stringify({
          history: [],
          provider: 'openai',
          model: 'gpt-5.4-mini',
          mode,
          interactionMode: 'build',
          apiKey: byokKey,
          routingStrategy: 'assistant',
          openaiAssistantId: '',
          openaiThreadId: '',
          toolCallMode: false,
        })
      );
    },
    { mode: MODE }
  );
}

async function gotoExecute(page: Page) {
  await seedBuildState(page);
  await gotoApp(page);
  await page.locator('[data-tour="steps-panel"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: /^Execute$/i }).click();
  if (MODE === 'mcp_only') {
    await expect(page.getByText('MCP only - deterministic build planner')).toBeVisible({ timeout: 20000 });
  } else {
    await expect(page.getByText('MCP + AI - router-first build assistant')).toBeVisible({ timeout: 20000 });
  }
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder(/Ask for a flow build|Ask about jitter, triggers, eye diagrams/i);
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.fill(prompt);
  await page.getByRole('button', { name: /^Send$/i }).click();
}

function pendingApplyButtons(page: Page) {
  return page.getByRole('button', {
    name: /^Apply(?: \d+ changes?)?$|^Review replace-flow suggestion$|^Use this(?: \d+-step)? flow$/i,
  });
}

async function waitForSuggestion(page: Page, previousPendingCount: number) {
  await expect
    .poll(async () => pendingApplyButtons(page).count(), { timeout: 120000 })
    .toBeGreaterThan(previousPendingCount);
}

async function latestAssistantCardText(page: Page): Promise<string> {
  const cards = page.locator('div.bg-slate-100');
  const count = await cards.count();
  return cards.nth(Math.max(0, count - 1)).innerText();
}

async function applyLatestSuggestion(page: Page): Promise<boolean> {
  const applyButton = pendingApplyButtons(page).last();
  await expect(applyButton).toBeVisible({ timeout: 120000 });
  await applyButton.click();
  await expect(page.getByRole('button', { name: /^Applied$|^Already current$/i }).last()).toBeVisible({ timeout: 45000 });
  return true;
}

async function workspaceText(page: Page): Promise<string> {
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
}

async function runCase(page: Page, testCase: BenchmarkCase): Promise<CaseReport> {
  let buildSummaryText = '';
  let buildApplied = false;
  let followUpSummaryText = '';
  let followUpApplied = false;
  let finalWorkspaceText = '';
  let error = '';
  try {
    await gotoExecute(page);

    const buildPendingCount = await pendingApplyButtons(page).count();
    await sendPrompt(page, testCase.userMessage);
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
    caseId: testCase.id,
    level: testCase.level,
    prompt: testCase.userMessage,
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

test.describe('AI level build batch', () => {
  test(`runs ${CASE_COUNT} level prompts in ${MODE} build mode with apply and follow-up`, async ({ browser }) => {
    test.setTimeout(20 * 60 * 1000);
    ensureDir(OUTPUT_DIR);
    const selectedCases = pickBatchCases();
    const reports: CaseReport[] = [];

    for (let i = 0; i < selectedCases.length; i += 1) {
      const testCase = selectedCases[i];
      const context = await browser.newContext();
      const page = await context.newPage();
      const report = await runCase(page, testCase);
      reports.push(report);

      await page.screenshot({ path: path.join(OUTPUT_DIR, `${String(i + 1).padStart(2, '0')}_${testCase.id}.png`), fullPage: true });
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${String(i + 1).padStart(2, '0')}_${testCase.id}.json`),
        JSON.stringify(report, null, 2),
        'utf8'
      );
      await context.close();
    }

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'summary.json'),
      JSON.stringify(
        {
          mode: MODE,
          seed: SHUFFLE_SEED,
          startIndex: START_INDEX,
          caseCount: CASE_COUNT,
          selectedCases: selectedCases.map((item) => ({ id: item.id, level: item.level, prompt: item.userMessage })),
          reports,
        },
        null,
        2
      ),
      'utf8'
    );

    expect(reports).toHaveLength(selectedCases.length);
    expect(reports.filter((report) => report.error)).toEqual([]);
    expect(reports.every((report) => report.buildApplied)).toBeTruthy();
    expect(reports.every((report) => report.followUpApplied)).toBeTruthy();
    expect(reports.every((report) => report.requestedCommentPresent)).toBeTruthy();
  });
});
