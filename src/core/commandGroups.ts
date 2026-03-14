import rawGroups from './commandGroups.json';

export interface CommandGroupInfo {
  description: string;
  commands: string[];
}

export const COMMAND_GROUPS = rawGroups as Record<string, CommandGroupInfo>;

export const GROUP_NAMES = Object.keys(COMMAND_GROUPS).sort();

export const GROUP_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(COMMAND_GROUPS).map(([name, info]) => [name, info.description || ''])
);

export const GROUP_COMMANDS: Record<string, string[]> = Object.fromEntries(
  Object.entries(COMMAND_GROUPS).map(([name, info]) => [name, Array.isArray(info.commands) ? info.commands : []])
);

export function resolveCommandGroupName(input: string): string | null {
  const query = input.trim();
  if (!query) return null;
  const direct = GROUP_NAMES.find((name) => name === query);
  if (direct) return direct;
  const lower = query.toLowerCase();
  return GROUP_NAMES.find((name) => name.toLowerCase() === lower) || null;
}

