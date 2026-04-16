/**
 * Parse Tek Automate executor connection payload from QR scan or manual entry.
 * Supports: tekautomate://connect?v=1&host=...&port=... or JSON { v, host, port }.
 */

export interface ParsedExecutorEndpoint {
  host: string;
  port: number;
}

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Parse a string from QR scan or manual entry into executor host and port.
 * @param input - URL string (tekautomate://connect?v=1&host=...&port=...) or JSON string
 * @returns Parsed endpoint or null if invalid
 */
export function parseConnectQR(input: string): ParsedExecutorEndpoint | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL form: tekautomate://connect?v=1&host=192.168.1.10&port=8765
  if (trimmed.toLowerCase().startsWith('tekautomate://connect')) {
    try {
      const url = new URL(trimmed);
      const host = url.searchParams.get('host')?.trim();
      const portStr = url.searchParams.get('port')?.trim();
      if (!host) return null;
      const port = portStr ? parseInt(portStr, 10) : 8765;
      if (!Number.isFinite(port) || port < MIN_PORT || port > MAX_PORT) return null;
      return { host, port };
    } catch {
      return null;
    }
  }

  // JSON form: {"v":1,"host":"192.168.1.10","port":8765}
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.host === 'string') {
      const host = obj.host.trim();
      if (!host) return null;
      const port = typeof obj.port === 'number'
        ? obj.port
        : (typeof obj.port === 'string' ? parseInt(obj.port, 10) : 8765);
      if (!Number.isFinite(port) || port < MIN_PORT || port > MAX_PORT) return null;
      return { host, port };
    }
  } catch {
    // not JSON, ignore
  }

  return null;
}
