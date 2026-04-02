import type {
  CommandArgument,
  CommandCodeExample,
  CommandRecord,
  ManualReference,
} from '../core/commandIndex';

function normalizeConditions(raw: Record<string, unknown>): string[] | undefined {
  const manual = raw._manualEntry as Record<string, unknown> | undefined;
  const value = manual?.conditions ?? raw.conditions;
  if (!value) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  return undefined;
}

function serializeArguments(args: CommandArgument[], limit = 8): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(args) || !args.length) return undefined;
  const items = args.slice(0, limit).map((arg) => ({
    name: arg.name,
    type: arg.type,
    required: arg.required,
    description: arg.description,
    defaultValue: arg.defaultValue,
    validValues: arg.validValues,
  }));
  return items.length ? items : undefined;
}

function serializeExamples(examples: CommandCodeExample[], limit = 4): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(examples) || !examples.length) return undefined;
  const items = examples.slice(0, limit).map((example) => ({
    description: example.description || undefined,
    scpi: example.scpi?.code,
    python: example.python?.code,
    tm_devices: example.tm_devices?.code,
  }));
  return items.length ? items : undefined;
}

function serializeManualReference(reference?: ManualReference): Record<string, unknown> | undefined {
  if (!reference) return undefined;
  const out: Record<string, unknown> = {};
  if (reference.section) out.section = reference.section;
  if (typeof reference.page === 'number') out.page = reference.page;
  return Object.keys(out).length ? out : undefined;
}

export function serializeCommandResult(entry: CommandRecord): Record<string, unknown> {
  const firstValidValues = entry.arguments?.[0]?.validValues as Record<string, unknown> | undefined;
  const normalizedValues =
    (Array.isArray(firstValidValues?.values) ? (firstValidValues.values as unknown[]) : undefined) ||
    (Array.isArray(firstValidValues?.options) ? (firstValidValues.options as unknown[]) : undefined);

  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    group: entry.group,
    category: entry.category,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: entry.shortDescription,
    description: entry.description || undefined,
    syntax: entry.syntax,
    queryResponse: entry.queryResponse || undefined,
    example: entry.codeExamples?.[0]
      ? {
          description: entry.codeExamples[0].description || undefined,
          scpi: entry.codeExamples[0].scpi?.code,
          python: entry.codeExamples[0].python?.code,
          tm_devices: entry.codeExamples[0].tm_devices?.code,
        }
      : undefined,
    examples: serializeExamples(entry.codeExamples),
    validValues: normalizedValues
      ? normalizedValues.filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v))
      : undefined,
    validValuesRaw: firstValidValues,
    arguments: serializeArguments(entry.arguments),
    relatedCommands: entry.relatedCommands?.length ? entry.relatedCommands : undefined,
    notes: entry.notes?.length ? entry.notes : undefined,
    manualReference: serializeManualReference(entry.manualReference),
    conditions: normalizeConditions(entry.raw),
  };
}

export function serializeCommandSearchResult(entry: CommandRecord): Record<string, unknown> {
  return {
    commandId: entry.commandId,
    sourceFile: entry.sourceFile,
    group: entry.group,
    category: entry.category,
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: entry.shortDescription,
    manualReference: serializeManualReference(entry.manualReference),
    hasSyntax: Boolean(entry.syntax?.set || entry.syntax?.query),
    hasArguments: Array.isArray(entry.arguments) && entry.arguments.length > 0,
    hasExamples: Array.isArray(entry.codeExamples) && entry.codeExamples.length > 0,
    lookupHint: {
      tool: 'get_command_by_header',
      header: entry.header,
    },
  };
}
