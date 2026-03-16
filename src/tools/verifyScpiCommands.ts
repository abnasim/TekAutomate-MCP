import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface VerifyScpiInput {
  commands: string[];
  modelFamily?: string;
}

function parseSegments(command: string): string[] {
  return command
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function headerFromSegment(segment: string): string {
  return segment.split(/\s+/).slice(0, 1).join(' ').trim();
}

export async function verifyScpiCommands(
  input: VerifyScpiInput
): Promise<ToolResult<unknown[]>> {
  const index = await getCommandIndex();
  const commands = Array.isArray(input.commands) ? input.commands : [];
  const results: Array<{
    command: string;
    verified: boolean;
    commandId?: string;
    sourceFile?: string;
    reason?: string;
  }> = [];
  const sourceMeta: ToolResult['sourceMeta'] = [];
  const warnings: string[] = [];
  let unverifiedCount = 0;
  for (const command of commands) {
    const segments = parseSegments(command);
    if (!segments.length) {
      results.push({ command, verified: false, reason: 'Empty command' });
      warnings.push(`Invalid command: ${command}`);
      continue;
    }
    let failed = false;
    let firstMatch: { commandId: string; sourceFile: string } | null = null;
    for (const segment of segments) {
      const candidate = headerFromSegment(segment);
      const entry =
        index.getByHeader(candidate, input.modelFamily) ||
        index.getByHeader(candidate.toUpperCase(), input.modelFamily) ||
        index.getByHeader(candidate.toLowerCase(), input.modelFamily) ||
        index.getByHeaderPrefix(candidate, input.modelFamily);
      if (!entry) {
        failed = true;
        break;
      }
      if (!firstMatch) {
        firstMatch = { commandId: entry.commandId, sourceFile: entry.sourceFile };
      }
      sourceMeta.push({ file: entry.sourceFile, commandId: entry.commandId, section: entry.group });
    }
    if (failed || !firstMatch) {
      results.push({
        command,
        verified: false,
        commandId: undefined,
        sourceFile: undefined,
        reason: 'I could not verify this command in the uploaded sources.',
      });
      unverifiedCount += 1;
      continue;
    }
    results.push({
      command,
      verified: true,
      commandId: firstMatch.commandId,
      sourceFile: firstMatch.sourceFile,
    });
  }
  if (unverifiedCount > 0) {
    warnings.push(`${unverifiedCount} of ${commands.length} commands could not be verified`);
  }
  return {
    ok: true,
    data: results,
    sourceMeta,
    warnings,
  };
}
