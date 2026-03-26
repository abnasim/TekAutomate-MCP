import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'repro');
const FLOW_PATH = path.join(OUT_DIR, 'repro_recall_screenshot_flow.json');
const PY_PATH = path.join(OUT_DIR, 'repro_recall_screenshot.py');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const flow = {
    steps: [
      { id: '1', type: 'connect', label: 'Connect to TekScope PC', params: { instrumentIds: [], printIdn: true } },
      {
        id: 'g1',
        type: 'group',
        label: 'Load Session',
        params: {},
        collapsed: false,
        children: [
          { id: '2', type: 'query', label: 'Read Instrument ID', params: { command: '*IDN?', saveAs: 'idn' } },
          { id: '3', type: 'recall', label: 'Load PCIeGen3 Session', params: { recallType: 'SESSION', filePath: 'C:/Users/u650455/Downloads/PCIeGen3.tss', reference: 'REF1' } },
          { id: '4', type: 'query', label: 'Wait for Load Complete', params: { command: '*OPC?', saveAs: '_' } }
        ]
      },
      {
        id: 'g2',
        type: 'group',
        label: 'Post Load Actions',
        params: {},
        collapsed: false,
        children: [
          { id: '5', type: 'save_screenshot', label: 'Capture Loaded Session Screen', params: { filename: 'PCIeGen3_loaded.png', scopeType: 'modern', method: 'pc_transfer' } },
          { id: '6', type: 'error_check', label: 'Check Instrument Errors', params: { command: 'ALLEV?' } }
        ]
      },
      { id: '7', type: 'disconnect', label: 'Disconnect', params: { instrumentIds: [] } }
    ]
  };
  fs.writeFileSync(FLOW_PATH, JSON.stringify(flow, null, 2), 'utf-8');
});

test('repro flow export python for recall + opc + screenshot section', async ({ page }) => {
  await gotoBuilder(page);

  await page.locator('#importFlow').setInputFiles(FLOW_PATH);
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 7000 });

  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).click();
  const download = await dl;
  await download.saveAs(PY_PATH);

  const py = fs.readFileSync(PY_PATH, 'utf-8');
  expect(py).toContain('RECALL:SESSION');
  expect(py).toContain('SAVE:IMAGE');
  expect(py).toContain('FILESYSTEM:READFILE');
});

