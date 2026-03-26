import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'repro');
const PY_PATH = path.join(OUT_DIR, 'blockly_screenshot_export.py');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

test('blockly export includes modern screenshot path without screenshot *OPC?', async ({ page }) => {
  await gotoBuilder(page);

  const clearBtn = page.locator('button.text-red-600', { hasText: 'Clear' }).first();
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(250);
  }

  // Build a minimal Steps flow with screenshot step
  await page.getByTestId('step-palette').getByText('Connect', { exact: true }).first().click();
  await page.waitForTimeout(200);
  await page.getByTestId('step-palette').getByText('Save Screenshot', { exact: true }).first().click();
  await page.waitForTimeout(200);
  await page.getByTestId('step-palette').getByText('Disconnect', { exact: true }).first().click();
  await page.waitForTimeout(200);

  // Go Blockly and import from steps (creates Blockly blocks including save_screenshot)
  await page.getByRole('button', { name: /^Blockly$/i }).click();
  await expect(page.getByRole('button', { name: /Import( from)? Steps/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Import( from)? Steps/i }).click();
  const importModal = page.getByRole('heading', { name: /Import Steps from Builder/i });
  if (await importModal.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /^Import$/i }).click();
  }
  await page.waitForTimeout(600);

  // Export Python from Blockly header flow
  await page.getByRole('button', { name: /Export Python/i }).click();
  await expect(page.getByRole('heading', { name: /Export or run/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /^Download script$/i }).click();
  const download = await dl;
  await download.saveAs(PY_PATH);

  const code = fs.readFileSync(PY_PATH, 'utf-8');
  expect(code).toContain('SAVE:IMAGE:COMPOSITION NORMAL');
  expect(code).toContain('FILESYSTEM:READFILE');
  expect(code).toContain('time.sleep(1.0)');
  expect(code).not.toContain(`query('*OPC?')  # Wait for save to complete`);
});

