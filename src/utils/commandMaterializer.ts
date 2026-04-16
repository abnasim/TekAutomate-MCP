export type CommandIntent = 'write' | 'query';

export type CommandParamLike = {
  name?: string;
  type?: string;
  default?: any;
  options?: string[];
};

export type CommandLike = {
  scpi: string;
  params?: CommandParamLike[];
  manualEntry?: { commandType?: string; syntax?: { set?: string; query?: string } };
  _manualEntry?: { commandType?: string; syntax?: { set?: string; query?: string } };
};

export type ResolveMode = 'auto' | 'prefer_write' | 'prefer_query';

function normalizeCommandType(raw?: string): 'set' | 'query' | 'both' | 'unknown' {
  const value = (raw || '').toLowerCase().trim();
  if (value === 'set' || value === 'write') return 'set';
  if (value === 'query') return 'query';
  if (value === 'both') return 'both';
  return 'unknown';
}

function getConcreteParamValue(param?: CommandParamLike): string {
  if (!param) return '1';
  const options: string[] = Array.isArray(param.options) ? param.options : [];
  const concreteOption = options.find((opt) => {
    const v = String(opt || '').trim();
    return v && !/<[^>]+>/.test(v) && !/[{}|]/.test(v);
  });
  if (concreteOption) return String(concreteOption).trim();

  if (param.default !== undefined && param.default !== null) {
    const d = String(param.default).trim();
    if (d && !/<[^>]+>/.test(d)) return d;
  }

  const t = String(param.type || '').toLowerCase();
  if (t.includes('bool')) return 'ON';
  if (t.includes('int') || t.includes('number') || t.includes('float') || t.includes('numeric')) return '1';
  return '1';
}

function ensureQueryHeader(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  if (trimmed.endsWith('?')) return trimmed;
  const header = trimmed.split(/\s+/)[0];
  return `${header}?`;
}

function stripQuerySuffix(command: string): string {
  return command.trim().replace(/\?$/, '');
}

export function materializeCommandTemplate(scpiTemplate: string, params: CommandParamLike[] = []): string {
  let out = (scpiTemplate || '').trim();
  let paramIdx = 0;

  out = out.replace(/\{([^}]+)\}/g, (_m, inner) => {
    const choices = String(inner).split('|').map((s) => s.trim()).filter(Boolean);
    if (choices.length > 1) {
      const concreteChoice = choices.find((opt) => !/<[^>]+>/.test(opt) && !/[{}]/.test(opt));
      if (concreteChoice) return concreteChoice;
    }
    return getConcreteParamValue(params[paramIdx++]);
  });

  out = out.replace(/<[^>]+>/g, (token) => {
    if (/^<x>$/i.test(token)) return '1';
    return getConcreteParamValue(params[paramIdx++]);
  });

  return out.replace(/\s+/g, ' ').trim();
}

export function resolveCommandSelection(
  cmd: CommandLike,
  mode: ResolveMode = 'auto'
): { command: string; intent: CommandIntent } {
  const syntax = cmd.manualEntry?.syntax || cmd._manualEntry?.syntax;
  const commandType = normalizeCommandType(cmd.manualEntry?.commandType || cmd._manualEntry?.commandType);

  const scpiMaterialized = materializeCommandTemplate(cmd.scpi, cmd.params || []);
  const scpiHasConcreteArg = /\s+/.test(scpiMaterialized) && !/[<{]/.test(scpiMaterialized);
  const setTemplate = scpiHasConcreteArg ? scpiMaterialized : (syntax?.set || cmd.scpi);
  let setCandidate = materializeCommandTemplate(setTemplate, cmd.params || []);
  if (!/\s+/.test(setCandidate) && Array.isArray(cmd.params) && cmd.params.length > 0) {
    const valueParam =
      cmd.params.find((p) => String(p.name || '').toLowerCase() === 'value') || cmd.params[0];
    const value = getConcreteParamValue(valueParam);
    if (value) {
      setCandidate = `${setCandidate} ${value}`.replace(/\s+/g, ' ').trim();
    }
  }
  const queryCandidate = ensureQueryHeader(syntax?.query || cmd.scpi);

  if (mode === 'prefer_query') {
    if (commandType === 'set') {
      return { command: stripQuerySuffix(setCandidate), intent: 'write' };
    }
    return { command: queryCandidate, intent: 'query' };
  }

  if (mode === 'prefer_write') {
    if (commandType === 'query') {
      return { command: queryCandidate, intent: 'query' };
    }
    return { command: stripQuerySuffix(setCandidate), intent: 'write' };
  }

  // auto
  if (commandType === 'query') {
    return { command: queryCandidate, intent: 'query' };
  }
  if (commandType === 'both' || commandType === 'set') {
    return { command: stripQuerySuffix(setCandidate), intent: 'write' };
  }

  const materialized = materializeCommandTemplate(cmd.scpi, cmd.params || []);
  if (materialized.endsWith('?')) {
    return { command: ensureQueryHeader(materialized), intent: 'query' };
  }
  return { command: stripQuerySuffix(materialized), intent: 'write' };
}
