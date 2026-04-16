/**
 * JSON Schema for SCPI command parameter exposure.
 * Validates that each command has declared identity (scpi/command), and that
 * parameters are properly declared when the command has placeholders.
 */

/** Schema for a single parameter (argument) in a command. */
export const parameterSchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    type: { type: 'string' },
    required: { type: 'boolean' },
    position: { type: 'number' },
    description: { type: 'string' },
    defaultValue: {},
    validValues: { type: 'object' },
  },
  additionalProperties: true,
};

/**
 * Schema for one SCPI command object.
 * Supports both formats: scpi/header (groups) and command (commands_by_section).
 * Requires: an identifier (scpi, command, or header). If command string contains
 * {param} or <param>, parameters (arguments or params) should be declared.
 */
export const scpiCommandSchema = {
  type: 'object',
  required: [],
  properties: {
    name: { type: 'string' },
    id: { type: 'string' },
    scpi: { type: 'string' },
    command: { type: 'string' },
    header: { type: 'string' },
    commandType: { type: 'string', enum: ['set', 'query', 'both'] },
    description: { type: 'string' },
    shortDescription: { type: 'string' },
    arguments: {
      oneOf: [
        { type: 'array', items: parameterSchema },
        { type: 'string' },
        { type: 'null' },
      ],
    },
    params: {
      type: 'array',
      items: parameterSchema,
    },
    syntax: {},
    examples: {},
    codeExamples: { type: 'array' },
    example: {},
  },
  additionalProperties: true,
};

/** Get the command string from a command object (any schema). */
export function getCommandString(cmd: Record<string, unknown>): string {
  const s = (cmd.scpi || cmd.command || cmd.header) as string | undefined;
  return typeof s === 'string' ? s : '';
}

/** Check if command string has curly-brace parameter placeholders (e.g. {scale}). */
export function hasParameterPlaceholders(commandStr: string): boolean {
  return /\{[^}]+\}/.test(commandStr);
}

/** Validate that parameters are declared when placeholders exist. */
export function commandHasDeclaredParameters(cmd: Record<string, unknown>): boolean {
  const commandStr = getCommandString(cmd);
  if (!hasParameterPlaceholders(commandStr)) return true;
  const args = cmd.arguments;
  const params = cmd.params;
  return (Array.isArray(args) && args.length > 0) || (Array.isArray(params) && params.length > 0);
}
