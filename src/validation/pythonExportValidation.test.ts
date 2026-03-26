/**
 * COMPREHENSIVE: Every command from every JSON file → step → Python → py_compile.
 * Validates that the ENTIRE 8430-command corpus produces syntactically valid Python.
 * Runs py_compile on batched scripts (per-family) for efficiency.
 */
/// <reference types="jest" />

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadAndValidateCommandFile,
  getCommandsByGroup,
  COMMAND_JSON_FILES,
} from './scpiCommandValidator';
import { generatePythonFromSteps, GeneratorStep, GeneratorConfig } from '../generators/stepToPython';

const TEMP_DIR = path.join(process.cwd(), 'test-results', 'python-export');

const baseConfig: GeneratorConfig = {
  backend: 'pyvisa',
  host: '192.168.1.100',
  connectionType: 'tcpip',
  timeout: 5000,
};

function getPythonCommand(): string {
  try {
    execSync('python3 --version', { stdio: 'pipe' });
    return 'python3';
  } catch {
    try {
      execSync('python --version', { stdio: 'pipe' });
      return 'python';
    } catch {
      return '';
    }
  }
}

function getScpiString(cmd: Record<string, unknown>): string {
  return ((cmd.scpi || cmd.command || cmd.header) as string || '').trim();
}

function isQueryCommand(cmd: Record<string, unknown>): boolean {
  const ct = cmd.commandType as string | undefined;
  if (ct === 'query') return true;
  if (ct === 'both') return false;
  if (cmd.hasQuery === true && cmd.hasSet === false) return true;
  return getScpiString(cmd).endsWith('?');
}

function buildParamValues(cmd: Record<string, unknown>): {
  cmdParams: Array<{ name: string; default?: string }>;
  paramValues: Record<string, unknown>;
} {
  const cmdParams: Array<{ name: string; default?: string }>[] = [] as any;
  const paramValues: Record<string, unknown> = {};
  const argSources = [
    ...(Array.isArray(cmd.arguments) ? (cmd.arguments as Record<string, unknown>[]) : []),
    ...(Array.isArray(cmd.params) ? (cmd.params as Record<string, unknown>[]) : []),
  ];
  for (const arg of argSources) {
    const name = (arg.name as string) || '';
    if (!name) continue;
    (cmdParams as any).push({ name, default: String(arg.defaultValue ?? arg.default ?? '') });
    const vv = arg.validValues as Record<string, unknown> | undefined;
    if (arg.defaultValue != null) paramValues[name] = arg.defaultValue;
    else if (arg.default != null) paramValues[name] = arg.default;
    else if (vv) {
      const vals = vv.values as unknown[];
      if (Array.isArray(vals) && vals.length > 0) paramValues[name] = vals[0];
      else if (typeof vv.min === 'number') paramValues[name] = vv.min;
      else paramValues[name] = 1;
    } else if (arg.type === 'numeric' || arg.type === 'number') paramValues[name] = 1;
    else paramValues[name] = 'TEST';
  }
  return { cmdParams: cmdParams as any, paramValues };
}

function commandToStep(cmd: Record<string, unknown>, idx: number): GeneratorStep {
  const scpi = getScpiString(cmd);
  const isQuery = isQueryCommand(cmd);
  const { cmdParams, paramValues } = buildParamValues(cmd);
  return {
    id: String(idx),
    type: isQuery ? 'query' : 'write',
    label: (cmd.name as string) || `cmd_${idx}`,
    params: {
      command: scpi,
      cmdParams,
      paramValues,
      ...(isQuery ? { saveAs: `result_${idx}` } : {}),
    },
  };
}

describe('Python export validation (all commands → py_compile)', () => {
  const pyCmd = getPythonCommand();

  beforeAll(() => {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  });

  if (!pyCmd) {
    it('skipped — Python not available', () => {
      console.warn('Python not found; skipping py_compile validation');
    });
    return;
  }

  // Test each family as a batch: generate one big script with all commands as steps
  COMMAND_JSON_FILES.forEach((filename) => {
    const familyName = filename.replace(/\.json$/i, '');

    it(`${familyName}: all commands produce valid Python`, () => {
      const fileResult = loadAndValidateCommandFile(filename);
      if (!fileResult.data) throw new Error(`Failed to load ${filename}`);

      const allGroups = getCommandsByGroup(fileResult.data);
      const allCommands: Record<string, unknown>[] = [];
      for (const { commands } of allGroups) {
        for (const cmd of commands) allCommands.push(cmd as Record<string, unknown>);
      }

      expect(allCommands.length).toBeGreaterThan(0);

      // Batch into chunks of 50 to keep scripts reasonable
      const BATCH_SIZE = 50;
      const failures: string[] = [];
      let batchIdx = 0;

      for (let i = 0; i < allCommands.length; i += BATCH_SIZE) {
        const batch = allCommands.slice(i, i + BATCH_SIZE);
        const steps = batch.map((cmd, j) => commandToStep(cmd, i + j));

        let code: string;
        try {
          code = generatePythonFromSteps(steps, baseConfig);
        } catch (e) {
          failures.push(`Batch ${batchIdx} (cmds ${i}-${i + batch.length - 1}): generator threw: ${e}`);
          batchIdx++;
          continue;
        }

        const tempFile = path.join(TEMP_DIR, `${familyName}_batch_${batchIdx}.py`);
        fs.writeFileSync(tempFile, code, 'utf-8');

        try {
          execSync(`${pyCmd} -m py_compile "${tempFile}"`, { stdio: 'pipe' });
        } catch (e: any) {
          const stderr = e.stderr?.toString() || e.message;
          failures.push(`Batch ${batchIdx} (cmds ${i}-${i + batch.length - 1}): py_compile failed: ${stderr.slice(0, 200)}`);
        }
        batchIdx++;
      }

      if (failures.length > 0) {
        throw new Error(
          `${familyName}: ${failures.length}/${batchIdx} batches failed py_compile:\n` +
          failures.join('\n')
        );
      }

      console.log(
        `✓ ${familyName}: ${allCommands.length} commands → ${batchIdx} batches → all pass py_compile`
      );
    });
  });

  // Also test: each command individually generates code and the command string appears in output
  COMMAND_JSON_FILES.forEach((filename) => {
    const familyName = filename.replace(/\.json$/i, '');

    it(`${familyName}: every command header appears in generated Python`, () => {
      const fileResult = loadAndValidateCommandFile(filename);
      if (!fileResult.data) throw new Error(`Failed to load ${filename}`);

      const allGroups = getCommandsByGroup(fileResult.data);
      const missing: string[] = [];
      let total = 0;

      for (const { commands } of allGroups) {
        for (const rawCmd of commands) {
          const cmd = rawCmd as Record<string, unknown>;
          const scpi = getScpiString(cmd);
          if (!scpi) continue;
          total++;

          const step = commandToStep(cmd, total);
          let code: string;
          try {
            code = generatePythonFromSteps([step], baseConfig);
          } catch {
            missing.push(scpi);
            continue;
          }

          // Check the command header appears (strip trailing ? and value portion)
          const header = scpi.replace(/\?$/, '').split(/\s+/)[0];
          if (!code.includes(header) && !/\{[^}]+\}/.test(scpi)) {
            missing.push(scpi);
          }
        }
      }

      if (missing.length > 0) {
        console.warn(
          `${familyName}: ${missing.length}/${total} commands not found in output (first 10):\n` +
          missing.slice(0, 10).join('\n')
        );
      }
      // Allow 0 missing
      expect(missing.length).toBe(0);
    });
  });
});
