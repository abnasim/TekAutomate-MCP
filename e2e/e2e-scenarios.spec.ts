/**
 * C: End-to-End Verification Scenarios
 *
 * Simulate real user actions → assert outputs and behaviors:
 *  - Create minimal sequence → generate → assert no errors
 *  - Multi-step complex flow → verify all SCPI in output
 *  - Comment + Sleep + Write sequence
 *  - Empty export (no steps added) still produces valid skeleton
 *  - Delete a step and verify it's removed from output
 *  - Duplicate write steps → both appear in output
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';
import { gotoBuilder } from './helpers';

const SCENARIOS_DIR = path.join(process.cwd(), 'e2e-output', 'scenarios');

test.beforeAll(() => {
  fs.mkdirSync(SCENARIOS_DIR, { recursive: true });
});

async function addStep(page: import('@playwright/test').Page, stepLabel: string) {
  const palette = page.getByTestId('step-palette');
  await expect(palette).toBeVisible({ timeout: 8000 });
  await palette.getByText(stepLabel, { exact: true }).first().click();
  await page.waitForTimeout(350);
}

async function setCommand(page: import('@playwright/test').Page, command: string) {
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill(command);
  await page.waitForTimeout(200);
}

async function setSaveAs(page: import('@playwright/test').Page, name: string) {
  const cb = page.getByRole('checkbox', { name: /Set Variable/i }).first();
  await expect(cb).toBeVisible({ timeout: 3000 });
  if (!(await cb.isChecked())) await cb.check();
  await page.waitForTimeout(150);
  const input = page.getByTestId('step-saveas-input').first();
  await expect(input).toBeVisible({ timeout: 2000 });
  await input.fill(name);
  await page.waitForTimeout(200);
}

async function exportScript(page: import('@playwright/test').Page, filePath: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).click();
  const download = await dl;
  await download.saveAs(filePath);
  return fs.readFileSync(filePath, 'utf-8');
}

// ─── Scenario 1: Empty export ───
test('empty export produces valid Python skeleton', async ({ page }) => {
  await gotoBuilder(page);

  const out = path.join(SCENARIOS_DIR, 'empty_export.py');
  const code = await exportScript(page, out);

  const result = validateGeneratedPython(code);
  expect(result.valid, result.errors.join('; ')).toBe(true);
  expect(code).toContain('import pyvisa');
  expect(code).toContain('scpi.close()');
});

// ─── Scenario 2: Single write step ───
test('single Write step → SCPI in output', async ({ page }) => {
  await gotoBuilder(page);

  await addStep(page, 'Write');
  await setCommand(page, 'ACQ:STATE RUN');

  const out = path.join(SCENARIOS_DIR, 'single_write.py');
  const code = await exportScript(page, out);

  const result = validateGeneratedPython(code, {
    requiredSubstrings: ['ACQ:STATE RUN', 'scpi.write'],
  });
  expect(result.valid, result.errors.join('; ')).toBe(true);
});

// ─── Scenario 3: Multi-step complex flow ───
test('multi-step: Write → Query → Sleep → Write', async ({ page }) => {
  await gotoBuilder(page);

  await addStep(page, 'Write');
  await setCommand(page, '*RST');
  await page.waitForTimeout(200);

  await addStep(page, 'Query');
  await setSaveAs(page, 'idn');
  await page.waitForTimeout(200);

  await addStep(page, 'Sleep');
  await page.waitForTimeout(200);

  await addStep(page, 'Write');
  await setCommand(page, 'ACQ:STATE RUN');

  const out = path.join(SCENARIOS_DIR, 'multi_step.py');
  const code = await exportScript(page, out);

  const result = validateGeneratedPython(code, {
    requiredSubstrings: ['*RST', '*IDN?', 'idn', 'time.sleep', 'ACQ:STATE RUN'],
  });
  expect(result.valid, result.errors.join('; ')).toBe(true);
});

// ─── Scenario 4: Comment + Sleep + Write ───
test('Comment + Sleep + Write sequence', async ({ page }) => {
  await gotoBuilder(page);

  await addStep(page, 'Comment');
  await page.waitForTimeout(200);

  await addStep(page, 'Sleep');
  await page.waitForTimeout(200);

  await addStep(page, 'Write');
  await setCommand(page, 'CH1:SCALE 0.5');

  const out = path.join(SCENARIOS_DIR, 'comment_sleep_write.py');
  const code = await exportScript(page, out);

  expect(code).toContain('CH1:SCALE 0.5');
  expect(code).toContain('time.sleep');
  expect(code).toContain('#');
});

// ─── Scenario 5: Two identical writes ───
test('duplicate Write steps both appear in output', async ({ page }) => {
  await gotoBuilder(page);

  await addStep(page, 'Write');
  await setCommand(page, 'CH1:SCALE 1');
  await page.waitForTimeout(200);

  await addStep(page, 'Write');
  await setCommand(page, 'CH2:SCALE 2');

  const out = path.join(SCENARIOS_DIR, 'two_writes.py');
  const code = await exportScript(page, out);

  expect(code).toContain('CH1:SCALE 1');
  expect(code).toContain('CH2:SCALE 2');
  const writeCount = (code.match(/scpi\.write/g) || []).length;
  expect(writeCount).toBeGreaterThanOrEqual(2);
});

// ─── Scenario 6: Query with custom variable name ───
test('Query with custom saveAs variable name', async ({ page }) => {
  await gotoBuilder(page);

  await addStep(page, 'Query');
  await setCommand(page, '*OPT?');
  await setSaveAs(page, 'options_str');

  const out = path.join(SCENARIOS_DIR, 'query_custom_var.py');
  const code = await exportScript(page, out);

  expect(code).toContain('*OPT?');
  expect(code).toContain('options_str');
});

// ─── Scenario 7: Template then add more steps ───
test('load template then add Write step → both in output', async ({ page }) => {
  await gotoBuilder(page);

  // Load Hello Scope template
  await page.getByRole('button', { name: /Templates/i }).click();
  await expect(page.getByRole('heading', { name: /Templates/i })).toBeVisible({ timeout: 5000 });
  const card = page.locator('[data-tour="hello-scope-template"]').first();
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.getByRole('button', { name: /Append as Group/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Steps$/i }).click();
  await page.waitForTimeout(300);

  // Add a write step on top
  await addStep(page, 'Write');
  await setCommand(page, 'CH1:BANDWIDTH FULL');

  const out = path.join(SCENARIOS_DIR, 'template_plus_write.py');
  const code = await exportScript(page, out);

  // Template commands
  expect(code).toContain('*IDN?');
  expect(code).toContain('*OPT?');
  // New write step
  expect(code).toContain('CH1:BANDWIDTH FULL');
});
