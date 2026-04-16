import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'flow-fidelity');
const REPORT_JSON = path.join(OUT_DIR, 'set_and_query_canary_report.json');
const REPORT_MD = path.join(OUT_DIR, 'set_and_query_canary_report.md');

interface CanaryReport {
  timestamp: string;
  scenario: string;
  baseline: {
    hasWrite: boolean;
    hasQuery: boolean;
    writeLine?: string;
    queryLine?: string;
  };
  roundtrip: {
    hasWrite: boolean;
    hasQuery: boolean;
    writeLine?: string;
    queryLine?: string;
  };
  preserved: boolean;
  notes: string;
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

async function clearSteps(page: import('@playwright/test').Page) {
  const clearBtn = page.locator('button.text-red-600', { hasText: 'Clear' }).first();
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(250);
  }
}

async function addSetAndQuery(page: import('@playwright/test').Page, command: string) {
  await page.getByTestId('step-palette').getByText('Set+Query', { exact: true }).first().click();
  await page.waitForTimeout(250);
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 4000 });
  await input.fill(command);
  await page.waitForTimeout(200);
}

async function exportPython(page: import('@playwright/test').Page, filename: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).first().click();
  const download = await downloadPromise;
  const outPath = path.join(OUT_DIR, filename);
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

function inspectSetAndQueryPython(code: string): { hasWrite: boolean; hasQuery: boolean; writeLine?: string; queryLine?: string } {
  const writeRegex = /scpi\.write\("CH1:SCAle 2\.0"\)/;
  const queryRegex = /scpi\.query\("CH1:SCAle\?"\)/;

  const writeLine = code.split('\n').find((l) => writeRegex.test(l));
  const queryLine = code.split('\n').find((l) => queryRegex.test(l));

  return {
    hasWrite: !!writeLine,
    hasQuery: !!queryLine,
    writeLine,
    queryLine,
  };
}

function writeReport(report: CanaryReport): void {
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  const md = [
    '# Set+Query Roundtrip Canary Report',
    '',
    `- Timestamp: ${report.timestamp}`,
    `- Scenario: ${report.scenario}`,
    `- Preserved Across Steps -> Blockly -> Steps: **${report.preserved ? 'YES' : 'NO'}**`,
    '',
    '## Baseline (Steps Direct Export)',
    `- hasWrite: ${report.baseline.hasWrite}`,
    `- hasQuery: ${report.baseline.hasQuery}`,
    `- writeLine: ${report.baseline.writeLine || '(missing)'}`,
    `- queryLine: ${report.baseline.queryLine || '(missing)'}`,
    '',
    '## Roundtrip (Steps -> Blockly -> Steps Export)',
    `- hasWrite: ${report.roundtrip.hasWrite}`,
    `- hasQuery: ${report.roundtrip.hasQuery}`,
    `- writeLine: ${report.roundtrip.writeLine || '(missing)'}`,
    `- queryLine: ${report.roundtrip.queryLine || '(missing)'}`,
    '',
    '## Notes',
    report.notes,
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_MD, md);
}

test('canary: set_and_query preservation across Steps <-> Blockly', async ({ page }) => {
  await gotoBuilder(page);
  await clearSteps(page);

  await addSetAndQuery(page, 'CH1:SCAle 2.0');
  const baselineCode = await exportPython(page, 'set_and_query_baseline.py');
  const baseline = inspectSetAndQueryPython(baselineCode);

  await page.getByRole('button', { name: /^Blockly$/i }).click();
  await expect(page.getByRole('button', { name: /Export to Steps/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: /Import( from)? Steps/i }).click();
  const importModal = page.getByRole('heading', { name: /Import Steps from Builder/i });
  if (await importModal.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /^Import$/i }).click();
  }
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Export to Steps/i }).click();
  await expect(page.getByTestId('step-palette')).toBeVisible({ timeout: 10000 });

  const roundtripCode = await exportPython(page, 'set_and_query_roundtrip.py');
  const roundtrip = inspectSetAndQueryPython(roundtripCode);

  const preserved = baseline.hasWrite && baseline.hasQuery && roundtrip.hasWrite && roundtrip.hasQuery;

  const report: CanaryReport = {
    timestamp: new Date().toISOString(),
    scenario: 'Single Set+Query step: CH1:SCAle 2.0',
    baseline,
    roundtrip,
    preserved,
    notes: preserved
      ? 'Set+Query semantics preserved through Blockly roundtrip.'
      : 'Set+Query semantics are not fully preserved through Blockly roundtrip (query missing after roundtrip).',
  };

  writeReport(report);

  expect(baseline.hasWrite && baseline.hasQuery).toBe(true);
  expect(report.preserved).toBe(true);
});
