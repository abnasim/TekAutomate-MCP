/**
 * Real-world regression: SCPI parameter exposure validation.
 * - Every command JSON validates (identifier + structure).
 * - Commands with {param} or <param> declare parameters (arguments/params).
 * - Missing parameters are detected so generator never sees unresolved placeholders.
 */
/// <reference types="jest" />

import Ajv from 'ajv';
import { getCommandsByGroup } from './scpiCommandValidator';
import { loadAndValidateCommandFile, COMMAND_JSON_FILES } from './scpiCommandValidator';
import { scpiCommandSchema, getCommandString, commandHasDeclaredParameters } from './scpiCommand.schema';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateCommand = ajv.compile(scpiCommandSchema);


describe('SCPI parameter exposure (schema-level)', () => {
  it('every command has an identifier (scpi, command, or header)', () => {
    const errors: string[] = [];
    COMMAND_JSON_FILES.forEach((filename) => {
      const result = loadAndValidateCommandFile(filename);
      if (!result.data) return;
      const groups = getCommandsByGroup(result.data);
      groups.forEach(({ groupName, commands }) => {
        commands.forEach((cmd, idx) => {
          const id = getCommandString(cmd as Record<string, unknown>);
          if (!id || !id.trim()) {
            errors.push(`${filename} > ${groupName} > command[${idx}]: missing scpi/command/header`);
          }
        });
      });
    });
    expect(errors).toEqual([]);
  });

  it('every command passes structure schema (name/command, optional parameters)', () => {
    const errors: string[] = [];
    COMMAND_JSON_FILES.forEach((filename) => {
      const result = loadAndValidateCommandFile(filename);
      if (!result.data) return;
      const groups = getCommandsByGroup(result.data);
      groups.forEach(({ groupName, commands }) => {
        commands.forEach((cmd, idx) => {
          const valid = validateCommand(cmd);
          if (!valid && validateCommand.errors) {
            const msg = validateCommand.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ');
            errors.push(`${filename} > ${groupName} > [${idx}]: ${msg}`);
          }
        });
      });
    });
    expect(errors).toEqual([]);
  });

  it('commands with {param} placeholders declare arguments or params', () => {
    const errors: string[] = [];
    COMMAND_JSON_FILES.forEach((filename) => {
      const result = loadAndValidateCommandFile(filename);
      if (!result.data) return;
      const groups = getCommandsByGroup(result.data);
      groups.forEach(({ groupName, commands }) => {
        commands.forEach((cmd) => {
          const c = cmd as Record<string, unknown>;
          if (!commandHasDeclaredParameters(c)) {
            const scpi = getCommandString(c);
            // Only flag {param} that appears after a space (argument position).
            // {A|B|C} embedded in the colon-separated path are alternative
            // mnemonic choices, not user-settable argument values.
            if (/\s\{[^}]+\}/.test(scpi)) {
              errors.push(`${filename} > ${groupName} > "${scpi.slice(0, 50)}...": has {param} but no arguments/params`);
            }
          }
        });
      });
    });
    expect(errors).toEqual([]);
  });
});
