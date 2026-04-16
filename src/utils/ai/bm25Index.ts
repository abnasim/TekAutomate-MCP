import type { RagChunk } from './types';

interface Posting {
  chunkIdx: number;
  tf: number;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'by',
  'this', 'that', 'it', 'as', 'be', 'at', 'from', 'was', 'were', 'will', 'can',
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_:.?]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export class Bm25Index {
  private readonly chunks: RagChunk[];
  private readonly avgDocLength: number;
  private readonly docLengths: number[];
  private readonly postings = new Map<string, Posting[]>();

  constructor(chunks: RagChunk[]) {
    this.chunks = chunks;
    this.docLengths = new Array(chunks.length).fill(0);
    let totalLength = 0;
    chunks.forEach((chunk, idx) => {
      const tokens = tokenize(`${chunk.title} ${chunk.body} ${(chunk.tags || []).join(' ')}`);
      const tfMap = new Map<string, number>();
      tokens.forEach((token) => tfMap.set(token, (tfMap.get(token) || 0) + 1));
      this.docLengths[idx] = tokens.length;
      totalLength += tokens.length;
      tfMap.forEach((tf, token) => {
        const list = this.postings.get(token) || [];
        list.push({ chunkIdx: idx, tf });
        this.postings.set(token, list);
      });
    });
    this.avgDocLength = chunks.length ? totalLength / chunks.length : 1;
  }

  search(query: string, limit = 5): RagChunk[] {
    if (!query.trim() || !this.chunks.length) return [];
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const scores = new Map<number, number>();
    const N = this.chunks.length;
    const k1 = 1.2;
    const b = 0.75;

    tokens.forEach((token) => {
      const posting = this.postings.get(token);
      if (!posting?.length) return;
      const df = posting.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      posting.forEach(({ chunkIdx, tf }) => {
        const dl = this.docLengths[chunkIdx] || 1;
        const numer = tf * (k1 + 1);
        const denom = tf + k1 * (1 - b + (b * dl) / this.avgDocLength);
        const score = idf * (numer / denom);
        scores.set(chunkIdx, (scores.get(chunkIdx) || 0) + score);
      });
    });

    return Array.from(scores.entries())
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, limit)
      .map(([idx]) => this.chunks[idx]);
  }
}

