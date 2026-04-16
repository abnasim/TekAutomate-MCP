import { publicAssetUrl } from '../publicUrl';
import type { RagChunk, RagCorpus, RagManifest } from './types';

let manifestCache: RagManifest | null = null;
const chunkCache = new Map<RagCorpus, RagChunk[]>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function loadRagManifest(): Promise<RagManifest | null> {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = await fetchJson<RagManifest>(publicAssetUrl('rag/manifest.json'));
    return manifestCache;
  } catch {
    return null;
  }
}

export async function loadRagChunks(corpus: RagCorpus): Promise<RagChunk[]> {
  const cached = chunkCache.get(corpus);
  if (cached) return cached;
  const manifest = await loadRagManifest();
  const shard = manifest?.corpora?.[corpus];
  if (!shard) {
    chunkCache.set(corpus, []);
    return [];
  }
  try {
    const chunks = await fetchJson<RagChunk[]>(publicAssetUrl(`rag/${shard}`));
    chunkCache.set(corpus, chunks);
    return chunks;
  } catch {
    chunkCache.set(corpus, []);
    return [];
  }
}

export function clearRagCaches(): void {
  manifestCache = null;
  chunkCache.clear();
}

