const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'public', 'commands');
const TEMPLATES_DIR = path.join(ROOT, 'public', 'templates');
const AI_RAG_DIR = path.join(ROOT, 'AI_RAG');
const AI_RAG_CORPUS_DIR = path.join(AI_RAG_DIR, 'corpus');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUT_DIR = path.join(ROOT, 'public', 'rag');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(input) {
  return String(input).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' | ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function extractCommandLikeObjects(root, visitor, pathParts = []) {
  if (Array.isArray(root)) {
    root.forEach((item, idx) => extractCommandLikeObjects(item, visitor, [...pathParts, String(idx)]));
    return;
  }
  if (!root || typeof root !== 'object') return;
  const obj = root;
  const keys = Object.keys(obj);
  const looksCommandLike =
    keys.some((k) => /command|scpi|syntax|query|set|description|example|parameter/i.test(k)) &&
    (typeof obj.command === 'string' ||
      typeof obj.scpi === 'string' ||
      typeof obj.syntax === 'string' ||
      typeof obj.queryCommand === 'string' ||
      typeof obj.setCommand === 'string');

  if (looksCommandLike) visitor(obj, pathParts);
  keys.forEach((key) => extractCommandLikeObjects(obj[key], visitor, [...pathParts, key]));
}

function buildChunksFromCommandFile(filePath, corpus) {
  const data = readJson(filePath);
  const fileName = path.basename(filePath);
  const out = [];
  let idx = 0;
  extractCommandLikeObjects(data, (obj, pathParts) => {
    const title =
      toText(obj.name) ||
      toText(obj.title) ||
      toText(obj.commandName) ||
      toText(obj.command) ||
      toText(obj.scpi) ||
      pathParts[pathParts.length - 1] ||
      fileName;
    const syntax = [
      toText(obj.scpi),
      toText(obj.command),
      toText(obj.syntax),
      toText(obj.setCommand),
      toText(obj.queryCommand),
      toText(obj.example),
      toText(obj.examples),
    ]
      .filter(Boolean)
      .join('\n');
    const description = toText(obj.description);
    const params = toText(obj.parameters);
    const body = [description, syntax, params]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2200);
    if (!body.trim()) return;
    idx += 1;
    out.push({
      id: `${slugify(fileName)}_${idx}`,
      corpus,
      title: title.slice(0, 180),
      body,
      tags: [fileName.replace(/\.json$/i, ''), ...pathParts.slice(-4)].map((t) => slugify(t)).filter(Boolean),
      source: `public/commands/${fileName}`,
      pathHint: pathParts.join('.'),
    });
  });
  return out;
}

function parseMarkdownChunks(mdPath, corpus, errorsCorpus = false) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const normalized = text.replace(/\r\n/g, '\n');
  const sections = normalized.split(/\n(?=#+\s)/g);
  const fileName = path.basename(mdPath);
  const out = [];
  sections.forEach((raw, idx) => {
      const lines = raw.split('\n');
      const heading = (lines[0] && lines[0].match(/^#+\s+(.*)$/) && lines[0].match(/^#+\s+(.*)$/)[1].trim()) || `${fileName} section ${idx + 1}`;
      const body = lines.slice(lines[0] && lines[0].startsWith('#') ? 1 : 0).join('\n').trim();
      if (!body) return;
      const inferredCorpus = (errorsCorpus || /fail|error|bug|violation|traceback/i.test(`${heading}\n${body}`)) ? 'errors' : corpus;
      const paragraphs = body.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
      let part = 1;
      let current = '';
      const flush = () => {
        const trimmed = current.trim();
        if (!trimmed) return;
        out.push({
          id: `${slugify(fileName)}_${idx + 1}_p${part++}`,
          corpus: inferredCorpus,
          title: heading.slice(0, 180),
          body: trimmed.slice(0, 2400),
          tags: [slugify(fileName)],
          source: path.relative(ROOT, mdPath).replace(/\\/g, '/'),
        });
        current = '';
      };
      paragraphs.forEach((p) => {
        if ((current + '\n\n' + p).length > 2200) flush();
        current = current ? `${current}\n\n${p}` : p;
      });
      flush();
    });
  return out;
}

function inferCorpusFromPath(filePath, fallback) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/error_patterns/')) return 'errors';
  if (normalized.includes('/tmdevices/')) return 'tmdevices';
  if (normalized.includes('/scpi/')) return 'scpi';
  if (normalized.includes('/templates/')) return 'templates';
  if (normalized.includes('/pyvisa_tekhsi/')) return 'pyvisa_tekhsi';
  return fallback;
}

function buildChunksFromAiCorpusJson(filePath, defaultCorpus) {
  const data = readJson(filePath);
  if (!Array.isArray(data)) return [];
  const resolvedCorpus = inferCorpusFromPath(filePath, defaultCorpus);
  return data
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const title = toText(item.title || item.name || item.id || `chunk_${idx + 1}`);
      const bodyParts = [
        toText(item.body),
        toText(item.symptom),
        toText(item.root_cause),
        toText(item.fix),
        toText(item.description),
        toText(item.code),
        toText(item.code_before),
        toText(item.code_after),
      ].filter(Boolean);
      const body = bodyParts.join('\n').slice(0, 3000);
      if (!body) return null;
      return {
        id: slugify(item.id || `${path.basename(filePath, '.json')}_${idx + 1}`),
        corpus: resolvedCorpus,
        title: title.slice(0, 180),
        body,
        tags: (Array.isArray(item.tags) ? item.tags : [])
          .concat(toText(item.type) || [])
          .map((t) => slugify(t))
          .filter(Boolean),
        source: path.relative(ROOT, filePath).replace(/\\/g, '/'),
      };
    })
    .filter(Boolean);
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(ext)).map((n) => path.join(dir, n)).sort();
}

function listFilesRecursive(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(full, ext, out);
    } else if (entry.name.toLowerCase().endsWith(ext)) {
      out.push(full);
    }
  });
  return out.sort();
}

function writeShard(fileName, chunks) {
  fs.writeFileSync(path.join(OUT_DIR, fileName), JSON.stringify(chunks, null, 2));
}

function main() {
  ensureDir(OUT_DIR);
  const scpiChunks = [];
  const tmChunks = [];
  const templateChunks = [];
  const appLogicChunks = [];
  const errorChunks = [];
  const pyvisaTekhsiChunks = [];

  listFiles(COMMANDS_DIR, '.json').forEach((filePath) => {
    const base = path.basename(filePath).toLowerCase();
    if (base.includes('tm_devices')) tmChunks.push(...buildChunksFromCommandFile(filePath, 'tmdevices'));
    else scpiChunks.push(...buildChunksFromCommandFile(filePath, 'scpi'));
  });

  listFiles(TEMPLATES_DIR, '.json').forEach((filePath) => {
    const json = readJson(filePath);
    templateChunks.push({
      id: `${slugify(path.basename(filePath))}_1`,
      corpus: 'templates',
      title: path.basename(filePath, '.json'),
      body: JSON.stringify(json).slice(0, 2400),
      source: `public/templates/${path.basename(filePath)}`,
    });
  });

  listFiles(AI_RAG_DIR, '.md').forEach((mdPath) => {
    const chunks = parseMarkdownChunks(mdPath, 'app_logic');
    chunks.forEach((chunk) => {
      if (chunk.corpus === 'errors') errorChunks.push(chunk);
      else appLogicChunks.push(chunk);
    });
  });

  listFilesRecursive(AI_RAG_CORPUS_DIR, '.json').forEach((jsonPath) => {
    const chunks = buildChunksFromAiCorpusJson(jsonPath, 'app_logic');
    chunks.forEach((chunk) => {
      if (chunk.corpus === 'scpi') scpiChunks.push(chunk);
      else if (chunk.corpus === 'tmdevices') tmChunks.push(chunk);
      else if (chunk.corpus === 'templates') templateChunks.push(chunk);
      else if (chunk.corpus === 'errors') errorChunks.push(chunk);
      else if (chunk.corpus === 'pyvisa_tekhsi') pyvisaTekhsiChunks.push(chunk);
      else appLogicChunks.push(chunk);
    });
  });

  if (!appLogicChunks.length) {
    const fallback = path.join(DOCS_DIR, 'CUSTOM_GPT_INSTRUCTIONS.txt');
    if (fs.existsSync(fallback)) {
      appLogicChunks.push({
        id: 'custom_gpt_instructions_1',
        corpus: 'app_logic',
        title: 'Custom GPT Instructions',
        body: fs.readFileSync(fallback, 'utf8').slice(0, 5000),
        source: 'docs/CUSTOM_GPT_INSTRUCTIONS.txt',
      });
    }
  }

  writeShard('scpi_index.json', scpiChunks);
  writeShard('tmdevices_index.json', tmChunks);
  writeShard('templates_index.json', templateChunks);
  writeShard('app_logic_index.json', appLogicChunks);
  writeShard('errors_index.json', errorChunks);
  writeShard('pyvisa_tekhsi_index.json', pyvisaTekhsiChunks);

  const manifest = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    corpora: {
      scpi: 'scpi_index.json',
      tmdevices: 'tmdevices_index.json',
      app_logic: 'app_logic_index.json',
      templates: 'templates_index.json',
      errors: 'errors_index.json',
      pyvisa_tekhsi: 'pyvisa_tekhsi_index.json',
    },
    counts: {
      scpi: scpiChunks.length,
      tmdevices: tmChunks.length,
      app_logic: appLogicChunks.length,
      templates: templateChunks.length,
      errors: errorChunks.length,
      pyvisa_tekhsi: pyvisaTekhsiChunks.length,
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`RAG shards generated: scpi=${scpiChunks.length}, tmdevices=${tmChunks.length}, app_logic=${appLogicChunks.length}, templates=${templateChunks.length}, errors=${errorChunks.length}, pyvisa_tekhsi=${pyvisaTekhsiChunks.length}`);
}

main();
