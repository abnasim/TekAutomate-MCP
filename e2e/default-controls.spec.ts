import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'default-controls');
const ISSUE_DIR = path.join(process.cwd(), 'e2e-output', 'issues');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(ISSUE_DIR, { recursive: true, force: true });
  fs.mkdirSync(ISSUE_DIR, { recursive: true });
});

async function clearSteps(page: import('@playwright/test').Page) {
  const clearBtn = page.locator('button.text-red-600', { hasText: 'Clear' }).first();
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(250);
  }
}

async function addStep(page: import('@playwright/test').Page, stepLabel: string) {
  const palette = page.getByTestId('step-palette');
  await expect(palette).toBeVisible({ timeout: 8000 });
  await palette.getByText(stepLabel, { exact: true }).first().click();
  await page.waitForTimeout(250);
}

async function exportPython(page: import('@playwright/test').Page, fileName: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).first().click();
  const download = await dl;
  const outPath = path.join(OUT_DIR, fileName);
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function logIssueArtifact(
  testTitle: string,
  issueTag: string,
  code: string,
  details: Record<string, unknown>
) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${slugify(testTitle)}__${slugify(issueTag)}__${stamp}`;
  const pyPath = path.join(ISSUE_DIR, `${baseName}.py`);
  const jsonPath = path.join(ISSUE_DIR, `${baseName}.json`);
  fs.writeFileSync(pyPath, code, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(details, null, 2), 'utf-8');
}

function assertCodeQuality(
  testTitle: string,
  code: string,
  requiredSubstrings: string[],
  forbiddenSubstrings: string[] = []
) {
  const missing = requiredSubstrings.filter((token) => !code.includes(token));
  const presentForbidden = forbiddenSubstrings.filter((token) => code.includes(token));
  const validation = validateGeneratedPython(code, { requiredSubstrings, forbiddenSubstrings });

  if (missing.length || presentForbidden.length || !validation.valid) {
    logIssueArtifact(testTitle, 'code_quality_failure', code, {
      missingRequiredSubstrings: missing,
      presentForbiddenSubstrings: presentForbidden,
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
      generatedLength: code.length,
    });
  }

  expect(missing, `Missing required substrings: ${missing.join(', ')}`).toEqual([]);
  expect(presentForbidden, `Unexpected forbidden substrings: ${presentForbidden.join(', ')}`).toEqual([]);
  expect(validation.valid, validation.errors.join('; ')).toBe(true);
}

test('steps-only: default palette actions are present', async ({ page }) => {
  await gotoBuilder(page);
  const palette = page.getByTestId('step-palette');
  await expect(palette).toBeVisible({ timeout: 8000 });

  const expectedActions = [
    'Connect',
    'Disconnect',
    'Query',
    'Write',
    'Set+Query',
    'tm_devices Command',
    'Recall',
    'Sleep',
    'Python',
    'Comment',
    'Save Waveform',
    'Save Screenshot',
    'Error Check',
    'Group',
  ];

  for (const action of expectedActions) {
    await expect(palette.getByText(action, { exact: true }).first()).toBeVisible();
  }
});

test('steps-only: save waveform options drive generated code', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addStep(page, 'Save Waveform');
  await page.getByPlaceholder('CH1').fill('CH2');
  await page.getByPlaceholder('waveform').fill('wave_cov');

  const code = await exportPython(page, 'steps_save_waveform_csv.py');
  assertCodeQuality(
    test.info().title,
    code,
    ["source='CH2'", 'read_waveform_binary', 'CURVe?'],
    ['<x>', '{value}']
  );
});

test('steps-only: save screenshot legacy option uses hardcopy path', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addStep(page, 'Save Screenshot');
  await page.getByPlaceholder('screenshot').fill('screen_cov');
  await page.getByRole('button', { name: /Legacy \(5k\/7k\/70k\)/i }).click();

  const code = await exportPython(page, 'steps_save_screenshot_legacy.py');
  assertCodeQuality(
    test.info().title,
    code,
    ['HARDCOPY:FORMAT PNG', './screenshots/screen_cov.png', 'HARDCOPY START', 'FILESYSTEM:READFILE']
  );
});

test('steps-only: recall waveform options generate correct recall command', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addStep(page, 'Recall');
  await page.getByRole('button', { name: /Waveform Load waveform to reference/i }).click();
  await page.locator('input[placeholder*="MyWaveform.wfm"]').fill('C:/Temp/test_waveform.wfm');
  await page.getByRole('button', { name: /^REF2$/ }).click();

  const code = await exportPython(page, 'steps_recall_waveform.py');
  assertCodeQuality(
    test.info().title,
    code,
    ['RECALL:WAVEFORM', 'C:/Temp/test_waveform.wfm', 'REF2']
  );
});

test('blockly-only: default toolbar actions and browse command flow work', async ({ page }) => {
  await gotoBuilder(page);
  await page.getByRole('button', { name: /^Blockly$/i }).click();

  await expect(page.getByRole('button', { name: /Import from Steps/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /Export to Steps/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Browse Commands/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Clear$/i })).toBeVisible();

  await page.getByRole('button', { name: /Browse Commands/i }).click();
  await expect(page.getByRole('heading', { name: /Browse SCPI Commands/i })).toBeVisible({ timeout: 5000 });

  const firstCard = page.locator('[data-command-scpi]').first();
  await expect(firstCard).toBeVisible({ timeout: 10000 });
  const selectedScpi = (await firstCard.getAttribute('data-command-scpi')) || '';
  await firstCard.click();
  await page.getByRole('button', { name: /Add to Workspace/i }).click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /Export to Steps/i }).click();
  await expect(page.getByTestId('step-palette')).toBeVisible({ timeout: 10000 });

  const code = await exportPython(page, 'blockly_toolbar_and_browse.py');
  const header = selectedScpi.split(/\s+/)[0]?.replace(/\?$/, '');
  if (header) {
    expect(code).toContain(header);
  }
  const result = validateGeneratedPython(code, {
    requiredSubstrings: ['scpi.'],
    forbiddenSubstrings: ['<x>', '{value}'],
  });
  expect(result.valid, result.errors.join('; ')).toBe(true);
});
