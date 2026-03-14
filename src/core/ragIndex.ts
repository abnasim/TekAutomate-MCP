import { promises as fs } from 'fs';
import * as path from 'path';
import { Bm25Index } from './bm25';
import { resolveRagDir } from './paths';

export type RagCorpus =
  | 'scpi'
  | 'tmdevices'
  | 'app_logic'
  | 'errors'
  | 'templates'
  | 'pyvisa_tekhsi';

export interface RagChunkDoc {
  id: string;
  corpus: RagCorpus;
  title: string;
  body: string;
  source?: string;
  pathHint?: string;
  text: string;
}

interface RagManifest {
  corpora?: Partial<Record<RagCorpus, string>>;
}

export class RagIndexes {
  private readonly byCorpus: Partial<Record<RagCorpus, Bm25Index<RagChunkDoc>>>;
  private readonly docsByCorpus: Partial<Record<RagCorpus, RagChunkDoc[]>>;

  constructor(
    byCorpus: Partial<Record<RagCorpus, Bm25Index<RagChunkDoc>>>,
    docsByCorpus: Partial<Record<RagCorpus, RagChunkDoc[]>>
  ) {
    this.byCorpus = byCorpus;
    this.docsByCorpus = docsByCorpus;
  }

  search(corpus: RagCorpus, query: string, topK = 5): RagChunkDoc[] {
    const index = this.byCorpus[corpus];
    if (!index) return [];
    return index.search(query, topK).map((s) => s.doc);
  }

  getCorpus(corpus: RagCorpus): RagChunkDoc[] {
    return this.docsByCorpus[corpus] || [];
  }
}

let _ragPromise: Promise<RagIndexes> | null = null;

export async function initRagIndexes(options?: {
  ragDir?: string;
  manifestFile?: string;
}): Promise<RagIndexes> {
  if (_ragPromise) return _ragPromise;
  _ragPromise = (async () => {
    const ragDir = options?.ragDir || resolveRagDir();
    const manifestFile = options?.manifestFile || 'manifest.json';
    const manifestRaw = await fs.readFile(path.join(ragDir, manifestFile), 'utf8');
    const manifest = JSON.parse(manifestRaw) as RagManifest;
    const byCorpus: Partial<Record<RagCorpus, Bm25Index<RagChunkDoc>>> = {};
    const docsByCorpus: Partial<Record<RagCorpus, RagChunkDoc[]>> = {};

    for (const [corpus, shardFile] of Object.entries(manifest.corpora || {})) {
      if (!shardFile) continue;
      const chunkRaw = await fs.readFile(path.join(ragDir, shardFile), 'utf8');
      const chunks = JSON.parse(chunkRaw) as Array<Record<string, unknown>>;
      const docs: RagChunkDoc[] = chunks.map((c) => ({
        id: String(c.id || ''),
        corpus: corpus as RagCorpus,
        title: String(c.title || ''),
        body: String(c.body || ''),
        source: typeof c.source === 'string' ? c.source : undefined,
        pathHint: typeof c.pathHint === 'string' ? c.pathHint : undefined,
        text: `${String(c.title || '')} ${String(c.body || '')} ${String((c.tags || []).join(' ') || '')}`,
      }));
      docsByCorpus[corpus as RagCorpus] = docs;
      byCorpus[corpus as RagCorpus] = new Bm25Index<RagChunkDoc>(docs);
    }
    return new RagIndexes(byCorpus, docsByCorpus);
  })();
  return _ragPromise;
}

export async function getRagIndexes(): Promise<RagIndexes> {
  return initRagIndexes();
}
