type TmEntry = {
  model: string;
  path: string;
  description?: string;
  usage?: string[];
  scpiSyntax?: string;
};

const tmCache: { loaded: boolean; entries: TmEntry[] } = {
  loaded: false,
  entries: [],
};

async function loadTmEntries(): Promise<void> {
  if (tmCache.loaded) return;
  let data: Record<string, Record<string, any>> = {};
  try {
    const res = await fetch('/commands/tm_devices_docstrings.json');
    if (res.ok) {
      const raw = await res.text();
      const trimmed = raw.trim();
      if (trimmed && !trimmed.startsWith('<!DOCTYPE') && !trimmed.startsWith('<html')) {
        data = JSON.parse(raw) as Record<string, Record<string, any>>;
      }
    }
  } catch {
    data = {};
  }

  const entries: TmEntry[] = [];
  for (const [model, tree] of Object.entries(data || {})) {
    for (const value of Object.values(tree || {})) {
      if (value && typeof value === 'object' && value.path) {
        entries.push({
          model,
          path: value.path as string,
          description: value.description,
          usage: Array.isArray(value.usage) ? value.usage : undefined,
          scpiSyntax: value.scpiSyntax,
        });
      }
    }
  }

  tmCache.entries = entries;
  tmCache.loaded = true;
}

function scoreEntry(entry: TmEntry, terms: string[], modelFamily?: string): number {
  let score = 0;
  const text = (
    [entry.model, entry.path, entry.description, entry.scpiSyntax]
      .concat(entry.usage || [])
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  );

  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }

  if (modelFamily && entry.model.toLowerCase().includes(modelFamily.toLowerCase())) {
    score += 2;
  }

  return score;
}

export async function searchTmCommands(
  query: string,
  modelFamily?: string,
  topN = 5
): Promise<Array<{ path: string; model: string; description?: string; usage?: string[]; scpiSyntax?: string }>> {
  await loadTmEntries();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  return tmCache.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms, modelFamily) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ entry }) => entry);
}

