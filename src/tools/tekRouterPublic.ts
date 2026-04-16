import { browseScpiCommands } from './browseScpiCommands';
import { getCommandByHeader } from './getCommandByHeader';
import { searchScpi } from './searchScpi';
import { verifyScpiCommands } from './verifyScpiCommands';

interface TekRouterPublicInput extends Record<string, unknown> {
  action?: string;
  args?: Record<string, unknown>;
  modelFamily?: string;
  query?: string;
}

function mergeArgs(input: TekRouterPublicInput): Record<string, unknown> {
  const nested = input.args && typeof input.args === 'object' ? input.args : {};
  const merged = { ...nested, ...input };
  delete (merged as Record<string, unknown>).args;
  return merged as Record<string, unknown>;
}

export async function tekRouterPublic(input: TekRouterPublicInput) {
  const action = String(input.action || '').trim().toLowerCase();
  const args = mergeArgs(input);
  delete args.action;

  switch (action) {
    case 'search': {
      const query = String(args.query || input.query || '').trim();
      return searchScpi({
        ...(args as any),
        query,
        modelFamily: String(args.modelFamily || input.modelFamily || ''),
      });
    }
    case 'lookup': {
      const header = String(args.header || '').trim();
      return getCommandByHeader({
        ...(args as any),
        header,
        family: String(args.family || args.modelFamily || input.modelFamily || ''),
      });
    }
    case 'browse':
      return browseScpiCommands({
        ...(args as any),
        modelFamily: String(args.modelFamily || input.modelFamily || ''),
      });
    case 'verify':
      return verifyScpiCommands({
        ...(args as any),
        modelFamily: String(args.modelFamily || input.modelFamily || ''),
      });
    default:
      return null;
  }
}
