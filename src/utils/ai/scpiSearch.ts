const libraries: Record<string, any[]> = {};
const FALLBACK_COMMAND_FILES = [
  '/commands/dpojet.json',
  '/commands/awg.json',
  '/commands/smu.json',
  '/commands/rsa.json',
  '/commands/tekexpress.json',
  '/commands/afg.json',
];

async function fetchJsonSafe(path: string): Promise<any | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const raw = await res.text();
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadCommandLibrary(modelFamily: string): Promise<any[]> {
  const isMSO2 = /MSO2|2\s*[Ss]eries|2Series/.test(modelFamily || '');
  const isDPO  = /DPO|dpo|5k|7k|70k/.test(modelFamily || '');
  const file = isMSO2
    ? '/commands/mso2.json'
    : isDPO
      ? '/commands/MSO_DPO_5k_7k_70K.json'
      : '/commands/mso_4_5_6_7.json';

  if (!libraries[file]) {
    const collected: any[] = [];
    const data = await fetchJsonSafe(file);
    if (data?.groups && typeof data.groups === 'object') {
      collected.push(...Object.values(data.groups || {}).flatMap((g: any) => g.commands || []));
    }
    for (const fallbackFile of FALLBACK_COMMAND_FILES) {
      const fallback = await fetchJsonSafe(fallbackFile);
      if (fallback?.groups && typeof fallback.groups === 'object') {
        collected.push(...Object.values(fallback.groups || {}).flatMap((g: any) => g.commands || []));
      }
    }
    libraries[file] = collected;
  }
  return libraries[file];
}

export async function searchCommands(
  query: string,
  modelFamily: string,
  deviceType?: string,
  topN = 10
): Promise<any[]> {
  const commands = await loadCommandLibrary(modelFamily);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const detectGroup = (msg: string): string | null => {
    const m = msg.toLowerCase();
    if (/i2c|spi|uart|can|lin|bus decode/.test(m)) return 'Bus';
    if (/trigger|edge|slope|holdoff/.test(m)) return 'Trigger';
    if (/afg|function gen/.test(m)) return 'AFG';
    if (/smu|source measure/.test(m)) return 'SMU';
    return null;
  };
  const groupHint = detectGroup(query);
  const mentionsEthercat = /ethercat/i.test(query);

  const scored = commands
    .map((cmd: any) => {
      const text = [
        cmd.scpi,
        cmd.shortDescription,
        cmd.description,
        cmd.group,
        cmd._manualEntry?.syntax?.set,
        cmd._manualEntry?.syntax?.query,
        ...(cmd._manualEntry?.examples || []).map((e: any) => e?.codeExamples?.scpi?.code),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
      return { cmd, score };
    })
    .filter((x: any) => x.score > 0)
    .filter((x: any) => {
      if (!groupHint) return true;
      const g = String(x.cmd.group || '').toLowerCase();
      return g === groupHint.toLowerCase();
    });

  // If group filter yielded nothing, fall back to unfiltered matches
  const filtered = scored.length ? scored : commands
    .map((cmd: any) => {
      const text = [
        cmd.scpi,
        cmd.shortDescription,
        cmd.description,
        cmd.group,
        cmd._manualEntry?.syntax?.set,
        cmd._manualEntry?.syntax?.query,
        ...(cmd._manualEntry?.examples || []).map((e: any) => e?.codeExamples?.scpi?.code),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
      return { cmd, score };
    })
    .filter((x: any) => x.score > 0);

  const cleaned = filtered
    // Avoid Ethernet/Ethercat false positives unless user asked
    .filter((x: any) => mentionsEthercat || !/ethercat/i.test(String(x.cmd.scpi || x.cmd.header || '')))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, topN)
    .map((x: any) => x.cmd._manualEntry || x.cmd);

  return cleaned;
}
