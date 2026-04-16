import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'browser-parity');
const TARGET_SCPI = 'ACQuire:MODe';

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

async function clearSteps(page: Page) {
  const clearBtn = page.locator('button.text-red-600', { hasText: 'Clear' }).first();
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(250);
  }
}

async function exportPython(page: Page, fileName: string): Promise<string> {
  const outPath = path.join(OUT_DIR, fileName);
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).first().click();
  const download = await dl;
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

async function chooseCommandFromBrowse(page: Page, search: string, addButtonName: RegExp) {
  const hasScpiHeading = await page
    .getByRole('heading', { name: /Browse SCPI Commands/i })
    .isVisible()
    .catch(() => false);
  if (!hasScpiHeading) {
    await expect(page.getByRole('heading', { name: /Browse Commands/i })).toBeVisible({ timeout: 5000 });
  }
  const searchInput = page.getByPlaceholder('Search by name, SCPI command, or description...');
  await searchInput.fill(search);
  await page.waitForTimeout(300);
  const exactCard = page.locator(`[data-command-scpi="${search}"]`).first();
  const card = (await exactCard.count()) > 0 ? exactCard : page.locator(`[data-command-scpi*="${search}"]`).first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.click();
  // Normalize default parameter choice deterministically in both Steps/Blockly browsers.
  const paramSelect = page.locator('.bg-purple-50 select').first();
  if (await paramSelect.isVisible().catch(() => false)) {
    await paramSelect.selectOption({ index: 0 });
    await page.waitForTimeout(120);
  }
  await page.getByRole('button', { name: addButtonName }).click();
  await page.waitForTimeout(350);
}

function extractModeCommand(code: string): string {
  const m = code.match(/scpi\.write\((['"])([^'"]*ACQuire:MODe[^'"]*)\1\)/i);
  return m ? m[2] : '';
}

test('steps browse and blockly browse resolve command parameters consistently', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  // Steps path
  await page.getByTestId('step-palette').getByText('Write', { exact: true }).first().click();
  await page.waitForTimeout(200);
  await page.locator('button[title="Browse commands"]').first().click();
  await chooseCommandFromBrowse(page, TARGET_SCPI, /Add/i);
  const stepsCode = await exportPython(page, 'steps_browse_mode.py');
  const stepsCommand = extractModeCommand(stepsCode);

  // Blockly path
  await page.getByRole('button', { name: /^Blockly$/i }).click();
  await expect(page.getByRole('button', { name: /Browse Commands/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Browse Commands/i }).click();
  await chooseCommandFromBrowse(page, TARGET_SCPI, /Add to Workspace/i);
  await page.getByRole('button', { name: /Export to Steps/i }).click();
  await expect(page.getByTestId('step-palette')).toBeVisible({ timeout: 10000 });
  const blocklyCode = await exportPython(page, 'blockly_browse_mode.py');
  const blocklyCommand = extractModeCommand(blocklyCode);

  expect(stepsCode).not.toMatch(/<x>|<NR1>|\{value\}|\{channel\}/i);
  expect(blocklyCode).not.toMatch(/<x>|<NR1>|\{value\}|\{channel\}/i);
  expect(stepsCommand).toContain(TARGET_SCPI);
  expect(blocklyCommand).toContain(TARGET_SCPI);
  expect(blocklyCommand.toUpperCase()).toBe(stepsCommand.toUpperCase());
});
