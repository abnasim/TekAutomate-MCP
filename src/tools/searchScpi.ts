import { getCommandIndex, type CommandType } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';

interface SearchScpiInput {
  query: string;
  modelFamily?: string;
  limit?: number;
  commandType?: CommandType;
}

function thinResult(entry: {
  commandId: string;
  sourceFile: string;
  header: string;
  commandType: CommandType;
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

export async function searchScpi(input: SearchScpiInput): Promise<ToolResult<unknown[]>> {
  const q = (input.query || '').trim();
  if (!q) {
    return { ok: true, data: [], sourceMeta: [], warnings: ['Empty query'] };
  }
  const index = await getCommandIndex();
  const entries = index.searchByQuery(q, input.modelFamily, input.limit || 10, input.commandType);
  return {
    ok: true,
    data: entries.map((e) => thinResult(e)),
    sourceMeta: entries.map((e) => ({
      file: e.sourceFile,
      commandId: e.commandId,
      section: e.group,
    })),
    warnings: entries.length ? [] : ['No commands matched query'],
  };
}
