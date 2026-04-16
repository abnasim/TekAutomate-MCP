import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'flow-fidelity');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

async function setCommand(page: import('@playwright/test').Page, command: string) {
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 4000 });
  await input.fill(command);
  await page.waitForTimeout(250);
}

async function setSaveAs(page: import('@playwright/test').Page, variableName: string) {
  const cb = page.getByRole('checkbox', { name: /Set Variable/i }).first();
  await expect(cb).toBeVisible({ timeout: 3000 });
  if (!(await cb.isChecked())) await cb.check();
  await page.waitForTimeout(100);
  const input = page.getByTestId('step-saveas-input').first();
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill(variableName);
  await page.waitForTimeout(150);
}

async function exportPython(page: import('@playwright/test').Page, fileName: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  const exportBtn = page.getByRole('button', { name: /Export Script|Download script/i }).first();
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
  await exportBtn.click();
  const download = await dl;
  const outPath = path.join(OUT_DIR, fileName);
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

async function getFirstEditableParameterField(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  const paramsPanel = page.getByText('Editable Parameters').locator('xpath=..').first();
  await expect(paramsPanel).toBeVisible({ timeout: 5000 });
  const fields = paramsPanel.locator('input:not([type="file"]), select');
  const fieldCount = await fields.count();
  let field: import('@playwright/test').Locator | null = null;
  for (let i = 0; i < fieldCount; i++) {
    const candidate = fields.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      field = candidate;
      break;
    }
  }
  expect(field, 'No visible editable parameter field found').toBeTruthy();
  await expect(field!).toBeVisible({ timeout: 4000 });
  return field!;
}

async function openBlockly(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^Blockly$/i }).click();
  await expect(page.getByRole('button', { name: /Export to Steps/i })).toBeVisible({ timeout: 10000 });
}

test('steps command parameters are exposed and produce valid command syntax', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addStep(page, 'Write');
  await setCommand(page, 'OUTPut1:STATe ON');
  const editableField = await getFirstEditableParameterField(page);
  await expect(editableField).toHaveValue(/ON/i);

  const cmdInput = page.getByTestId('step-command-input').first();
  const finalCommand = 'OUTPut1:STATe ON';
  await expect(cmdInput).toHaveValue(new RegExp(`^${escapeRegExp(finalCommand)}$`, 'i'));

  const code = await exportPython(page, 'steps_param_exposure.py');
  const result = validateGeneratedPython(code, {
    requiredSubstrings: [finalCommand],
    forbiddenSubstrings: ['{value}', '<x>'],
  });
  expect(result.valid, result.errors.join('; ')).toBe(true);
});

test('steps to blockly to steps preserves command intent and generated code', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addStep(page, 'Write');
  await setCommand(page, 'CH1:SCAle 1.25');

  await addStep(page, 'Query');
  await setCommand(page, '*IDN?');
  await setSaveAs(page, 'idn_text');

  const baselineCode = await exportPython(page, 'roundtrip_baseline.py');
  expect(baselineCode).toContain('CH1:SCAle 1.25');
  expect(baselineCode).toContain('*IDN?');
  expect(baselineCode).toContain('idn_text');

  await openBlockly(page);
  await page.getByRole('button', { name: /Import( from)? Steps/i }).click();
  const importModal = page.getByRole('heading', { name: /Import Steps from Builder/i });
  if (await importModal.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /^Import$/i }).click();
  }
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Export to Steps/i }).click();
  await expect(page.getByTestId('step-palette')).toBeVisible({ timeout: 10000 });

  const roundtripCode = await exportPython(page, 'roundtrip_after_blockly.py');
  const roundtripValidation = validateGeneratedPython(roundtripCode, {
    requiredSubstrings: ['CH1:SCAle 1.25', '*IDN?', 'idn_text'],
    forbiddenSubstrings: ['{value}', '<x>'],
  });
  expect(roundtripValidation.valid, roundtripValidation.errors.join('; ')).toBe(true);
});

test('blockly browse command adds concrete command and exports valid syntax to steps', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);
  await openBlockly(page);

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

  const code = await exportPython(page, 'blockly_added_command.py');
  const selectedHeader = selectedScpi.split(/\s+/)[0]?.replace(/\?$/, '') || '';
  const result = validateGeneratedPython(code, {
    requiredSubstrings: selectedHeader ? [selectedHeader] : ['scpi.'],
    forbiddenSubstrings: ['{value}', '<x>'],
  });
  expect(result.valid, result.errors.join('; ')).toBe(true);
});
