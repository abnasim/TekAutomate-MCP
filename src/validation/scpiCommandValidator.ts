/**
 * SCPI command JSON validation for CI.
 * Validates command JSON files in public/commands and extracts expected SCPI
 * examples so generated code can be verified against them.
 */

import * as fs from 'fs';
import * as path from 'path';

export const COMMANDS_DIR = path.join(process.cwd(), 'public', 'commands');

/** Files to validate (exclude non-command formats). */
export const COMMAND_JSON_FILES = [
  'tekexpress.json',
  'dpojet.json',
  'afg.json',
  'awg.json',
  'smu.json',
  'MSO_DPO_5k_7k_70K.json',
  'mso2.json',
  'mso_4_5_6_7.json',
  'rsa.json',
];
/** Skip these in CI (large or different schema). */
export const SKIP_FILES = ['tm_devices_full_tree.json', 'tm_devices_docstrings.json'];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  file: string;
  commandCount?: number;
  exampleCount?: number;
}

/** Result of completeness check for a single command. */
export interface CommandCompleteness {
  commandId: string;
  missing: string[];
  complete: boolean;
}

/** Per-group completeness result. */
export interface GroupCompleteness {
  groupName: string;
  total: number;
  incomplete: CommandCompleteness[];
}

/** Full completeness result for a file (every group, every command). */
export interface FileCompletenessResult {
  valid: boolean;
  file: string;
  byGroup: GroupCompleteness[];
  totalCommands: number;
  totalIncomplete: number;
  errors: string[];
}

/** Required fields for a "full complete" command: Group, Syntax, Set/Query, Examples. Arguments optional (many commands have no params). */

/**
 * Extract expected SCPI example string from a command entry.
 * Handles: .example, .codeExamples[].codeExamples.scpi.code, .examples[].scpi, .examples[].codeExamples.scpi.code
 */
export function getExampleScpiFromCommand(cmd: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof cmd.example === 'string' && cmd.example.trim()) {
    out.push((cmd.example as string).trim());
  }
  const codeExamples = cmd.codeExamples as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(codeExamples)) {
    codeExamples.forEach((ex) => {
      const scpi = (ex?.codeExamples as Record<string, unknown>)?.scpi as Record<string, unknown> | undefined;
      const code = typeof scpi?.code === 'string' ? (scpi.code as string).trim() : '';
      if (code) out.push(code);
    });
  }
  const examples = cmd.examples as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(examples)) {
    examples.forEach((ex) => {
      if (typeof ex.scpi === 'string' && (ex.scpi as string).trim()) {
        out.push((ex.scpi as string).trim());
      }
      const scpi = (ex?.codeExamples as Record<string, unknown>)?.scpi as Record<string, unknown> | undefined;
      const code = typeof scpi?.code === 'string' ? (scpi.code as string).trim() : '';
      if (code) out.push(code);
    });
  }
  return Array.from(new Set(out));
}

/**
 * Validate file structure and extract all expected SCPI examples.
 */
export function validateAndGetExamples(
  data: unknown,
  filename: string
): { valid: boolean; errors: string[]; examples: { scpi: string; source: string }[] } {
  const errors: string[] = [];
  const examples: { scpi: string; source: string }[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Invalid JSON: not an object'], examples: [] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.commands_by_section && typeof obj.commands_by_section === 'object') {
    const sections = obj.commands_by_section as Record<string, unknown[]>;
    let commandCount = 0;
    Object.entries(sections).forEach(([sectionName, sectionCommands]) => {
      if (!Array.isArray(sectionCommands)) return;
      sectionCommands.forEach((cmd: Record<string, unknown>) => {
        commandCount++;
        const scpiCmd = cmd.command as string | undefined;
        if (scpiCmd && typeof scpiCmd === 'string') {
          const exs = getExampleScpiFromCommand(cmd);
          if (exs.length > 0) {
            exs.forEach((scpi) => examples.push({ scpi, source: `${filename} > ${sectionName}` }));
          } else {
            examples.push({ scpi: scpiCmd.trim(), source: `${filename} > ${sectionName}` });
          }
        }
      });
    });
    if (commandCount === 0) errors.push('commands_by_section has no valid commands');
  } else if (obj.groups && typeof obj.groups === 'object') {
    const groups = obj.groups as Record<string, Record<string, unknown>>;
    let commandCount = 0;
    Object.entries(groups).forEach(([groupName, groupData]) => {
      const commands = groupData?.commands as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(commands)) return;
      commands.forEach((cmd) => {
        commandCount++;
        const scpiCmd = (cmd.scpi || cmd.header) as string | undefined;
        if (scpiCmd && typeof scpiCmd === 'string') {
          const exs = getExampleScpiFromCommand(cmd);
          if (exs.length > 0) {
            exs.forEach((scpi) => examples.push({ scpi, source: `${filename} > ${groupName}` }));
          } else {
            examples.push({ scpi: scpiCmd.trim(), source: `${filename} > ${groupName}` });
          }
        }
      });
    });
    if (commandCount === 0) errors.push('groups have no valid commands');
  } else {
    errors.push('Missing commands_by_section or groups');
  }

  return {
    valid: errors.length === 0,
    errors,
    examples,
  };
}

/**
 * Load and validate a single command JSON file.
 */
export function loadAndValidateCommandFile(filename: string): ValidationResult & { data?: unknown; examples?: { scpi: string; source: string }[] } {
  const filePath = path.join(COMMANDS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`File not found: ${filePath}`], file: filename };
  }
  let data: unknown;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`],
      file: filename,
    };
  }
  const { valid, errors, examples } = validateAndGetExamples(data, filename);
  return {
    valid,
    errors,
    file: filename,
    commandCount: examples.length,
    exampleCount: examples.length,
    data,
    examples,
  };
}

/**
 * Get all groups and their commands from a file (supports commands_by_section and groups schemas).
 */
export function getCommandsByGroup(
  data: unknown
): Array<{ groupName: string; commands: Record<string, unknown>[] }> {
  const out: Array<{ groupName: string; commands: Record<string, unknown>[] }> = [];
  if (!data || typeof data !== 'object') return out;
  const obj = data as Record<string, unknown>;

  if (obj.commands_by_section && typeof obj.commands_by_section === 'object') {
    const sections = obj.commands_by_section as Record<string, unknown[]>;
    Object.entries(sections).forEach(([sectionName, sectionCommands]) => {
      if (!Array.isArray(sectionCommands)) return;
      out.push({ groupName: sectionName, commands: sectionCommands as Record<string, unknown>[] });
    });
  } else if (obj.groups && typeof obj.groups === 'object') {
    const groups = obj.groups as Record<string, Record<string, unknown>>;
    Object.entries(groups).forEach(([groupName, groupData]) => {
      const commands = groupData?.commands as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(commands)) return;
      out.push({ groupName, commands });
    });
  }
  return out;
}

/**
 * Get a short identifier for a command (for error messages).
 */
function getCommandId(cmd: Record<string, unknown>, fallbackGroup: string): string {
  const scpi = (cmd.scpi || cmd.command || cmd.header) as string | undefined;
  if (typeof scpi === 'string' && scpi.trim()) return scpi.trim().slice(0, 60);
  const name = cmd.name as string | undefined;
  if (typeof name === 'string') return name;
  return (cmd.id as string) || fallbackGroup;
}

/**
 * Check a single command for completeness: Group, Syntax, Set/Query, Arguments, Examples.
 * Handles both rich schema (syntax.set/query, commandType, arguments, codeExamples) and
 * minimal schema (example only).
 */
export function checkCommandCompleteness(
  cmd: Record<string, unknown>,
  groupName: string
): CommandCompleteness {
  const missing: string[] = [];
  const id = getCommandId(cmd, groupName);

  // Group: we always have it when iterating by group
  // (no check needed)

  // Syntax: syntax object { set, query }, syntax array, _manualEntry.syntax, or at least SCPI string
  const syntax = cmd.syntax;
  const manualSyntax = (cmd._manualEntry as Record<string, unknown>)?.syntax;
  const scpiStr = (cmd.scpi || cmd.command || cmd.header) as string | undefined;
  const hasSyntax =
    (syntax && (typeof syntax === 'object' || Array.isArray(syntax))) ||
    (manualSyntax && typeof manualSyntax === 'object') ||
    (typeof scpiStr === 'string' && scpiStr.trim().length > 0);
  if (!hasSyntax) missing.push('Syntax');

  // Set/Query: commandType or hasSet/hasQuery, or infer from scpi (query ends with ?)
  const hasSetQuery =
    typeof cmd.commandType === 'string' ||
    (typeof cmd.hasSet === 'boolean' || typeof cmd.hasQuery === 'boolean') ||
    (typeof scpiStr === 'string' && scpiStr.length > 0);
  if (!hasSetQuery) missing.push('SetAndQuery');

  // Arguments: optional; commands with no parameters may omit. If SCPI has params, recommend defining arguments/params.
  const args = cmd.arguments;
  const params = cmd.params;
  const hasArgs =
    (args !== undefined && args !== null) ||
    (params !== undefined && Array.isArray(params));
  const hasParamPlaceholder = typeof scpiStr === 'string' && (scpiStr.includes('{') || scpiStr.includes('<'));
  if (hasParamPlaceholder && !hasArgs) missing.push('Arguments');

  // Examples: example (string), examples[] or codeExamples[]. Query-only/set-only/both can use SCPI string as minimal example.
  const hasExample =
    (typeof cmd.example === 'string' && cmd.example.trim().length > 0) ||
    (Array.isArray(cmd.examples) && cmd.examples.length > 0) ||
    (Array.isArray(cmd.codeExamples) && cmd.codeExamples.length > 0) ||
    (typeof scpiStr === 'string' && scpiStr.trim().length > 0);
  if (!hasExample) missing.push('Examples');

  return {
    commandId: id,
    missing,
    complete: missing.length === 0,
  };
}

/**
 * Validate every group and every command for completeness.
 * Returns per-group results and overall valid (no incomplete commands).
 */
export function validateFileCompleteness(
  data: unknown,
  filename: string
): FileCompletenessResult {
  const byGroup: GroupCompleteness[] = [];
  const errors: string[] = [];
  let totalCommands = 0;
  let totalIncomplete = 0;

  const groupsWithCommands = getCommandsByGroup(data);
  if (groupsWithCommands.length === 0) {
    return {
      valid: false,
      file: filename,
      byGroup: [],
      totalCommands: 0,
      totalIncomplete: 0,
      errors: ['No groups or commands_by_section found'],
    };
  }

  groupsWithCommands.forEach(({ groupName, commands }) => {
    const incomplete: CommandCompleteness[] = [];
    commands.forEach((cmd) => {
      totalCommands++;
      const comp = checkCommandCompleteness(cmd as Record<string, unknown>, groupName);
      if (!comp.complete) {
        totalIncomplete++;
        incomplete.push(comp);
      }
    });
    byGroup.push({ groupName, total: commands.length, incomplete });
  });

  if (totalIncomplete > 0) {
    byGroup.forEach((g) => {
      if (g.incomplete.length > 0) {
        g.incomplete.forEach((c) => {
          errors.push(`[${filename}] Group "${g.groupName}": command "${c.commandId}" missing: ${c.missing.join(', ')}`);
        });
      }
    });
  }

  return {
    valid: totalIncomplete === 0,
    file: filename,
    byGroup,
    totalCommands,
    totalIncomplete,
    errors,
  };
}

/**
 * Load all command files that we intend to validate (excluding skip list).
 */
export function loadAllCommandFiles(): Array<{ filename: string; result: ReturnType<typeof loadAndValidateCommandFile> }> {
  const files = COMMAND_JSON_FILES.filter((f) => !SKIP_FILES.includes(f));
  return files.map((filename) => ({ filename, result: loadAndValidateCommandFile(filename) }));
}
