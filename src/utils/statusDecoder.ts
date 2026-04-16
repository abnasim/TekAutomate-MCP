const ESR_BIT_MEANINGS: Record<number, string> = {
  0: 'OPC: Operation complete',
  2: 'QYE: Query error',
  3: 'DDE: Device-dependent error',
  4: 'EXE: Execution error/warning',
  5: 'CME: Command error',
  6: 'URQ: User request',
  7: 'PON: Power on',
};

const EVENT_CODE_MEANINGS: Record<number, string> = {
  0: 'No events to report; queue empty',
  1: 'No events to report; new events pending *ESR?',
  100: 'Command error',
  101: 'Invalid character',
  102: 'Syntax error',
  103: 'Invalid separator',
  104: 'Data type error',
  108: 'Parameter not allowed',
  109: 'Missing parameter',
  110: 'Command header error',
  113: 'Undefined header',
  200: 'Execution error',
  221: 'Settings conflict',
  222: 'Data out of range',
  224: 'Illegal parameter value',
  310: 'System error',
  311: 'Memory error',
  400: 'Query event',
  401: 'Power on (PON bit set)',
  402: 'Operation complete (OPC bit set)',
  410: 'Query INTERRUPTED',
  420: 'Query UNTERMINATED',
  430: 'Query DEADLOCKED',
  440: 'Query UNTERMINATED after indefinite response',
  528: 'Parameter out of range',
  540: 'Measurement warning',
  541: 'Measurement warning, low signal amplitude',
  542: 'Measurement warning, unstable histogram',
  543: 'Measurement warning, low resolution',
  544: 'Measurement warning, uncertain edge',
  545: 'Measurement warning, invalid min/max',
  546: 'Measurement warning, need 3 edges',
  547: 'Measurement warning, clipping positive/negative',
  548: 'Measurement warning, clipping positive',
  549: 'Measurement warning, clipping negative',
  630: 'Internal warning',
  2231: 'Measurement error, no statistics available',
  2233: 'Requested waveform temporarily unavailable',
  2244: 'Source waveform is not active',
  2500: 'Setup error, not a setup file',
  2501: 'Setup warning, could not recall all values',
  2760: 'Mark limit reached',
  2761: 'No mark present',
  2762: 'Search copy failed',
};

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function decodeEsr(value: number): string {
  if (!Number.isFinite(value) || value < 0) return `ESR ${value}: invalid value`;
  if (value === 0) return 'ESR 0: no standard event bits set';
  const bits: string[] = [];
  for (let bit = 0; bit <= 7; bit += 1) {
    if (((value >> bit) & 1) === 1) bits.push(ESR_BIT_MEANINGS[bit] || `bit ${bit}`);
  }
  return `ESR ${value}: ${bits.join('; ')}`;
}

function classifyEventCode(code: number): string {
  if (EVENT_CODE_MEANINGS[code]) return EVENT_CODE_MEANINGS[code];
  if (code >= 100 && code < 200) return 'Command error';
  if (code >= 200 && code < 300) return 'Execution error';
  if (code >= 300 && code < 400) return 'Device error';
  if (code >= 400 && code < 500) return 'System event';
  if (code >= 500 && code < 600) return 'Execution warning';
  return 'Unknown event code';
}

export function decodeStatusFromText(text: string): string[] {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const out: string[] = [];
  for (const match of Array.from(raw.matchAll(/(?:\*ESR\?|ESR)\s*[:=]?\s*([-+]?\d+)/gi))) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) out.push(decodeEsr(value));
  }
  for (const match of Array.from(raw.matchAll(/(?:EVENT\?|EVMSG\?|ALLEV\?)\s*[:=]?\s*([-+]?\d+)/gi))) {
    const code = Number.parseInt(match[1], 10);
    if (Number.isFinite(code)) out.push(`Event ${code}: ${classifyEventCode(code)}`);
  }
  for (const match of Array.from(raw.matchAll(/(?:^|[;\r\n])\s*([-+]?\d{1,4})\s*,/g))) {
    const code = Number.parseInt(match[1], 10);
    if (Number.isFinite(code)) out.push(`Event ${code}: ${classifyEventCode(code)}`);
  }

  return uniq(out).slice(0, 12);
}
