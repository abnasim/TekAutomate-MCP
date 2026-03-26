/* ===================== tm_devices Command Docstrings ===================== */
/* AUTO-GENERATED - DO NOT EDIT MANUALLY */
/* Generated from tm_devices Python package docstrings */

import { publicAssetUrl } from '../utils/publicUrl';

export interface CommandDocstring {
  path: string;
  description: string;
  usage: string[];
  scpiSyntax?: string;
  parameters?: string[];
  subProperties?: string[];
  info?: string[];
}

type ModelDocs = Record<string, Record<string, CommandDocstring>>;

let docstringsCache: ModelDocs | null = null;
let loadPromise: Promise<ModelDocs> | null = null;

function normalizeModelKey(model: string): string {
  return (model || '').toUpperCase().replace(/_/g, '');
}

export function areDocstringsLoaded(): boolean {
  return !!docstringsCache;
}

export async function ensureDocstringsLoaded(): Promise<ModelDocs> {
  if (docstringsCache) return docstringsCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const res = await fetch(publicAssetUrl('commands/tm_devices_docstrings.json'));
    if (!res.ok) {
      throw new Error(`Failed to load tm_devices docstrings: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    docstringsCache = data as ModelDocs;
    return docstringsCache;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function getDocstring(model: string, path: string): CommandDocstring | null {
  if (!docstringsCache) return null;
  const modelDocs = docstringsCache[normalizeModelKey(model)];
  if (!modelDocs) return null;
  return modelDocs[path] || null;
}

export function searchDocstrings(model: string, query: string): CommandDocstring[] {
  if (!docstringsCache) return [];
  const modelDocs = docstringsCache[normalizeModelKey(model)];
  if (!modelDocs) return [];

  const lowerQuery = (query || '').toLowerCase();
  return Object.entries(modelDocs)
    .filter(([path]) => path.toLowerCase().includes(lowerQuery))
    .map(([, doc]) => doc);
}

export function getDocstringModels(): ModelDocs | null {
  return docstringsCache;
}
