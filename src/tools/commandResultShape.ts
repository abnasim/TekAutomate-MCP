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

function normalizeScalarValues(values: unknown[] | undefined): Array<string | number | boolean> | undefined {
  if (!Array.isArray(values)) return undefined;
  const filtered = values.filter((v): v is string | number | boolean =>
    ['string', 'number', 'boolean'].includes(typeof v)
  );
  return filtered.length ? filtered : undefined;
}

function syntaxAlreadyCarriesValues(
  syntaxSet: string | undefined,
  values: Array<string | number | boolean> | undefined
): boolean {
  if (!syntaxSet || !values?.length) return false;
  return values.every((value) => syntaxSet.includes(String(value)));
}

function serializeCompactArguments(
  args: CommandArgument[],
  omitFirstArgValidValues = false,
  limit = 8
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(args) || !args.length) return undefined;
  const items = args.slice(0, limit).map((arg, index) => {
    const item: Record<string, unknown> = {
      name: arg.name,
      type: arg.type,
      required: arg.required,
      description: arg.description,
      defaultValue: arg.defaultValue,
    };
    if (!(omitFirstArgValidValues && index === 0)) {
      item.validValues = arg.validValues;
    }
    return item;
  });
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
    header: entry.header,
    type: entry.commandType,
    desc: entry.shortDescription,
    group: entry.group,
  };
}

/** Compact serialization — syntax, args, one example, valid values. No raw/conditions/notes bloat. */
export function serializeCommandCompact(entry: CommandRecord): Record<string, unknown> {
  const firstValidValues = entry.arguments?.[0]?.validValues as Record<string, unknown> | undefined;
  const normalizedValues = normalizeScalarValues(
    (Array.isArray(firstValidValues?.values) ? (firstValidValues.values as unknown[]) : undefined) ||
    (Array.isArray(firstValidValues?.options) ? (firstValidValues.options as unknown[]) : undefined)
  );
  const valuesCoveredBySyntax = syntaxAlreadyCarriesValues(entry.syntax?.set, normalizedValues);

  return {
    header: entry.header,
    commandType: entry.commandType,
    shortDescription: entry.shortDescription,
    syntax: entry.syntax,
    example: entry.codeExamples?.[0]
      ? { description: entry.codeExamples[0].description || undefined, scpi: entry.codeExamples[0].scpi?.code }
      : undefined,
    validValues: valuesCoveredBySyntax ? undefined : normalizedValues,
    arguments: serializeCompactArguments(entry.arguments, valuesCoveredBySyntax),
    relatedCommands: entry.relatedCommands?.length ? entry.relatedCommands.slice(0, 5) : undefined,
  };
}
