import { promises as fs } from 'fs';
import * as path from 'path';
import { Bm25Index } from './bm25';
import { resolveCommandsDir } from './paths';

export interface TmMethodDoc {
  id: string;
  modelRoot: string;
  methodPath: string;
  signature: string;
  usageExample: string;
  text: string;
}

/**
 * Fuzzy model filter: normalise both sides (lowercase, strip non-alphanumeric)
 * and check for substring inclusion.
 *
 * Also handles "combined" shorthand like "MSO56" which should match both the
 * MSO5 and MSO6 families.  When the normalised filter ends with multiple digits
 * (e.g. "mso56") we additionally try matching the alpha-prefix + each individual
 * digit ("mso5", "mso6") so that users can reference whole product lines at once.
 *
 * Examples:
 *   modelMatches("mso6b_commands.MSO6BCommands", "MSO6B")  → true
 *   modelMatches("mso5b_commands.MSO5BCommands", "MSO56")  → true (mso5 match)
 *   modelMatches("mso6_commands.MSO6Commands",   "MSO56")  → true (mso6 match)
 *   modelMatches("afg3k_commands.AFG3KCommands",  "MSO56")  → false
 */
function modelMatches(modelRoot: string, filter?: string): boolean {
  if (!filter) return true;
  const root = modelRoot.toLowerCase().replace(/[^a-z0-9]/g, '');
  const f = filter.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!f) return true;
  // Direct substring match (handles MSO6B → mso6b_commands.MSO6BCommands)
  if (root.includes(f)) return true;
  // Expanded digit match: "mso56" → try "mso5" and "mso6" individually
  const m = f.match(/^([a-z]+)(\d{2,})$/);
  if (m) {
    const alpha = m[1];
    const digits = m[2];
    for (const d of digits) {
      if (root.includes(alpha + d)) return true;
    }
  }
  return false;
}

function walk(node: unknown, prefix: string[], out: string[]): void {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'cmd_syntax') continue;
    if (value === 'METHOD') {
      out.push([...prefix, key].join('.'));
      continue;
    }
    walk(value, [...prefix, key], out);
  }
}

export class TmDevicesIndex {
  private readonly docs: TmMethodDoc[];
  private readonly bm25: Bm25Index<TmMethodDoc>;

  constructor(docs: TmMethodDoc[]) {
    this.docs = docs;
    this.bm25 = new Bm25Index<TmMethodDoc>(docs);
  }

  search(query: string, model?: string, limit = 10): Array<TmMethodDoc & { availableForModel: boolean }> {
    // When a model filter is supplied we run BM25 only over that model's docs so that
    // the results are not crowded out by identical methods from the other 60+ models.
    // Without this pre-filter, any specific model has only a ~43 % chance of appearing
    // in the top-30 BM25 candidates drawn from 242 k documents, effectively returning
    // 0 model-matching results even when many relevant methods exist.
    let pool: TmMethodDoc[];
    if (model) {
      pool = this.docs.filter((d) => modelMatches(d.modelRoot, model));
    } else {
      pool = this.docs;
    }

    // If the model filter matched nothing fall back to the full corpus so the caller
    // still gets useful results (marked as not available for the requested model).
    const usingFilteredPool = pool.length > 0;
    if (!usingFilteredPool) pool = this.docs;

    const poolIndex = new Bm25Index<TmMethodDoc>(pool);
    const results = poolIndex.search(query, Math.max(limit * 3, 20));
    const out: Array<TmMethodDoc & { availableForModel: boolean }> = [];
    for (const r of results) {
      const availableForModel = usingFilteredPool
        ? modelMatches(r.doc.modelRoot, model)
        : false;
      out.push({ ...r.doc, availableForModel });
      if (out.length >= limit) break;
    }
    return out;
  }

  getByMethodPath(methodPath: string, model?: string): TmMethodDoc | null {
    const requested = String(methodPath || '').trim().toLowerCase();
    if (!requested) return null;

    const exact = this.docs
      .filter((doc) => doc.methodPath.toLowerCase() === requested && modelMatches(doc.modelRoot, model))
      .sort((a, b) => `${a.modelRoot}:${a.methodPath}`.localeCompare(`${b.modelRoot}:${b.methodPath}`));
    if (exact.length) return exact[0];

    const fallback = this.docs
      .filter((doc) => doc.methodPath.toLowerCase() === requested)
      .sort((a, b) => `${a.modelRoot}:${a.methodPath}`.localeCompare(`${b.modelRoot}:${b.methodPath}`));
    return fallback[0] || null;
  }
}

let _tmPromise: Promise<TmDevicesIndex> | null = null;

export async function initTmDevicesIndex(options?: {
  commandsDir?: string;
  treeFile?: string;
  docstringsFile?: string;
}): Promise<TmDevicesIndex> {
  if (_tmPromise) return _tmPromise;
  _tmPromise = (async () => {
    const commandsDir = options?.commandsDir || resolveCommandsDir();
    const treeFile = options?.treeFile || 'tm_devices_full_tree.json';
    const docstringsFile = options?.docstringsFile || 'tm_devices_docstrings.json';
    const treePath = path.join(commandsDir, treeFile);
    const docsPath = path.join(commandsDir, docstringsFile);
    const treeRaw = await fs.readFile(treePath, 'utf8');
    const tree = JSON.parse(treeRaw) as Record<string, unknown>;
    let docstrings: Record<string, unknown> = {};
    try {
      docstrings = JSON.parse(await fs.readFile(docsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      docstrings = {};
    }

    // Build a lookup map from model short name (e.g. 'MSO6B') to its docstrings dict.
    // The docstrings file is keyed by short model name at the top level, with nested
    // paths as sub-keys (e.g. { 'MSO6B': { 'acquire.fastacq.palette': {...} } }).
    // We also pre-compute the model short name from the tree root key, e.g.
    // 'mso6b_commands.MSO6BCommands' -> 'MSO6B'.
    function rootToShortName(root: string): string {
      // Take the class name after the dot, strip trailing 'Commands'
      const cls = root.split('.')[1] || root;
      return cls.replace(/Commands$/, '');
    }

    const docs: TmMethodDoc[] = [];
    for (const [root, rootNode] of Object.entries(tree)) {
      const methods: string[] = [];
      walk(rootNode, [], methods);
      const shortName = rootToShortName(root);
      const modelDocstrings = (docstrings[shortName] || {}) as Record<string, unknown>;
      methods.forEach((methodPath) => {
        // Docstrings are keyed by the parent path (strip leaf verb .query/.write/.verify)
        // e.g. methodPath='acquire.fastacq.palette.query' -> parentPath='acquire.fastacq.palette'
        const parts = methodPath.split('.');
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('.') : methodPath;
        const ds = modelDocstrings[parentPath];
        const dsEntry = ds && typeof ds === 'object' ? (ds as Record<string, unknown>) : null;
        const description = dsEntry ? String(dsEntry.description || '') : '';
        const usageArr = Array.isArray(dsEntry?.usage) ? (dsEntry!.usage as string[]) : [];
        const usageExample = usageArr.slice(0, 2).join(' ');
        const text = `${shortName} ${methodPath} ${description} ${usageExample}`.trim();
        const docKey = `${root}.${methodPath}`;
        docs.push({
          id: docKey.toLowerCase(),
          modelRoot: root,
          methodPath,
          signature: `${methodPath}()`,
          usageExample: usageExample || description,
          text,
        });
      });
    }
    return new TmDevicesIndex(docs);
  })();
  return _tmPromise;
}

export async function getTmDevicesIndex(): Promise<TmDevicesIndex> {
  return initTmDevicesIndex();
}
