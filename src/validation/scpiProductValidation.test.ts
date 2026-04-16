/**
 * PRODUCT validation: every real SCPI command from every JSON file,
 * added as a step, run through the generator, output validated.
 * Grouped by device family and command group with confidence scores.
 *
 * This tests the PRODUCT, not the code. If a command's JSON data
 * doesn't flow through the pipeline correctly, it shows up here.
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

// ─── Helpers: extract realistic param values from command JSON ───

interface CmdParam {
  name: string;
  default?: string;
}

function getScpiString(cmd: Record<string, unknown>): string {
  return ((cmd.scpi || cmd.command || cmd.header) as string || '').trim();
}

function isQueryCommand(cmd: Record<string, unknown>): boolean {
  const ct = cmd.commandType as string | undefined;
  if (ct === 'query') return true;
  if (ct === 'both') return false; // prefer write for "both"
  if (cmd.hasQuery === true && cmd.hasSet === false) return true;
  const scpi = getScpiString(cmd);
  return scpi.endsWith('?');
}

/**
 * Build cmdParams and paramValues from a command's arguments/params.
 * Uses defaults, first enum value, or a safe placeholder.
 */
function buildParamValues(cmd: Record<string, unknown>): {
  cmdParams: CmdParam[];
  paramValues: Record<string, unknown>;
} {
  const cmdParams: CmdParam[] = [];
  const paramValues: Record<string, unknown> = {};

  const argSources = [
    ...(Array.isArray(cmd.arguments) ? (cmd.arguments as Record<string, unknown>[]) : []),
    ...(Array.isArray(cmd.params) ? (cmd.params as Record<string, unknown>[]) : []),
  ];

  for (const arg of argSources) {
    const name = (arg.name as string) || '';
    if (!name) continue;
    cmdParams.push({ name, default: String(arg.defaultValue ?? arg.default ?? '') });

    // Pick a realistic value
    const vv = arg.validValues as Record<string, unknown> | undefined;
    if (arg.defaultValue !== undefined && arg.defaultValue !== null) {
      paramValues[name] = arg.defaultValue;
    } else if (arg.default !== undefined && arg.default !== null) {
      paramValues[name] = arg.default;
    } else if (vv) {
      const vals = vv.values as unknown[];
      if (Array.isArray(vals) && vals.length > 0) {
        paramValues[name] = vals[0];
      } else if (typeof vv.min === 'number') {
        paramValues[name] = vv.min;
      } else {
        paramValues[name] = 1;
      }
    } else if (arg.type === 'numeric' || arg.type === 'number') {
      paramValues[name] = 1;
    } else {
      paramValues[name] = 'TEST';
    }
  }
  return { cmdParams, paramValues };
}

// ─── Per-command validation result ───

interface CommandResult {
  scpi: string;
  pass: boolean;
  errors: string[];
}

function validateCommand(cmd: Record<string, unknown>, groupName: string): CommandResult {
  const scpi = getScpiString(cmd);
  const errors: string[] = [];

  if (!scpi) {
    return { scpi: '(no scpi)', pass: false, errors: ['No SCPI string'] };
  }

  const isQuery = isQueryCommand(cmd);
  const { cmdParams, paramValues } = buildParamValues(cmd);

  const step: GeneratorStep = {
    id: '1',
    type: isQuery ? 'query' : 'write',
    label: (cmd.name as string) || groupName,
    params: {
      command: scpi,
      cmdParams,
      paramValues,
      ...(isQuery ? { saveAs: 'result' } : {}),
    },
  };

  let code: string;
  try {
    code = generatePythonFromSteps([step], baseConfig);
  } catch (e) {
    return { scpi, pass: false, errors: [`Generator threw: ${e}`] };
  }

  // 1. Must contain scpi.write or scpi.query
  const hasUsage = isQuery ? code.includes('scpi.query') : code.includes('scpi.write');
  if (!hasUsage) errors.push(`Missing scpi.${isQuery ? 'query' : 'write'} in output`);

  // 2. No unresolved {param} in scpi.write/query lines
  const scpiCallPattern = isQuery
    ? /scpi\.query\("([^"]*)"\)/g
    : /scpi\.write\("([^"]*)"\)/g;
  let match;
  while ((match = scpiCallPattern.exec(code)) !== null) {
    const arg = match[1];
    if (/\{[a-zA-Z_]+\}/.test(arg)) {
      errors.push(`Unresolved placeholder in generated code: ${arg.slice(0, 60)}`);
    }
  }

  // 3. If command has no {param}, the scpi string (or a recognizable prefix) should appear
  if (!/\{[^}]+\}/.test(scpi)) {
    const header = scpi.replace(/\?$/, '').split(/\s+/)[0];
    if (!code.includes(header)) {
      errors.push(`Command header "${header}" not found in generated code`);
    }
  }

  return { scpi, pass: errors.length === 0, errors };
}

// ─── Confidence report helpers ───

interface GroupReport {
  groupName: string;
  total: number;
  passed: number;
  failed: number;
  confidence: string;
  failures: { scpi: string; errors: string[] }[];
}

function formatReport(familyName: string, groups: GroupReport[]): string {
  const totalAll = groups.reduce((s, g) => s + g.total, 0);
  const passAll = groups.reduce((s, g) => s + g.passed, 0);
  const lines: string[] = [
    `\n╔══════════════════════════════════════════════════════`,
    `║ ${familyName}: ${passAll}/${totalAll} commands OK (${totalAll > 0 ? ((passAll / totalAll) * 100).toFixed(1) : 0}% confidence)`,
    `╠══════════════════════════════════════════════════════`,
  ];
  for (const g of groups) {
    const icon = g.failed === 0 ? '✓' : '✗';
    lines.push(`║ ${icon} ${g.groupName}: ${g.passed}/${g.total} (${g.confidence})`);
    for (const f of g.failures) {
      lines.push(`║   ✗ ${f.scpi}`);
      for (const e of f.errors) {
        lines.push(`║     → ${e}`);
      }
    }
  }
  lines.push(`╚══════════════════════════════════════════════════════\n`);
  return lines.join('\n');
}

// ─── Tests ───

describe('SCPI product validation (every command, every group)', () => {
  COMMAND_JSON_FILES.forEach((filename) => {
    const familyName = filename.replace(/\.json$/i, '');
    const fileResult = loadAndValidateCommandFile(filename);
    if (!fileResult.data) return;
    const allGroups = getCommandsByGroup(fileResult.data);

    describe(`Device family: ${familyName}`, () => {
      const groupReports: GroupReport[] = [];

      allGroups.forEach(({ groupName, commands }) => {
        if (commands.length === 0) return;
        describe(`Group: ${groupName}`, () => {
          const results: CommandResult[] = [];

          commands.forEach((cmd, idx) => {
            const scpi = getScpiString(cmd as Record<string, unknown>);
            const label = scpi ? scpi.slice(0, 50) : `command[${idx}]`;
            it(`${label}`, () => {
              const r = validateCommand(cmd as Record<string, unknown>, groupName);
              results.push(r);
              if (!r.pass) {
                throw new Error(r.errors.join('; '));
              }
            });
          });

          afterAll(() => {
            const total = results.length;
            const passed = results.filter((r) => r.pass).length;
            const failed = total - passed;
            const confidence = total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : 'N/A';
            const failures = results
              .filter((r) => !r.pass)
              .map((r) => ({ scpi: r.scpi, errors: r.errors }));
            groupReports.push({ groupName, total, passed, failed, confidence, failures });
          });
        });
      });

      afterAll(() => {
        if (groupReports.length > 0) {
          console.log(formatReport(familyName, groupReports));
        }
      });
    });
  });
});
