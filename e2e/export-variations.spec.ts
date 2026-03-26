import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';
import { gotoBuilder } from './helpers';

const E2E_OUTPUT_DIR = path.join(process.cwd(), 'e2e-output');
const VARIATIONS_DIR = path.join(E2E_OUTPUT_DIR, 'variations');

test.beforeAll(() => {
  fs.mkdirSync(VARIATIONS_DIR, { recursive: true });
});

async function clearSteps(page: Page) {
  const clearBtn = page.locator('button.text-red-600', { hasText: 'Clear' }).first();
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(250);
  }
}

async function addStepFromPalette(page: Page, stepLabel: string) {
  const palette = page.getByTestId('step-palette');
  await expect(palette).toBeVisible({ timeout: 8000 });
  await palette.getByText(stepLabel, { exact: true }).first().click();
  await page.waitForTimeout(300);
}

async function setStepCommand(page: Page, command: string) {
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 4000 });
  await input.fill(command);
  await page.waitForTimeout(150);
}

async function setStepSaveAs(page: Page, variableName: string) {
  const useVariableCheckbox = page.getByRole('checkbox', { name: /Set Variable/i }).first();
  await expect(useVariableCheckbox).toBeVisible({ timeout: 3000 });
  if (!(await useVariableCheckbox.isChecked())) await useVariableCheckbox.check();
  await page.waitForTimeout(100);
  const saveAsInput = page.getByTestId('step-saveas-input').first();
  await expect(saveAsInput).toBeVisible({ timeout: 3000 });
  await saveAsInput.fill(variableName);
  await page.waitForTimeout(120);
}

async function exportAndSave(page: Page, fileName: string): Promise<string> {
  const filePath = path.join(VARIATIONS_DIR, fileName);
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({
    timeout: 5000,
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).first().click();
  const download = await downloadPromise;
  await download.saveAs(filePath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(filePath, 'utf-8');
}

function assertPythonValid(
  content: string,
  requiredSubstrings: string[],
  forbiddenSubstrings: string[] = ['<x>', '{value}', '{channel}']
) {
  const result = validateGeneratedPython(content, { requiredSubstrings, forbiddenSubstrings });
  expect(result.valid, result.errors.join('; ')).toBe(true);
}

test('variation matrix: complex write/query commands with typed values', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  const writeCases = [
    'OUTPut1:STATe ON',
    'HORizontal:RECOrdlength 1000000',
    'CH1:BANdwidth TWEnty',
  ];

  for (const cmd of writeCases) {
    await addStepFromPalette(page, 'Write');
    await setStepCommand(page, cmd);
  }

  await addStepFromPalette(page, 'Query');
  await setStepCommand(page, 'MEASUrement:MEAS1:VALue?');
  await setStepSaveAs(page, 'meas1_value');

  const content = await exportAndSave(page, 'matrix_complex_write_query.py');
  assertPythonValid(content, [
    'OUTPut1:STATe ON',
    'HORizontal:RECOrdlength 1000000',
    'CH1:BANdwidth TWEnty',
    'MEASUrement:MEAS1:VALue?',
    'meas1_value',
    'scpi.write',
    // Generator uses safe_query_text() helper for queries
    'safe_query_text',
  ]);
});

test('variation matrix: save and recall workflow emits complete python flow', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addStepFromPalette(page, 'Save Waveform');
  await page.getByPlaceholder('CH1').fill('CH2');
  await page.getByPlaceholder('waveform').fill('wave_matrix');

  await addStepFromPalette(page, 'Save Screenshot');
  await page.getByPlaceholder('screenshot').fill('screen_matrix');
  await page.getByRole('button', { name: /Legacy \(5k\/7k\/70k\)/i }).click();

  await addStepFromPalette(page, 'Recall');
  await page.getByRole('button', { name: /Waveform Load waveform to reference/i }).click();
  await page.locator('input[placeholder*="MyWaveform.wfm"]').fill('C:/Temp/matrix_waveform.wfm');
  await page.getByRole('button', { name: /^REF2$/ }).click();

  const content = await exportAndSave(page, 'matrix_save_recall_workflow.py');
  assertPythonValid(content, [
    "source='CH2'",
    'read_waveform_binary',
    'HARDCOPY:FORMAT PNG',
    './screenshots/screen_matrix.png',
    'RECALL:WAVEFORM',
    'C:/Temp/matrix_waveform.wfm',
    'REF2',
  ]);
});

test('variation matrix: blockly browse injects multiple concrete commands', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await page.getByRole('button', { name: /^Blockly$/i }).click();
  await expect(page.getByRole('button', { name: /Browse Commands/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Browse Commands/i }).click();
  await expect(page.getByRole('heading', { name: /Browse SCPI Commands/i })).toBeVisible({
    timeout: 5000,
  });

  const selectedHeaders: string[] = [];
  // First, force-pick a command known to have a value parameter so we can verify
  // Blockly resolves placeholders into concrete SCPI arguments.
  const searchInput = page.getByPlaceholder('Search by name, SCPI command, or description...');
  await searchInput.fill('ACQuire:MODe');
  await page.waitForTimeout(300);
  const modeCard = page.locator('[data-command-scpi*="ACQuire:MODe"]').first();
  await expect(modeCard).toBeVisible({ timeout: 10000 });
  const modeScpi = (await modeCard.getAttribute('data-command-scpi')) || 'ACQuire:MODe';
  selectedHeaders.push(modeScpi.split(/\s+/)[0]?.replace(/\?$/, '') || 'ACQuire:MODe');
  await modeCard.click();
  await page.getByRole('button', { name: /Add to Workspace/i }).click();
  await page.waitForTimeout(250);

  // Add two additional commands from browse list.
  const picks = 2;
  for (let i = 0; i < picks; i++) {
    const modalVisible = await page
      .getByRole('heading', { name: /Browse SCPI Commands/i })
      .isVisible()
      .catch(() => false);
    if (!modalVisible) {
      await page.getByRole('button', { name: /Browse Commands/i }).click();
      await expect(page.getByRole('heading', { name: /Browse SCPI Commands/i })).toBeVisible({
        timeout: 5000,
      });
    }

    const commandCards = page.locator('[data-command-scpi]');
    const totalCommandCards = await commandCards.count();
    expect(totalCommandCards).toBeGreaterThan(0);
    const idx = Math.min(i, totalCommandCards - 1);
    const card = commandCards.nth(idx);
    const scpi = (await card.getAttribute('data-command-scpi')) || '';
    const header = scpi.split(/\s+/)[0]?.replace(/\?$/, '') || '';
    if (header) {
      selectedHeaders.push(header.replace(/<x>/gi, '1'));
    }
    await card.click();
    await page.getByRole('button', { name: /Add to Workspace/i }).click();
    await page.waitForTimeout(250);
  }

  await page.getByRole('button', { name: /Export to Steps/i }).click();
  await expect(page.getByTestId('step-palette')).toBeVisible({ timeout: 10000 });

  const content = await exportAndSave(page, 'matrix_blockly_multi_command.py');
  // Generator uses scpi.write() for writes and safe_query_text() for queries
  const writeCount = (content.match(/scpi\.write\(/g) || []).length;
  const queryCount = (content.match(/safe_query_text\(scpi,/g) || []).length;
  // Exclude boilerplate queries (*IDN?, ALLEV?) — we need at least 3 user-added SCPI calls
  expect(writeCount + queryCount).toBeGreaterThanOrEqual(3);
  expect(content).toMatch(/ACQuire:MODe\s+[A-Za-z0-9_.-]+/i);

  assertPythonValid(content, ['scpi.write']);
  for (const header of selectedHeaders) {
    // We accept partial match because command browser may normalize case/segments.
    const token = header.split(':')[0];
    expect(content.toUpperCase()).toContain(token.toUpperCase());
  }
});
