import { getCommandIndex } from '../core/commandIndex';
import type { ToolResult } from '../core/schemas';
import { serializeCommandResult, serializeCommandCompact } from './commandResultShape';

interface GetCommandByHeaderInput {
  header: string;
  family?: string;
  verbosity?: 'compact' | 'full';
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
  const serialize = input.verbosity === 'full' ? serializeCommandResult : serializeCommandCompact;
  return {
    ok: true,
    data: serialize(entry),
    sourceMeta: [{ file: entry.sourceFile, commandId: entry.commandId, section: entry.group }],
    warnings: [],
  };
}
