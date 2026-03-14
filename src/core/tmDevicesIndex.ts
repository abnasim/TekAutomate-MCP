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

function normalizeModelFilter(model?: string): string {
  return (model || '').trim().toLowerCase();
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
    const results = this.bm25.search(query, Math.max(limit * 3, 20));
    const modelFilter = normalizeModelFilter(model);
    const out: Array<TmMethodDoc & { availableForModel: boolean }> = [];
    for (const r of results) {
      const availableForModel =
        !modelFilter || r.doc.modelRoot.toLowerCase().includes(modelFilter);
      out.push({ ...r.doc, availableForModel });
      if (out.length >= limit) break;
    }
    return out;
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
