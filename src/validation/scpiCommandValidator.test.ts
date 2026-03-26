/**
 * SCPI command JSON validation and generated-code verification.
 * Runs in CI (separate job test:scpi) to ensure command JSON files are valid
 * and that generated Python contains expected SCPI. Results are grouped by
 * device family for the HTML report.
 */
/// <reference types="jest" />

import * as fs from 'fs';
import {
  loadAndValidateCommandFile,
  loadAllCommandFiles,
  validateFileCompleteness,
  getCommandsByGroup,
  COMMANDS_DIR,
  COMMAND_JSON_FILES,
} from './scpiCommandValidator';
import { generatePythonFromSteps } from '../generators/stepToPython';
import type { GeneratorStep } from '../generators/stepToPython';

const baseConfig = {
  backend: 'pyvisa' as const,
  host: '192.168.1.100',
  connectionType: 'tcpip' as const,
  timeout: 5000,
};

/** Display name for device family (filename without .json). */
function deviceFamilyName(filename: string): string {
  return filename.replace(/\.json$/i, '');
}

describe('SCPI command JSON validation', () => {
  it('public/commands directory exists', () => {
    expect(fs.existsSync(COMMANDS_DIR)).toBe(true);
  });

  it('validates structure of each command JSON file', () => {
    const results = loadAllCommandFiles();
    const failed = results.filter((r) => !r.result.valid);
    if (failed.length > 0) {
      const messages = failed.map((r) => `${r.filename}: ${r.result.errors.join('; ')}`).join('\n');
      fail(`Invalid command JSON:\n${messages}`);
    }
    expect(failed.length).toBe(0);
  });

  it('each command file has at least one command/example', () => {
    const results = loadAllCommandFiles();
    const empty = results.filter((r) => (r.result.exampleCount ?? 0) === 0 && (r.result.commandCount ?? 0) === 0);
    if (empty.length > 0) {
      fail(`Files with no commands/examples: ${empty.map((r) => r.filename).join(', ')}`);
    }
    expect(empty.length).toBe(0);
  });

  /** Per-device-family tests so the HTML report groups results by device. */
  describe('By device family', () => {
    const results = loadAllCommandFiles();
    const filesWithExamples = results.filter((r) => r.result.examples && r.result.examples!.length > 0);

    COMMAND_JSON_FILES.forEach((filename) => {
      const entry = results.find((r) => r.filename === filename);
      const familyName = deviceFamilyName(filename);

      describe(`Device family: ${familyName}`, () => {
        it('validates structure and has commands/examples', () => {
          expect(entry).toBeDefined();
          expect(entry!.result.valid).toBe(true);
          expect(entry!.result.errors).toEqual([]);
          const count = (entry!.result.exampleCount ?? 0) + (entry!.result.commandCount ?? 0);
          expect(count).toBeGreaterThan(0);
        });

        it('generated write step contains expected SCPI from first example', () => {
          const fileEntry = filesWithExamples.find((r) => r.filename === filename);
          if (!fileEntry || !fileEntry.result.examples?.length) return;

          const firstExample = fileEntry.result.examples[0];
          const steps: GeneratorStep[] = [
            {
              id: '1',
              type: 'write',
              label: 'From JSON example',
              params: { command: firstExample.scpi },
            },
          ];
          const code = generatePythonFromSteps(steps, baseConfig);
          const escapedInCode = firstExample.scpi.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          expect(code).toContain(escapedInCode);
          expect(code).toContain('scpi.write');
        });
      });
    });
  });

  describe('Generated code matches expected SCPI (query example)', () => {
    it('generated query step contains expected SCPI from tekexpress example', () => {
      const tekexpress = loadAndValidateCommandFile('tekexpress.json');
      expect(tekexpress.valid).toBe(true);
      const queryExample = tekexpress.examples?.find((e) => e.scpi.includes('?'));
      if (!queryExample) return;
      const steps: GeneratorStep[] = [
        {
          id: '1',
          type: 'query',
          params: { command: queryExample.scpi, saveAs: 'result' },
        },
      ];
      const code = generatePythonFromSteps(steps, baseConfig);
      expect(code).toContain(queryExample.scpi);
      expect(code).toContain('scpi.query');
    });
  });

  /** Completeness: every group, every command — Group, Syntax, Set/Query, Arguments (if params in SCPI), Examples. */
  describe('Completeness (every group, every command)', () => {
    const results = loadAllCommandFiles();

    COMMAND_JSON_FILES.forEach((filename) => {
      const entry = results.find((r) => r.filename === filename);
      if (!entry?.result.data) return;

      const familyName = deviceFamilyName(filename);
      const completeness = validateFileCompleteness(entry.result.data, filename);

      describe(`Device family: ${familyName}`, () => {
        it('has at least one group with commands', () => {
          const groups = getCommandsByGroup(entry.result.data);
          expect(groups.length).toBeGreaterThan(0);
          const totalCommands = groups.reduce((sum, g) => sum + g.commands.length, 0);
          expect(totalCommands).toBeGreaterThan(0);
        });

        it('every command is complete (Group, Syntax, Set/Query, Examples; query-only allowed)', () => {
          expect(completeness.totalCommands).toBeGreaterThan(0);
          if (completeness.totalIncomplete > 0) {
            const byGroup = completeness.byGroup
              .filter((g) => g.incomplete.length > 0)
              .map(
                (g) =>
                  `Group "${g.groupName}" (${g.incomplete.length}/${g.total} incomplete): ${g.incomplete
                    .map((c) => `${c.commandId} missing [${c.missing.join(', ')}]`)
                    .join('; ')}`
              )
              .join('\n');
            throw new Error(
              `${filename}: ${completeness.totalIncomplete} of ${completeness.totalCommands} commands incomplete:\n${byGroup}`
            );
          }
          expect(completeness.valid).toBe(true);
          expect(completeness.totalIncomplete).toBe(0);
        });
      });
    });
  });
});
