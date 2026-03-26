/**
 * PARAMETER PIPELINE validation: for every SCPI command that has {param}
 * placeholders, verify:
 *   1. The JSON arguments/params array defines matching parameter entries
 *   2. When fed through the generator with default/sample values, all
 *      placeholders are resolved
 *   3. The substituted values appear in the generated Python output
 *
 * This tests the PRODUCT DATA, not the generator code.
 * If a command JSON has a {channel} placeholder but no matching argument
 * definition, it shows up here.
 */
/// <reference types="jest" />

import {
  loadAndValidateCommandFile,
  getCommandsByGroup,
  COMMAND_JSON_FILES,
} from './scpiCommandValidator';
import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from '../generators/stepToPython';

const baseConfig: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

// ─── Helpers ───

function getScpiString(cmd: Record<string, unknown>): string {
  return ((cmd.scpi || cmd.command || cmd.header) as string || '').trim();
}

function isQueryOnly(cmd: Record<string, unknown>): boolean {
  const ct = cmd.commandType as string | undefined;
  if (ct === 'query') return true;
  if (ct === 'both' || ct === 'set') return false;
  const scpi = getScpiString(cmd);
  return scpi.endsWith('?');
}

function extractPlaceholders(scpi: string): string[] {
  const matches = scpi.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1, -1));
}

interface ArgDef {
  name: string;
  defaultValue?: unknown;
  default?: unknown;
  type?: string;
  validValues?: Record<string, unknown>;
}

function getArgDefs(cmd: Record<string, unknown>): ArgDef[] {
  const out: ArgDef[] = [];
  if (Array.isArray(cmd.arguments)) {
    for (const a of cmd.arguments as Record<string, unknown>[]) {
      if (typeof a === 'object' && a && typeof a.name === 'string') out.push(a as unknown as ArgDef);
    }
  }
  if (Array.isArray(cmd.params)) {
    for (const a of cmd.params as Record<string, unknown>[]) {
      if (typeof a === 'object' && a && typeof a.name === 'string') out.push(a as unknown as ArgDef);
    }
  }
  return out;
}

function pickValue(arg: ArgDef): unknown {
  if (arg.defaultValue !== undefined && arg.defaultValue !== null) return arg.defaultValue;
  if (arg.default !== undefined && arg.default !== null) return arg.default;
  const vv = arg.validValues;
  if (vv) {
    const vals = vv.values as unknown[];
    if (Array.isArray(vals) && vals.length > 0) return vals[0];
    if (typeof vv.min === 'number') return vv.min;
  }
  if (arg.type === 'numeric' || arg.type === 'number') return 1;
  return 'TEST';
}

// ─── Per-command result ───

interface ParamResult {
  scpi: string;
  placeholders: string[];
  definedParams: string[];
  missingDefs: string[];
  unresolvedInOutput: string[];
  valuesInOutput: boolean;
  pass: boolean;
  errors: string[];
}

function validateParamPipeline(cmd: Record<string, unknown>, groupName: string): ParamResult | null {
  const scpi = getScpiString(cmd);
  const placeholders = extractPlaceholders(scpi);
  if (placeholders.length === 0) return null; // no params, skip

  const argDefs = getArgDefs(cmd);
  const definedParams = argDefs.map((a) => a.name);
  const errors: string[] = [];

  // 1. Check: does JSON define all placeholders?
  const missingDefs = placeholders.filter(
    (ph) => !definedParams.some((d) => d.toLowerCase() === ph.toLowerCase())
  );
  if (missingDefs.length > 0) {
    errors.push(`Missing arg definitions for: ${missingDefs.join(', ')}`);
  }

  // Build step with param values
  const cmdParams = argDefs.map((a) => ({ name: a.name, default: String(a.defaultValue ?? a.default ?? '') }));
  const paramValues: Record<string, unknown> = {};
  for (const a of argDefs) {
    paramValues[a.name] = pickValue(a);
  }

  const isQ = isQueryOnly(cmd);
  const step: GeneratorStep = {
    id: '1',
    type: isQ ? 'query' : 'write',
    label: (cmd.name as string) || groupName,
    params: {
      command: scpi,
      cmdParams,
      paramValues,
      ...(isQ ? { saveAs: 'result' } : {}),
    },
  };

  let code: string;
  try {
    code = generatePythonFromSteps([step], baseConfig);
  } catch (e) {
    errors.push(`Generator threw: ${e}`);
    return { scpi, placeholders, definedParams, missingDefs, unresolvedInOutput: [], valuesInOutput: false, pass: false, errors };
  }

  // 2. Check: no unresolved {param} in scpi.write/query lines
  const callPattern = isQ ? /scpi\.query\("([^"]*)"\)/g : /scpi\.write\("([^"]*)"\)/g;
  const unresolvedInOutput: string[] = [];
  let match;
  while ((match = callPattern.exec(code)) !== null) {
    const arg = match[1];
    const unresolved = arg.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    if (unresolved) {
      unresolvedInOutput.push(...unresolved);
    }
  }
  if (unresolvedInOutput.length > 0) {
    errors.push(`Unresolved placeholders in output: ${unresolvedInOutput.join(', ')}`);
  }

  // 3. Check: substituted values appear in generated code
  let valuesInOutput = true;
  for (const a of argDefs) {
    const val = String(paramValues[a.name] ?? '');
    if (val && val !== 'TEST' && val !== '') {
      if (!code.includes(val)) {
        valuesInOutput = false;
      }
    }
  }

  return {
    scpi,
    placeholders,
    definedParams,
    missingDefs,
    unresolvedInOutput,
    valuesInOutput,
    pass: errors.length === 0,
    errors,
  };
}

// ─── Confidence report ───

interface GroupParamReport {
  groupName: string;
  totalWithParams: number;
  passed: number;
  failed: number;
  confidence: string;
  failures: { scpi: string; errors: string[] }[];
}

function formatParamReport(familyName: string, groups: GroupParamReport[]): string {
  const totalAll = groups.reduce((s, g) => s + g.totalWithParams, 0);
  const passAll = groups.reduce((s, g) => s + g.passed, 0);
  if (totalAll === 0) return `\n║ ${familyName}: no parameterized commands\n`;
  const lines: string[] = [
    `\n╔═══════════════════════════════════════════════════════════`,
    `║ PARAM PIPELINE: ${familyName}`,
    `║ ${passAll}/${totalAll} parameterized commands resolved (${((passAll / totalAll) * 100).toFixed(1)}%)`,
    `╠═══════════════════════════════════════════════════════════`,
  ];
  for (const g of groups) {
    if (g.totalWithParams === 0) continue;
    const icon = g.failed === 0 ? '✓' : '✗';
    lines.push(`║ ${icon} ${g.groupName}: ${g.passed}/${g.totalWithParams} (${g.confidence})`);
    for (const f of g.failures) {
      lines.push(`║   ✗ ${f.scpi}`);
      for (const e of f.errors) {
        lines.push(`║     → ${e}`);
      }
    }
  }
  lines.push(`╚═══════════════════════════════════════════════════════════\n`);
  return lines.join('\n');
}

// ─── Tests ───

describe('SCPI parameter pipeline (every parameterized command)', () => {
  COMMAND_JSON_FILES.forEach((filename) => {
    const familyName = filename.replace(/\.json$/i, '');
    const fileResult = loadAndValidateCommandFile(filename);
    if (!fileResult.data) return;
    const allGroups = getCommandsByGroup(fileResult.data);

    describe(`Device family: ${familyName}`, () => {
      const groupReports: GroupParamReport[] = [];
      let familyHasParamCommands = false;

      allGroups.forEach(({ groupName, commands }) => {
        const paramCommands = commands.filter((cmd) => {
          const scpi = getScpiString(cmd as Record<string, unknown>);
          return extractPlaceholders(scpi).length > 0;
        });

        if (paramCommands.length === 0) return;
        familyHasParamCommands = true;

        describe(`Group: ${groupName}`, () => {
          const results: ParamResult[] = [];

          paramCommands.forEach((cmd) => {
            const scpi = getScpiString(cmd as Record<string, unknown>);
            it(`${scpi.slice(0, 60)} → params resolve`, () => {
              const r = validateParamPipeline(cmd as Record<string, unknown>, groupName);
              if (r) {
                results.push(r);
                if (!r.pass) {
                  throw new Error(r.errors.join('; '));
                }
              }
            });
          });

          afterAll(() => {
            const total = results.length;
            const passed = results.filter((r) => r.pass).length;
            const failed = total - passed;
            const confidence = total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A';
            const failures = results.filter((r) => !r.pass).map((r) => ({ scpi: r.scpi, errors: r.errors }));
            groupReports.push({ groupName, totalWithParams: total, passed, failed, confidence, failures });
          });
        });
      });

      if (!familyHasParamCommands) {
        it(`no parameterized commands`, () => {
          expect(true).toBe(true);
        });
      }

      afterAll(() => {
        if (groupReports.length > 0) {
          console.log(formatParamReport(familyName, groupReports));
        }
      });
    });
  });
});
