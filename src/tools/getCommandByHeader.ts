import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface GetCommandByHeaderInput {
  header: string;
  family?: string;
}

function thinResult(entry: {
  commandId: string;
  sourceFile: string;
  header: string;
  commandType: 'set' | 'query' | 'both';
  shortDescription: string;
  syntax: { set?: string; query?: string };
  codeExamples: Array<{
    scpi?: { code: string };
    python?: { code: string };
    tm_devices?: { code: string };
  }>;
  arguments: Array<{ validValues: Record<string, unknown> }>;
  notes: string[];
}) {
  const ex = entry.codeExamples?.[0];
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: entry.shortDescription,
    syntax: entry.syntax,
    example: ex
      ? {
          scpi: ex.scpi?.code,
          python: ex.python?.code,
          tm_devices: ex.tm_devices?.code,
        }
      : undefined,
    validValues: entry.arguments?.[0]?.validValues || undefined,
    notes: entry.notes?.length ? entry.notes : undefined,
  };
}

export async function getCommandByHeader(
  input: GetCommandByHeaderInput
): Promise<ToolResult<Record<string, unknown> | null>> {
  const header = (input.header || '').trim();
  if (!header) {
    return { ok: false, data: null, sourceMeta: [], warnings: ['Missing header'] };
  }
  const index = await getCommandIndex();
  const entry = index.getByHeader(header, input.family);
  if (!entry) {
    return { ok: false, data: null, sourceMeta: [], warnings: ['No command matched header'] };
  }
  return {
    ok: true,
    data: thinResult(entry),
    sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
    warnings: [],
  };
}
