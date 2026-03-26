/* eslint-disable no-console */
import { chromium, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import readline from 'readline';

interface GoldenCase {
  testId: string;
  prompt: string;
  source: string;
  timestamp: string;
  steps: unknown[];
  notes?: string;
}

const ROOT = resolve(__dirname, '..');
const GOLDEN_DIR = process.env.GOLDEN_DIR || join(ROOT, 'e2e', 'gpt-golden');
const RAW_DIR = join(ROOT, 'e2e-output', 'golden-raw');
const USER_DATA_DIR = process.env.CHATGPT_PROFILE_DIR || join(ROOT, '.playwright-chatgpt-profile');
const USE_CDP = process.env.USE_CDP === 'true';
const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const HEADLESS = process.env.HEADLESS === 'true';
const MODE = (process.env.GPT_MODE || 'steps').toLowerCase(); // steps | blockly
const SKIP_PROMPT = process.env.SKIP_PROMPT === 'true';
const MAX_CASES = Number(process.env.MAX_CASES || '0');
const CASE_FILTER = (process.env.CASE_FILTER || '').trim().toUpperCase();

const GPT_URL_STEPS =
  process.env.CUSTOM_GPT_STEPS_URL ||
  'https://chatgpt.com/g/g-6981a42361c8819187d7f9db53ac7c50-tekautomate-steps-ui-json-builder';
const GPT_URL_BLOCKLY =
  process.env.CUSTOM_GPT_BLOCKLY_URL ||
  'https://chatgpt.com/g/g-69742de938188191985209bfbb5d2a94-tekautomate-blockly-xml-builder';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(question, (ans) => {
      rl.close();
      resolveAnswer(ans);
    });
  });
}

function listGoldenFiles(): string[] {
  if (!existsSync(GOLDEN_DIR)) return [];
  let files = readdirSync(GOLDEN_DIR)
    .filter((f) => /^TC\d{2}\.json$/i.test(f))
    .sort();
  if (CASE_FILTER) {
    files = files.filter((f) => f.replace(/\.json$/i, '').toUpperCase() === CASE_FILTER);
  }
  if (MAX_CASES > 0) {
    files = files.slice(0, MAX_CASES);
  }
  return files;
}

function parseAssistantJson(raw: string): Record<string, unknown> | null {
  const direct = tryJson(raw);
  if (direct) return direct;

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const parsed = tryJson(fenced[1].trim());
    if (parsed) return parsed;
  }

  const tagged = raw.match(/ACTIONS_JSON:\s*([\s\S]*?)$/i);
  if (tagged?.[1]) {
    const parsed = tryJson(tagged[1].trim());
    if (parsed) return parsed;
    const obj = extractFirstJsonObject(tagged[1]);
    if (obj) {
      const parsedObj = tryJson(obj);
      if (parsedObj) return parsedObj;
    }
  }

  const obj = extractFirstJsonObject(raw);
  if (obj) return tryJson(obj);
  return null;
}

function tryJson(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(input: string): string | null {
  const start = input.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

async function getComposer(page: Page) {
  const candidates = [
    'textarea[data-testid="prompt-textarea"]',
    '#prompt-textarea',
    'div#prompt-textarea[contenteditable="true"]',
    '[data-testid="composer-text-input"]',
    'div[data-testid="composer-text-input"] [contenteditable="true"]',
    'textarea[placeholder*="Message"]',
    'textarea[placeholder*="Send a message"]',
    '[contenteditable="true"][aria-label*="Message"]',
    '[contenteditable="true"][data-testid*="prompt"]',
    '[contenteditable="true"][role="textbox"]',
  ];
  await page.waitForTimeout(1500);
  for (const s of candidates) {
    const loc = page.locator(s).first();
    if (await loc.count()) {
      const visible = await loc.isVisible().catch(() => false);
      if (visible) return { selector: s, loc };
    }
  }

  const roleTextbox = page.getByRole('textbox').first();
  if (await roleTextbox.count()) {
    const visible = await roleTextbox.isVisible().catch(() => false);
    if (visible) return { selector: 'role=textbox', loc: roleTextbox };
  }

  const title = await page.title().catch(() => '(no-title)');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/verify you are human|captcha|cloudflare/i.test(bodyText)) {
    throw new Error(`Blocked by verification page: ${title}`);
  }
  throw new Error(`Could not find ChatGPT composer (title="${title}")`);
}

async function submitPrompt(page: Page, prompt: string) {
  const { loc, selector } = await getComposer(page);
  await loc.click({ timeout: 15000 });

  if (selector.startsWith('textarea')) {
    await loc.fill(prompt);
    await loc.press('Enter');
  } else {
    await page.keyboard.type(prompt, { delay: 5 });
    await page.keyboard.press('Enter');
  }
}

async function waitForAssistantResponse(page: Page, timeoutMs = 180000): Promise<string> {
  const assistantSelector = '[data-message-author-role="assistant"]';
  const start = Date.now();
  let beforeCount = 0;
  try {
    beforeCount = await page.locator(assistantSelector).count();
  } catch {
    beforeCount = 0;
  }
  let stableText = '';
  let stableSince = Date.now();
  let sawNewAssistant = false;

  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      throw new Error('Target page closed while waiting for assistant response');
    }

    const assistant = page.locator(assistantSelector);
    const count = await assistant.count().catch(() => 0);
    if (count > beforeCount) {
      sawNewAssistant = true;
      const current = (await assistant.nth(count - 1).innerText().catch(() => '')).trim();
      if (current && current !== stableText) {
        stableText = current;
        stableSince = Date.now();
      }
    }

    const stopVisible = await page
      .locator('button:has-text("Stop"), button[aria-label*="Stop"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (sawNewAssistant && !stopVisible && Date.now() - stableSince > 2000 && stableText.length > 0) {
      return stableText;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Timed out waiting for assistant response');
}

function extractStepsFromResponse(parsed: Record<string, unknown>): unknown[] {
  // Direct Steps JSON shape
  if (Array.isArray(parsed.steps)) return parsed.steps as unknown[];

  // ACTIONS_JSON shape
  const actions = Array.isArray(parsed.actions) ? (parsed.actions as Array<Record<string, unknown>>) : [];
  const replaceFlow = actions.find((a) => a?.type === 'replace_flow');
  if (replaceFlow && replaceFlow.flow && typeof replaceFlow.flow === 'object') {
    const flow = replaceFlow.flow as Record<string, unknown>;
    if (Array.isArray(flow.steps)) return flow.steps as unknown[];
  }
  return [];
}

async function main() {
  const url = MODE === 'blockly' ? GPT_URL_BLOCKLY : GPT_URL_STEPS;
  const files = listGoldenFiles();
  if (!files.length) {
    throw new Error(`No TC files found in ${GOLDEN_DIR}`);
  }
  mkdirSync(RAW_DIR, { recursive: true });

  let context;
  let browser;
  if (USE_CDP) {
    browser = await chromium.connectOverCDP(CDP_URL);
    context = browser.contexts()[0];
    if (!context) {
      throw new Error(`No browser context found at ${CDP_URL}. Open Chrome with --remote-debugging-port first.`);
    }
  } else {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: HEADLESS,
      viewport: { width: 1440, height: 900 },
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  const getActivePage = async (): Promise<Page> => {
    const pages = context.pages().filter((p) => !p.isClosed());
    const exact = pages.find((p) => p.url().startsWith(url));
    if (exact) return exact;
    const anyChatGpt = pages.find((p) => /chatgpt\.com/i.test(p.url()));
    if (anyChatGpt) return anyChatGpt;
    return pages[0] || (await context.newPage());
  };

  let page: Page = await getActivePage();
  if (!page.url() || page.url() === 'about:blank') {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }
  await page.waitForTimeout(2500);

  console.log(`Opened ${url}`);
  console.log('If not logged in, log in now in the opened browser window.');
  if (!SKIP_PROMPT) {
    await ask('Press Enter when ready to start automated capture...');
  }

  for (const fileName of files) {
    const filePath = join(GOLDEN_DIR, fileName);
    const tc = JSON.parse(readFileSync(filePath, 'utf8')) as GoldenCase;
    if (!tc.prompt || tc.prompt.startsWith('TODO:')) {
      console.log(`${tc.testId}: skipped (prompt TODO)`);
      continue;
    }

    page = await getActivePage();
    if (page.isClosed()) {
      page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(1500);
    }

    console.log(`${tc.testId}: sending prompt`);
    let response = '';
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      try {
        await submitPrompt(page, tc.prompt);
        response = await waitForAssistantResponse(page);
        break;
      } catch (err) {
        const stamp = Date.now();
        const shot = join(RAW_DIR, `${tc.testId}_attempt${attempt}_${stamp}.png`);
        const html = join(RAW_DIR, `${tc.testId}_attempt${attempt}_${stamp}.html`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
        const content = await page.content().catch(() => '');
        writeFileSync(html, content, 'utf8');
        if (attempt >= 3) throw err;
        page = await getActivePage();
        if (!page.url() || page.url() === 'about:blank') {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await page.waitForTimeout(1500);
        }
      }
    }
    writeFileSync(join(RAW_DIR, `${tc.testId}.txt`), response, 'utf8');

    const parsed = parseAssistantJson(response);
    if (!parsed) {
      tc.notes = `${(tc.notes || '').trim()} [auto] Failed to parse JSON from response.`.trim();
      writeFileSync(filePath, JSON.stringify(tc, null, 2), 'utf8');
      console.log(`${tc.testId}: parse failed`);
      continue;
    }

    const steps = extractStepsFromResponse(parsed);
    if (!Array.isArray(steps) || !steps.length) {
      tc.notes = `${(tc.notes || '').trim()} [auto] Parsed JSON but no steps found.`.trim();
      writeFileSync(filePath, JSON.stringify(tc, null, 2), 'utf8');
      console.log(`${tc.testId}: no steps found`);
      continue;
    }

    tc.steps = steps;
    tc.source = `custom_gpt_${MODE}`;
    tc.timestamp = new Date().toISOString().slice(0, 10);
    tc.notes = `${(tc.notes || '').trim()} [auto] Captured via Playwright.`.trim();
    writeFileSync(filePath, JSON.stringify(tc, null, 2), 'utf8');
    console.log(`${tc.testId}: saved ${steps.length} steps`);
  }

  if (USE_CDP) {
    await browser?.close();
  } else {
    await context.close();
  }
  console.log('Capture complete.');
}

main().catch((err) => {
  console.error('captureCustomGptGoldens failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
