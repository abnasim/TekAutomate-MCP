/**
 * SCPI Corpus Builder — Data-driven E2E test
 *
 * For each command group in mso_2_4_5_6_7.json (and MSO/DPO 5k/7k):
 *   1. Pick commands that have params
 *   2. For each command generate 1-3 param variations (enum → all options, numeric → 3 values)
 *   3. Add Write + Query steps in the builder
 *   4. Export Python and save to e2e-output/scpi-corpus/{family}/{group}.py
 *   5. Validate presence of every SCPI string in the output
 *
 * Then write analysis.json:
 *   { group, command, scpi, paramValues, foundInOutput: boolean }[]
 *
 * Run with:  npx playwright test scpi-corpus --reporter=line
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoBuilder } from './helpers';
import { validateGeneratedPython } from '../src/validation/generatedCodeValidator';

// ─── Config ────────────────────────────────────────────────────────────────────
const MAX_COMMANDS_PER_GROUP = 8;   // keep each browser session fast
const CORPUS_DIR = path.join(process.cwd(), 'e2e-output', 'scpi-corpus');
const ANALYSIS_FILE = path.join(CORPUS_DIR, 'analysis.json');
// Partial files: one per group test, safe for parallel workers.
const PARTIALS_DIR = path.join(CORPUS_DIR, '_partials');

// ─── Types ─────────────────────────────────────────────────────────────────────
interface SCPIParam {
  name: string;
  type: string;
  required?: boolean;
  default?: any;
  options?: string[];
  min?: number;
  max?: number;
}

interface SCPICommand {
  scpi: string;
  name: string;
  group: string;
  params?: SCPIParam[];
  _manualEntry?: {
    commandType?: string;
    syntax?: { set?: string; query?: string };
  };
}

interface CommandFile {
  groups: Record<string, { name: string; commands: SCPICommand[] }>;
}

interface CommandEntry {
  group: string;
  family: string;
  command: SCPICommand;
  variations: ParameterVariation[];
}

interface ParameterVariation {
  label: string;
  writeScpi: string;
  queryScpi: string;
  paramValues: Record<string, string>;
}

interface AnalysisResult {
  family: string;
  group: string;
  command: string;
  scpi: string;
  paramLabel: string;
  paramValues: Record<string, string>;
  foundInOutput: boolean;
  queryFoundInOutput: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pickParamValues(param: SCPIParam): string[] {
  if (param.options && param.options.length > 0) {
    // Filter out angle-bracket placeholder strings like <number>, <value>, <file path>
    // so we only use real, testable values.
    const realOptions = param.options.filter(o => !/<[^>]+>/.test(o));
    if (realOptions.length > 0) return realOptions.slice(0, 3);
    // All options were placeholders — fall through to type-based derivation below
  }
  if (param.type === 'boolean') {
    return ['0', '1'];
  }
  if (param.type === 'numeric' || param.type === 'float' || param.type === 'integer') {
    const min = param.min ?? 0;
    const max = param.max ?? 10;
    const def = param.default ?? 1;
    return [String(min), String(def), String(max)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  }
  if (param.default != null) {
    const def = String(param.default);
    // Sanitize placeholder defaults like <number>, <file path> — use a real numeric fallback
    if (/<[^>]+>/.test(def)) return ['1'];
    return [def];
  }
  return ['TEST'];
}

function resolveScpi(template: string, paramValues: Record<string, string>): string {
  let result = template;

  // 0. Resolve SCPI inline brace-choice syntax: {OPT1|OPT2|...} → matching option or first option.
  //    These are SCPI notation alternatives (e.g. {A|B|B:RESET}, {CH<x>|MATH<x>|REF<x>}).
  //    Single-word param placeholders like {value} have no '|', so they are left for step 1.
  result = result.replace(/\{([^}]+\|[^}]*)\}/g, (_match, inner) => {
    const options = inner.split('|').map((s: string) => s.trim()).filter(Boolean);
    if (options.length === 0) return _match;

    // Try to match a param value directly to one of the options
    for (const candidate of Object.values(paramValues)) {
      for (const opt of options) {
        if (opt.toLowerCase() === candidate.toLowerCase()) return opt;
        // Handle options containing <x> (e.g. CH<x>) when candidate is a bare number
        if (opt.includes('<x>') && /^\d+$/.test(candidate)) {
          return opt.replace(/<x>/gi, candidate);
        }
        // Handle options containing <x> when candidate starts with the option prefix
        if (opt.includes('<x>')) {
          const prefix = opt.split('<x>')[0];
          if (candidate.toUpperCase().startsWith(prefix.toUpperCase())) {
            const num = candidate.match(/\d+/)?.[0] || '1';
            return opt.replace(/<x>/gi, num);
          }
        }
      }
    }

    // Fallback: first option, resolving any embedded <x>
    const first = options[0];
    if (first.includes('<x>')) {
      const num = String(
        paramValues['channel'] ?? paramValues['x'] ?? paramValues['source'] ?? '1'
      ).match(/\d+/)?.[0] || '1';
      return first.replace(/<x>/gi, num);
    }
    return first;
  });

  // 1. Replace {paramName} placeholders (standard param format)
  for (const [key, val] of Object.entries(paramValues)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'gi'), val);
  }

  // 2. Replace <x> style numeric index placeholders — mirrors App.tsx substituteSCPI logic.
  //    PREFIX<x>SUFFIX → try param value or default to '1'.
  //    Use || so that an empty-string param value also falls through to the next candidate.
  result = result.replace(/([A-Za-z]+)<x>([A-Za-z0-9_]*)/gi, (_match, prefix, suffix) => {
    const prefixLower = prefix.toLowerCase();
    // Only use a candidate value as a numeric index if it looks like an integer.
    // Non-numeric values (e.g. string defaults like '""') are silently skipped.
    const numericOnly = (v: string | undefined): string | undefined =>
      v && /^\d+$/.test(v) ? v : undefined;
    const val =
      numericOnly(paramValues[prefixLower]) ||
      numericOnly(paramValues['x']) ||
      numericOnly(paramValues['channel']) ||
      numericOnly(paramValues['bus']) ||
      numericOnly(paramValues['measurement']) ||
      numericOnly(paramValues['math']) ||
      numericOnly(paramValues['ch']) ||
      Object.values(paramValues).find((v) => /^\d+$/.test(v)) ||
      '1';
    return `${prefix}${val}${suffix}`;
  });

  // 3. Remove trailing ?
  result = result.replace(/\?$/, '').trim();

  // 4. If the template had NO inline placeholder and there is a 'value' param,
  //    append it — mirrors how App.tsx set_and_query builds the write command.
  //    e.g. "ACTONEVent:ENable" + value=1 → "ACTONEVent:ENable 1"
  const hadInlinePlaceholder = /\{[^}]+\}|<x>/i.test(template);
  if (!hadInlinePlaceholder && !result.includes(' ') && paramValues['value'] != null) {
    result = `${result} ${paramValues['value']}`;
  }

  return result;
}

function getQueryScpi(scpi: string, manualEntry?: SCPICommand['_manualEntry']): string | null {
  if (manualEntry?.syntax?.query) {
    // Normalise: uppercase header, remove extra spaces
    return manualEntry.syntax.query.trim().toUpperCase().replace(/\s+/g, ' ');
  }
  // If scpi itself ends in ? it's query-only
  if (scpi.endsWith('?')) return scpi.toUpperCase();
  // Otherwise append ?
  const header = scpi.split(/\s+/)[0];
  return (header + '?').toUpperCase();
}

function buildVariations(cmd: SCPICommand): ParameterVariation[] {
  const params = cmd.params?.filter((p) => p.name && p.name.trim()) ?? [];
  const queryScpi = getQueryScpi(cmd.scpi, cmd._manualEntry) ?? (cmd.scpi.split(/\s+/)[0] + '?');

  if (params.length === 0) {
    // No params: write = bare header, query = header?
    let header = cmd.scpi.replace(/\?$/, '').split(/\s+/)[0];
    if (cmd._manualEntry?.commandType === 'query') {
      return []; // query-only: skip (no write form)
    }
    // Resolve any <x> placeholders in the header (e.g. CALLOUT<x> → CALLOUT1)
    header = header.replace(/([A-Za-z]+)<x>([A-Za-z0-9_]*)/gi, '$11$2');
    return [{
      label: 'no-params',
      writeScpi: header.toUpperCase(),
      queryScpi: queryScpi,
      paramValues: {},
    }];
  }

  // Use the 'value' param if it exists (most write commands), otherwise first param
  const drivingParam = params.find((p) => p.name.toLowerCase() === 'value') ?? params[0];
  const values = pickParamValues(drivingParam);

  return values.map((val) => {
    const paramValues: Record<string, string> = {};
    // Set all params to defaults first
    for (const p of params) {
      paramValues[p.name] = p.default != null ? String(p.default) : 'TEST';
    }
    // Override the driving param with this variation
    paramValues[drivingParam.name] = val;

    const writeScpi = resolveScpi(cmd.scpi, paramValues);

    return {
      label: `${drivingParam.name}=${val}`,
      writeScpi: writeScpi.toUpperCase(),
      queryScpi: queryScpi,
      paramValues,
    };
  });
}

function loadCommandsForFamily(filePath: string, familyName: string): CommandEntry[] {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CommandFile;
  const entries: CommandEntry[] = [];

  for (const [groupKey, groupData] of Object.entries(raw.groups)) {
    const commands = Array.isArray(groupData.commands) ? groupData.commands : [];
    // Pick commands that have params and are 'both' (set+query) or no commandType
    const usable = commands.filter((c) => {
      const type = c._manualEntry?.commandType;
      return type !== 'query'; // skip query-only
    }).slice(0, MAX_COMMANDS_PER_GROUP);

    for (const cmd of usable) {
      const variations = buildVariations(cmd);
      if (variations.length === 0) continue;
      entries.push({
        group: groupData.name || groupKey,
        family: familyName,
        command: cmd,
        variations,
      });
    }
  }
  return entries;
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

async function addWriteStep(page: import('@playwright/test').Page, scpiCommand: string) {
  const palette = page.getByTestId('step-palette');
  await palette.getByText('Write', { exact: true }).first().click();
  await page.waitForTimeout(250);
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 4000 });
  await input.fill(scpiCommand);
  await page.waitForTimeout(150);
}

async function addQueryStep(page: import('@playwright/test').Page, scpiCommand: string) {
  const palette = page.getByTestId('step-palette');
  await palette.getByText('Query', { exact: true }).first().click();
  await page.waitForTimeout(250);
  const input = page.getByTestId('step-command-input').first();
  await expect(input).toBeVisible({ timeout: 4000 });
  await input.fill(scpiCommand);
  await page.waitForTimeout(150);
}

async function clearSteps(page: import('@playwright/test').Page) {
  await page.locator('button', { hasText: 'Clear' }).first().click();
  await page.waitForTimeout(300);
}

async function exportPython(page: import('@playwright/test').Page, outPath: string): Promise<string> {
  await page.getByRole('button', { name: /Gen Code/i }).click();
  await expect(page.getByRole('heading', { name: /Generate Python Code/i })).toBeVisible({ timeout: 5000 });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Export Script|Download script/i }).click();
  const download = await dl;
  await download.saveAs(outPath);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return fs.readFileSync(outPath, 'utf-8');
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

test.beforeAll(() => {
  for (const family of ['mso_4_5_6', 'mso_5k_7k', 'afg', 'awg', 'smu', 'dpojet', 'tekexpress', 'rsa']) {
    fs.mkdirSync(path.join(CORPUS_DIR, family), { recursive: true });
  }
  fs.mkdirSync(PARTIALS_DIR, { recursive: true });
  // Clear stale partial files from previous run (safe: each group uses a unique filename).
  // Multiple workers may run this simultaneously — unlinkSync on a missing file is fine.
  try {
    for (const f of fs.readdirSync(PARTIALS_DIR)) {
      if (f.endsWith('.json')) {
        try { fs.unlinkSync(path.join(PARTIALS_DIR, f)); } catch { /* already gone */ }
      }
    }
  } catch { /* dir may not exist yet on first run */ }
});

// ─── Load command data on Node side ───────────────────────────────────────────

const CMDS = (name: string) => path.join(process.cwd(), 'public', 'commands', name);

// Standard families — always tested
const allEntries: CommandEntry[] = [
  ...loadCommandsForFamily(CMDS('mso_2_4_5_6_7.json'),    'mso_4_5_6'),
  ...loadCommandsForFamily(CMDS('MSO_DPO_5k_7k_70K.json'), 'mso_5k_7k'),
  ...loadCommandsForFamily(CMDS('afg.json'),               'afg'),
  ...loadCommandsForFamily(CMDS('awg.json'),               'awg'),
  ...loadCommandsForFamily(CMDS('smu.json'),               'smu'),
  ...loadCommandsForFamily(CMDS('dpojet.json'),            'dpojet'),
  ...loadCommandsForFamily(CMDS('tekexpress.json'),        'tekexpress'),
];

// RSA has 18 groups (~3700 commands) — opt-in via FULL_CORPUS=true env var.
// Usage: FULL_CORPUS=true npx playwright test scpi-corpus
if (process.env.FULL_CORPUS === 'true') {
  allEntries.push(...loadCommandsForFamily(CMDS('rsa.json'), 'rsa'));
}

// Group by family::group for test organisation
const groupMap = new Map<string, { family: string; entries: CommandEntry[] }>();
for (const e of allEntries) {
  const key = `${e.family}::${e.group}`;
  if (!groupMap.has(key)) groupMap.set(key, { family: e.family, entries: [] });
  groupMap.get(key)!.entries.push(e);
}

const groupKeys = [...groupMap.keys()];

// ─── One test per group ────────────────────────────────────────────────────────

for (const groupKey of groupKeys) {
  const { family, entries } = groupMap.get(groupKey)!;
  const groupName = entries[0].group;
  const safeGroupName = groupName.replace(/[^a-z0-9_]/gi, '_').toLowerCase();

  test(`[${family}] ${groupName} — write+query corpus`, async ({ page }) => {
    await gotoBuilder(page);

    const writeCommands: string[] = [];
    const queryCommands: string[] = [];

    for (const entry of entries) {
      // Add one Write step per unique parameter variation
      for (const variation of entry.variations) {
        await addWriteStep(page, variation.writeScpi);
        writeCommands.push(variation.writeScpi);
      }
      // Add ONE Query step per command (not per variation)
      if (entry.variations.length > 0) {
        const queryScpi = entry.variations[0].queryScpi;
        await addQueryStep(page, queryScpi);
        queryCommands.push(queryScpi);
      }
    }

    if (writeCommands.length === 0) {
      test.skip();
      return;
    }

    const outPath = path.join(CORPUS_DIR, family, `${safeGroupName}.py`);
    const code = await exportPython(page, outPath);

    // Validate Python structure
    const validation = validateGeneratedPython(code);
    expect(validation.valid, `Python invalid: ${validation.errors.join('; ')}`).toBe(true);

    // Record analysis
    let groupPassCount = 0;
    let groupFailCount = 0;
    const groupAnalysis: AnalysisResult[] = [];
    for (const entry of entries) {
      for (const variation of entry.variations) {
        // Primary check: exact or case-insensitive substring match
        const writeScpiLower = variation.writeScpi.toLowerCase();
        let writeFound = code.includes(variation.writeScpi) ||
          code.toLowerCase().includes(writeScpiLower);

        // Secondary check: the app wraps string-typed param values in escaped double quotes
        // inside a Python string literal, e.g. scpi.write("CMD \"VALUE\""), and doubles
        // backslashes in paths (C:\f → C:\\\\f on disk).  Handle both by normalising the
        // expected string the same way the generator does before searching the output file.
        if (!writeFound) {
          const wParts = variation.writeScpi.split(/\s+/);
          if (wParts.length > 1) {
            const cmdPart = wParts.slice(0, -1).join(' ');
            const valPart = wParts[wParts.length - 1];
            const escapedQuoteAlt = `${cmdPart} \\"${valPart}\\"`.toLowerCase();
            writeFound = code.toLowerCase().includes(escapedQuoteAlt);
          }
        }

        // Tertiary check: escape ALL double-quotes and double ALL backslashes — covers
        // commands with quoted strings anywhere (e.g. WLIST:NEW "name",len,type) and
        // Windows file paths (C:\path → C:\\\\path in Python string literal on disk).
        if (!writeFound) {
          const fullyNormalized = variation.writeScpi
            .replace(/\\/g, '\\\\')   // C:\f  → C:\\f  (matches \\\\f on disk)
            .replace(/"/g, '\\"')     // "val" → \"val\" (matches escaped quotes on disk)
            .toLowerCase();
          writeFound = code.toLowerCase().includes(fullyNormalized);
        }

        const queryFound = code.includes(variation.queryScpi) ||
          code.toLowerCase().includes(variation.queryScpi.toLowerCase());

        const result: AnalysisResult = {
          family,
          group: groupName,
          command: entry.command.name || entry.command.scpi,
          scpi: entry.command.scpi,
          paramLabel: variation.label,
          paramValues: variation.paramValues,
          foundInOutput: writeFound,
          queryFoundInOutput: queryFound,
        };
        groupAnalysis.push(result);
        if (writeFound) groupPassCount++; else groupFailCount++;
      }
    }

    // Write this group's results to its own partial file — safe for parallel workers.
    const partialFile = path.join(PARTIALS_DIR, `${family}_${safeGroupName}.json`);
    fs.writeFileSync(partialFile, JSON.stringify(groupAnalysis, null, 2));

    // Print summary
    console.log(`  [${family}] ${groupName}: ${writeCommands.length} write steps, ` +
      `${groupPassCount} found / ${groupFailCount} missing in output`);

    // Log the pass rate but never hard-fail — this is a corpus builder, not a gatekeeper
    const passRate = writeCommands.length > 0 ? groupPassCount / writeCommands.length : 1;
    const pct = Math.round(passRate * 100);
    if (pct < 80) {
      console.warn(`  ⚠ LOW COVERAGE: ${groupName} — ${groupPassCount}/${writeCommands.length} (${pct}%) commands found in output`);
    }
  });
}

// ─── Summary test — runs last ──────────────────────────────────────────────────

test('SCPI corpus — write summary report', async ({ page: _page }) => {
  // Merge all per-group partial files written by parallel workers into one analysis.json
  if (!fs.existsSync(PARTIALS_DIR)) {
    console.log('No partial analysis data — group tests may have been skipped');
    return;
  }
  const partialFiles = fs.readdirSync(PARTIALS_DIR).filter(f => f.endsWith('.json'));
  if (partialFiles.length === 0) {
    console.log('No analysis data yet — group tests may have been skipped');
    return;
  }

  const results: AnalysisResult[] = partialFiles.flatMap(f => {
    try { return JSON.parse(fs.readFileSync(path.join(PARTIALS_DIR, f), 'utf-8')) as AnalysisResult[]; }
    catch { return []; }
  });
  fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(results, null, 2));
  const total = results.length;
  const passed = results.filter((r) => r.foundInOutput).length;
  const failed = results.filter((r) => !r.foundInOutput).length;

  // Group by family+group for summary
  const byGroup = new Map<string, AnalysisResult[]>();
  for (const r of results) {
    const k = `${r.family} / ${r.group}`;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k)!.push(r);
  }

  const summary: Record<string, { pass: number; fail: number; passRate: string }> = {};
  for (const [k, items] of byGroup.entries()) {
    const p = items.filter((i) => i.foundInOutput).length;
    const f = items.length - p;
    summary[k] = { pass: p, fail: f, passRate: `${Math.round((p / items.length) * 100)}%` };
  }

  // Write summary markdown report
  const mdLines = [
    '# SCPI Corpus Analysis Report',
    '',
    `**Total commands tested:** ${total}  `,
    `**Found in output:** ${passed} (${Math.round((passed / total) * 100)}%)  `,
    `**Missing from output:** ${failed}  `,
    '',
    '## Results by Group',
    '',
    '| Family / Group | Pass | Fail | Rate |',
    '|---|---|---|---|',
    ...Object.entries(summary).map(([k, v]) => `| ${k} | ${v.pass} | ${v.fail} | ${v.passRate} |`),
    '',
    '## Failed Commands',
    '',
    ...results
      .filter((r) => !r.foundInOutput)
      .map((r) => `- **${r.family}/${r.group}** \`${r.scpi}\` (params: ${r.paramLabel})`),
  ];

  const mdPath = path.join(CORPUS_DIR, 'analysis-report.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'));
  console.log(`\n📊 SCPI Corpus Summary: ${passed}/${total} commands found in output`);
  console.log(`   Report: ${mdPath}`);

  // The summary is informational — always passes
  expect(total).toBeGreaterThan(0);
});
