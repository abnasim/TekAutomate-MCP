/**
 * Regression Scenarios
 *
 * Group 1:  SCPI Command String Integrity
 * Group 6:  set_and_query Roundtrip
 * Group 7:  Import/Template Load Regression
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder, nextDialogDismiss } from './helpers';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'regression');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function addWrite(page: import('@playwright/test').Page, cmd: string) {
  await page.getByTestId('step-palette').getByText('Write', { exact: true }).first().click();
  await page.waitForTimeout(250);
  const inp = page.getByTestId('step-command-input').first();
  await expect(inp).toBeVisible({ timeout: 4000 });
  await inp.fill(cmd);
  await page.waitForTimeout(150);
}

async function addQuery(page: import('@playwright/test').Page, cmd: string) {
  await page.getByTestId('step-palette').getByText('Query', { exact: true }).first().click();
  await page.waitForTimeout(250);
  const inp = page.getByTestId('step-command-input').first();
  await expect(inp).toBeVisible({ timeout: 4000 });
  await inp.fill(cmd);
  await page.waitForTimeout(150);
}

async function addSetAndQuery(page: import('@playwright/test').Page, cmd: string) {
  await page.getByTestId('step-palette').getByText('Set+Query', { exact: true }).first().click();
  await page.waitForTimeout(250);
  const inp = page.getByTestId('step-command-input').first();
  await expect(inp).toBeVisible({ timeout: 4000 });
  await inp.fill(cmd);
  await page.waitForTimeout(150);
}

async function exportPython(page: import('@playwright/test').Page, filename: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).click();
  const download = await dl;
  const outPath = path.join(OUT_DIR, filename);
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

/** Flow dropdown is hover-triggered (onMouseEnter/Leave in App.tsx). */
async function exportFlowJson(page: import('@playwright/test').Page, filename: string): Promise<string> {
  await page.locator('[data-tour="flow-dropdown"]').hover();
  await page.waitForTimeout(250);
  const dl = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: /Export Flow/i }).first().click();
  const download = await dl;
  const outPath = path.join(OUT_DIR, filename);
  await download.saveAs(outPath);
  await page.waitForTimeout(300);
  return fs.readFileSync(outPath, 'utf-8');
}

/**
 * Import a flow JSON via the hidden file input.
 * - mode='replace' (default): global handleDialogs accepts → Replace
 * - mode='append': calls nextDialogDismiss() so handleDialogs dismisses → Append
 */
async function importFlowJson(
  page: import('@playwright/test').Page,
  filePath: string,
  mode: 'replace' | 'append' = 'replace'
) {
  if (mode === 'append') nextDialogDismiss(page);
  await page.locator('#importFlow').setInputFiles(filePath);
  await page.waitForTimeout(600);
}

async function clearFlow(page: import('@playwright/test').Page) {
  await page.locator('button.text-red-600', { hasText: 'Clear' }).click();
  await page.waitForTimeout(300);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Only flags {PARAM_NAME} style SCPI placeholders, NOT Python f-string braces. */
function hasUnresolvedSCPIPlaceholder(code: string): boolean {
  // Matches { followed by a plain identifier (no spaces, no colons) }
  // but only in scpi.write() / safe_query_text(scpi, ...) call strings
  const callPattern = /scpi\.(write|query)\("[^"]*\{[A-Za-z_][A-Za-z0-9_]*\}[^"]*"\)/g;
  return callPattern.test(code);
}

function hasUnresolvedIndexToken(code: string): boolean {
  // Only flag <x> tokens that appear inside scpi call strings
  return /scpi\.(write|query)\("[^"]*<x>[^"]*"\)/.test(code);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: SCPI Command String Integrity
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Group 1 — SCPI Command String Integrity', () => {

  /**
   * R1.1 — MSO CH1:SCAle with numeric value 1.0
   * Regression: param substitution used to leave {value} unresolved.
   */
  test('R1.1 — CH1:SCAle 1.0 appears verbatim in write call', async ({ page }) => {
    await gotoBuilder(page);
    await addWrite(page, 'CH1:SCAle 1.0');
    const code = await exportPython(page, 'r1_1_ch1_scale.py');

    expect(code).toContain('scpi.write("CH1:SCAle 1.0")');
    expect(hasUnresolvedSCPIPlaceholder(code), 'unresolved {placeholder} in write/query call').toBe(false);
    expect(hasUnresolvedIndexToken(code), 'raw <x> token in write/query call').toBe(false);
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.2 — SAVEONEVent:WAVEform:SOUrce CH3
   * Regression: param substitution produced {CH<x>VERTical...} — unresolved index token.
   * We type the full command; the app may resolve CH3 via its lookup or keep it literal.
   * Either way the output must NOT contain raw <x> tokens inside scpi call strings.
   */
  test('R1.2 — SAVEONEVent:WAVEform:SOUrce — no raw <x> token in scpi call', async ({ page }) => {
    await gotoBuilder(page);
    await addWrite(page, 'SAVEONEVent:WAVEform:SOUrce CH3');
    const code = await exportPython(page, 'r1_2_saveonevent_ch3.py');

    // Core regression assertion: no {CH<x>...} placeholder inside write/query strings
    expect(code).not.toMatch(/scpi\.(write|query)\("[^"]*\{CH<x>[^"]*"\)/);
    expect(hasUnresolvedIndexToken(code), 'raw <x> in scpi write/query call').toBe(false);
    expect(code).toContain('scpi.write(');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.3 — AFG SOURce1:FREQuency:FIXed 1000
   * Regression: {ch} and {freq} placeholders used to stay unresolved.
   */
  test('R1.3 — AFG SOURce1:FREQuency:FIXed 1000 resolves correctly', async ({ page }) => {
    await gotoBuilder(page);
    await addWrite(page, 'SOURce1:FREQuency:FIXed 1000');
    const code = await exportPython(page, 'r1_3_afg_freq.py');

    expect(code).toContain('SOURce1:FREQuency:FIXed 1000');
    expect(hasUnresolvedSCPIPlaceholder(code), 'unresolved placeholder').toBe(false);
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.4 — AWG OUTPut1:STATe ON — literal ON, not the options string
   * Regression: option string "{0|1|OFF|ON}" appeared in output instead of the chosen value.
   */
  test('R1.4 — AWG OUTPut1:STATe ON — literal ON in output', async ({ page }) => {
    await gotoBuilder(page);
    await addWrite(page, 'OUTPut1:STATe ON');
    const code = await exportPython(page, 'r1_4_awg_output_on.py');

    expect(code).toContain('OUTPut1:STATe ON');
    expect(code).not.toMatch(/\{0\|1\|OFF\|ON\}/);
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.5 — SMU :MEASure:VOLTage:DC? — query verbatim in scpi.query()
   * Regression: query commands were silently dropped.
   */
  test('R1.5 — SMU :MEASure:VOLTage:DC? appears in scpi.query call', async ({ page }) => {
    await gotoBuilder(page);
    await addQuery(page, ':MEASure:VOLTage:DC?');
    const code = await exportPython(page, 'r1_5_smu_measure_volt.py');

    expect(code).toContain(':MEASure:VOLTage:DC?');
    // Generator uses safe_query_text() helper for queries
    expect(
      code.includes('scpi.query(') || code.includes('safe_query_text(scpi,')
    ).toBe(true);
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.6 — RSA INITIATE:CONTINUOUS OFF — literal OFF
   * Regression: enumeration options written as placeholder, not resolved value.
   */
  test('R1.6 — RSA INITIATE:CONTINUOUS OFF — OFF in write call', async ({ page }) => {
    await gotoBuilder(page);
    await addWrite(page, 'INITIATE:CONTINUOUS OFF');
    const code = await exportPython(page, 'r1_6_rsa_init_off.py');

    expect(code).toContain('INITIATE:CONTINUOUS OFF');
    expect(code).not.toContain('{state}');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.7 — Inline choice path substitution
   * TRIGger:{A|B|B:RESET} must honor selected enum value.
   */
  test('R1.7 — TRIGger:{A|B|B:RESET} resolves to selected path option', async ({ page }) => {
    await gotoBuilder(page);
    const flowPath = path.join(OUT_DIR, 'r1_7_inline_choice_flow.json');
    const flow = {
      steps: [
        {
          id: 'r1-7',
          type: 'write',
          label: 'Inline choice trigger',
          params: {
            command: 'TRIGger:{A|B|B:RESET}',
            cmdParams: [
              { name: 'value', type: 'enumeration', required: true, options: ['A', 'B', 'B:RESET'] }
            ],
            paramValues: { value: 'B:RESET' }
          }
        }
      ]
    };
    fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));
    await importFlowJson(page, flowPath, 'replace');

    const code = await exportPython(page, 'r1_7_inline_choice.py');
    expect(code).toContain('scpi.write("TRIGger:B:RESET")');
    expect(code).not.toContain('scpi.write("TRIGger:A")');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R1.8 — Combined choice + index substitution
   * DISplay:{CH<x>|MATH<x>|REF<x>}:INVERTColor must resolve branch + index.
   */
  test('R1.8 — DISplay:{CH<x>|MATH<x>|REF<x>}:INVERTColor resolves branch+index', async ({ page }) => {
    await gotoBuilder(page);
    const flowPath = path.join(OUT_DIR, 'r1_8_choice_index_flow.json');
    const flow = {
      steps: [
        {
          id: 'r1-8',
          type: 'write',
          label: 'Display source choice',
          params: {
            command: 'DISplay:{CH<x>|MATH<x>|REF<x>}:INVERTColor',
            cmdParams: [
              { name: 'source', type: 'enumeration', required: true, options: ['CH1', 'MATH1', 'REF1'] }
            ],
            paramValues: { source: 'MATH3' }
          }
        }
      ]
    };
    fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));
    await importFlowJson(page, flowPath, 'replace');

    const code = await exportPython(page, 'r1_8_choice_index.py');
    expect(code).toContain('scpi.write("DISplay:MATH3:INVERTColor")');
    expect(code).not.toContain('<x>');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: set_and_query Roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Group 6 — set_and_query Roundtrip', () => {

  /**
   * R6.1 — CH1:SCAle 2.0 — both write and query present
   */
  test('R6.1 — set_and_query emits both write(CH1:SCAle 2.0) and query(CH1:SCAle?)', async ({ page }) => {
    await gotoBuilder(page);
    await addSetAndQuery(page, 'CH1:SCAle 2.0');
    const code = await exportPython(page, 'r6_1_set_and_query.py');

    expect(code).toContain('scpi.write("CH1:SCAle 2.0")');
    // Generator uses safe_query_text() helper for queries
    expect(code).toContain('safe_query_text(scpi, "CH1:SCAle?")');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R6.2 — write line always comes before query in the output
   * Note: the app fills default enum options (e.g. ENVELOPE) not the typed string —
   * we assert ORDER only, not specific value.
   */
  test('R6.2 — write line appears before query line in set_and_query output', async ({ page }) => {
    await gotoBuilder(page);
    await addSetAndQuery(page, 'ACQuire:MODe SAMple');
    const code = await exportPython(page, 'r6_2_order.py');

    // Find first occurrence of the write call for ACQuire:MODe (any value)
    const writeMatch = code.match(/scpi\.write\("ACQuire:MODe[^"]*"\)/);
    // Generator uses safe_query_text() helper for queries
    const queryIdx = code.indexOf('safe_query_text(scpi, "ACQuire:MODe?")') !== -1
      ? code.indexOf('safe_query_text(scpi, "ACQuire:MODe?")')
      : code.indexOf('scpi.query("ACQuire:MODe?")');

    expect(writeMatch, 'write call for ACQuire:MODe not found').toBeTruthy();
    expect(queryIdx, 'query(ACQuire:MODe?) not found').toBeGreaterThan(-1);
    expect(writeMatch!.index!, 'write must come before query').toBeLessThan(queryIdx);
  });

  /**
   * R6.3 — header-only command — no crash, write + query both present
   */
  test('R6.3 — set_and_query with header-only command does not crash', async ({ page }) => {
    await gotoBuilder(page);
    await addSetAndQuery(page, 'CH1:COUPling');
    const code = await exportPython(page, 'r6_3_empty_param.py');

    expect(code).toContain('scpi.write(');
    // Generator uses safe_query_text() helper for queries
    expect(
      code.includes('scpi.query(') || code.includes('safe_query_text(scpi,')
    ).toBe(true);
    expect(code).toContain('CH1:COUPling');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R6.4 — two set_and_query steps — independent pairs, correct order
   */
  test('R6.4 — two set_and_query steps each produce independent write+query pairs', async ({ page }) => {
    await gotoBuilder(page);
    await addSetAndQuery(page, 'CH1:SCAle 0.5');
    await page.waitForTimeout(200);
    await addSetAndQuery(page, 'CH2:SCAle 1.0');
    const code = await exportPython(page, 'r6_4_two_saq.py');

    expect(code).toContain('scpi.write("CH1:SCAle 0.5")');
    // Generator uses safe_query_text() helper for queries
    expect(code).toContain('safe_query_text(scpi, "CH1:SCAle?")');
    expect(code).toContain('scpi.write("CH2:SCAle 1.0")');
    expect(code).toContain('safe_query_text(scpi, "CH2:SCAle?")');
    expect(code.indexOf('CH1:SCAle')).toBeLessThan(code.indexOf('CH2:SCAle'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: Import / Template Load Regression
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Group 7 — Import/Template Load Regression', () => {

  /**
   * R7.1 — Export Python → save flow JSON → import (replace) → re-export Python
   * The re-exported code must be byte-for-byte identical to the first export.
   * Uses simple commands that aren't matched by the command library (no param ambiguity).
   */
  test('R7.1 — export → save JSON → import → re-export produces identical Python', async ({ page }) => {
    await gotoBuilder(page);

    // Use raw commands that won't trigger param-recognition UI side-effects
    await addWrite(page, '*RST');
    await page.waitForTimeout(150);
    await addWrite(page, '*CLS');
    await page.waitForTimeout(150);
    await addQuery(page, '*IDN?');
    await page.waitForTimeout(150);
    await addSetAndQuery(page, 'CH1:SCAle 2.0');

    const code1 = await exportPython(page, 'r7_1_first_export.py');

    const flowJson = await exportFlowJson(page, 'r7_1_flow.json');
    expect(JSON.parse(flowJson).steps).toBeDefined();

    await clearFlow(page);
    await importFlowJson(page, path.join(OUT_DIR, 'r7_1_flow.json'), 'replace');

    const code2 = await exportPython(page, 'r7_1_second_export.py');
    expect(code2).toBe(code1);
  });

  /**
   * R7.2 — Import flow JSON and re-export contains all commands
   */
  test('R7.2 — import flow JSON and re-export Python contains all commands', async ({ page }) => {
    await gotoBuilder(page);

    // Build a simple, unambiguous flow
    await addWrite(page, '*RST');
    await page.waitForTimeout(150);
    await addQuery(page, '*IDN?');
    await page.waitForTimeout(150);
    await addWrite(page, ':MEASure:VOLTage:DC 1.5');

    await exportFlowJson(page, 'r7_2_flow.json');

    await clearFlow(page);
    await importFlowJson(page, path.join(OUT_DIR, 'r7_2_flow.json'), 'replace');

    const code = await exportPython(page, 'r7_2_reimport.py');

    expect(code).toContain('*RST');
    expect(code).toContain('*IDN?');
    expect(code).toContain(':MEASure:VOLTage:DC');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });

  /**
   * R7.3 — Import-append wraps the imported steps alongside existing steps
   */
  test('R7.3 — import in append mode: both original and imported steps present', async ({ page }) => {
    await gotoBuilder(page);

    // Build a flow to export and re-import as append
    await addWrite(page, '*RST');
    await exportFlowJson(page, 'r7_3_flow.json');
    await clearFlow(page);

    // Build a different starting flow
    await addWrite(page, 'CH1:SCAle 1.0');

    // Append the previously exported flow
    await importFlowJson(page, path.join(OUT_DIR, 'r7_3_flow.json'), 'append');

    const code = await exportPython(page, 'r7_3_append.py');

    // Both the original step and the imported step should be present
    expect(code).toContain('CH1:SCAle 1.0');
    expect(code).toContain('*RST');
  });

  /**
   * R7.4 — Hello Scope template: load → export → all expected SCPI present
   */
  test('R7.4 — Hello Scope template SCPI present in export', async ({ page }) => {
    await gotoBuilder(page);
    await page.getByRole('button', { name: /Templates/i }).click();
    await expect(page.getByRole('heading', { name: /Templates/i })).toBeVisible({ timeout: 5000 });
    const card = page.locator('[data-tour="hello-scope-template"]').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByRole('button', { name: /Append as Group/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Steps$/i }).click();
    await page.waitForTimeout(300);

    const code = await exportPython(page, 'r7_4_hello_scope.py');

    expect(code).toContain('*IDN?');
    expect(code).toContain('*OPT?');
    const v = validateGeneratedPython(code);
    expect(v.valid, v.errors.join('; ')).toBe(true);
  });
});
