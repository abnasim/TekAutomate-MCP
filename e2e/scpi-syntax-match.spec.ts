import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';

type SCPIParam = {
  name?: string;
  type?: string;
  default?: any;
  options?: string[];
};

type SCPICommand = {
  scpi?: string;
  name?: string;
  params?: SCPIParam[];
  _manualEntry?: {
    syntax?: {
      set?: string;
      query?: string;
    };
  };
};

type CorpusFile = {
  groups?: Record<string, { commands?: SCPICommand[] }>;
};

type Sample = {
  group: string;
  commandName: string;
  setCommand: string;
  queryCommand: string;
  setSyntax: string;
  expectsQuotedString: boolean;
};

const OUT_DIR = path.join(process.cwd(), 'e2e-output', 'syntax-match');
const ISSUE_DIR = path.join(process.cwd(), 'e2e-output', 'issues');
const SAMPLE_LIMIT = 6;

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ISSUE_DIR, { recursive: true });
});

function pickConcreteValue(param?: SCPIParam): string | null {
  if (!param) return null;
  const opts = Array.isArray(param.options) ? param.options : [];
  const realOpt = opts.find((o) => o && !/<[^>]+>/.test(o) && !/[{}|]/.test(o));
  if (realOpt) return String(realOpt).trim();

  if (param.default !== undefined && param.default !== null) {
    const d = String(param.default).trim();
    if (d && !/<[^>]+>/.test(d)) return d;
  }

  const t = (param.type || '').toLowerCase();
  if (t.includes('bool')) return '1';
  if (t.includes('int') || t.includes('number') || t.includes('float') || t.includes('numeric')) return '1';
  return null;
}

function ensureQuotedValue(value: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return '"1"';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

function toPythonStringLiteralContent(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeWhitespace(v: string): string {
  return (v || '').replace(/\s+/g, ' ').trim();
}

function loadSamplesFromCorpus(): Sample[] {
  const corpusPath = path.join(process.cwd(), 'public', 'commands', 'mso_2_4_5_6_7.json');
  const raw = JSON.parse(fs.readFileSync(corpusPath, 'utf-8')) as CorpusFile;
  const qstringSamples: Sample[] = [];
  const genericSamples: Sample[] = [];

  for (const [groupName, group] of Object.entries(raw.groups || {})) {
    for (const cmd of group.commands || []) {
      const scpi = normalizeWhitespace(cmd.scpi || '');
      const setSyntax = normalizeWhitespace(cmd._manualEntry?.syntax?.set || '');
      const querySyntax = normalizeWhitespace(cmd._manualEntry?.syntax?.query || '');
      if (!scpi || !setSyntax || !querySyntax) continue;

      // Keep the fast suite stable: skip path/index placeholder commands.
      if (/[<]x[>]/i.test(scpi) || /[<]x[>]/i.test(setSyntax) || /[<]x[>]/i.test(querySyntax)) continue;

      const valueParam =
        (cmd.params || []).find((p) => (p.name || '').toLowerCase() === 'value') ||
        (cmd.params || [])[0];
      const expectsQuotedString = /<Qstring>|<QString>/i.test(setSyntax);
      let concreteValue = pickConcreteValue(valueParam);
      if (!concreteValue && expectsQuotedString) concreteValue = '"1"';
      if (!concreteValue) continue;
      if (expectsQuotedString) concreteValue = ensureQuotedValue(concreteValue);

      const header = scpi.replace(/\?$/, '').split(/\s+/)[0];
      const queryHeader = querySyntax.split(/\s+/)[0];
      const setCommand = `${header} ${concreteValue}`;
      const queryCommand = queryHeader.endsWith('?') ? queryHeader : `${queryHeader}?`;

      const sample: Sample = {
        group: groupName,
        commandName: cmd.name || header,
        setCommand,
        queryCommand,
        setSyntax,
        expectsQuotedString,
      };
      if (expectsQuotedString) qstringSamples.push(sample);
      else genericSamples.push(sample);
    }
  }

  const selected: Sample[] = [];
  if (qstringSamples.length > 0) selected.push(qstringSamples[0]);
  for (const s of genericSamples) {
    if (selected.length >= SAMPLE_LIMIT) break;
    selected.push(s);
  }
  if (selected.length < SAMPLE_LIMIT) {
    for (const s of qstringSamples.slice(1)) {
      if (selected.length >= SAMPLE_LIMIT) break;
      selected.push(s);
    }
  }

  return selected;
}

function assertQuotedStringSamples(samples: Sample[], content: string) {
  const qSamples = samples.filter((s) => s.expectsQuotedString);
  for (const s of qSamples) {
    if (!/"[^"]*"/.test(s.setCommand)) {
      throw new Error(
        `Quoted-string sample "${s.commandName}" expected quoted set command, got "${s.setCommand}"`
      );
    }
    const expectedLiteral = toPythonStringLiteralContent(s.setCommand);
    if (!content.includes(expectedLiteral)) {
      throw new Error(
        `Generated python missing expected quoted-string command for "${s.commandName}": ${expectedLiteral}`
      );
    }
  }
}

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
  await page.waitForTimeout(220);
}

async function setStepCommand(page: Page, command: string) {
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 4000 });
  await input.fill(command);
  await page.waitForTimeout(120);
}

async function setStepSaveAs(page: Page, variableName: string) {
  const useVariableCheckbox = page.getByRole('checkbox', { name: /Set Variable/i }).first();
  await expect(useVariableCheckbox).toBeVisible({ timeout: 3000 });
  if (!(await useVariableCheckbox.isChecked())) await useVariableCheckbox.check();
  await page.waitForTimeout(80);
  const saveAsInput = page.getByTestId('step-saveas-input').first();
  await expect(saveAsInput).toBeVisible({ timeout: 3000 });
  await saveAsInput.fill(variableName);
  await page.waitForTimeout(100);
}

async function exportPython(page: Page, fileName: string): Promise<string> {
  const outPath = path.join(OUT_DIR, fileName);
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({
    timeout: 5000,
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).first().click();
  const download = await downloadPromise;
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

function logIssue(name: string, content: string, details: Record<string, unknown>) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}__${stamp}`;
  fs.writeFileSync(path.join(ISSUE_DIR, `${base}.py`), content, 'utf-8');
  fs.writeFileSync(path.join(ISSUE_DIR, `${base}.json`), JSON.stringify(details, null, 2), 'utf-8');
}

test('corpus samples: generated python matches set/query syntax patterns', async ({ page }) => {
  const samples = loadSamplesFromCorpus();
  expect(samples.length).toBeGreaterThanOrEqual(4);
  expect(samples.some((s) => s.expectsQuotedString)).toBe(true);

  await gotoBuilder(page);
  await clearSteps(page);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    await addStepFromPalette(page, 'Write');
    await setStepCommand(page, s.setCommand);
    await addStepFromPalette(page, 'Query');
    await setStepCommand(page, s.queryCommand);
    await setStepSaveAs(page, `sample_${i + 1}_resp`);
  }

  const content = await exportPython(page, 'corpus_set_query_syntax.py');
  const required = samples.flatMap((s, i) => [
    toPythonStringLiteralContent(s.setCommand),
    toPythonStringLiteralContent(s.queryCommand),
    `sample_${i + 1}_resp`,
  ]);
  const validation = validateGeneratedPython(content, {
    requiredSubstrings: required,
    forbiddenSubstrings: ['<x>', '{value}', '{channel}'],
  });
  try {
    assertQuotedStringSamples(samples, content);
  } catch (err) {
    validation.valid = false;
    validation.errors.push(err instanceof Error ? err.message : String(err));
  }

  if (!validation.valid) {
    logIssue('corpus_syntax_mismatch', content, {
      samples,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  expect(validation.valid, validation.errors.join('; ')).toBe(true);
});
