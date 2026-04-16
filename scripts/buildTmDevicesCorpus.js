const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCSTRINGS_PATH = path.join(ROOT, 'public', 'commands', 'tm_devices_docstrings.json');
const OUT_PATH = path.join(ROOT, 'AI_RAG', 'corpus', 'tmdevices', 'tmdevices_docstrings_chunks.json');

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function text(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join('\n');
  return String(value).trim();
}

function main() {
  if (!fs.existsSync(DOCSTRINGS_PATH)) {
    throw new Error(`Missing docstrings source: ${DOCSTRINGS_PATH}`);
  }

  const raw = JSON.parse(fs.readFileSync(DOCSTRINGS_PATH, 'utf8'));
  const byPath = new Map();

  for (const [model, modelDocs] of Object.entries(raw)) {
    if (!modelDocs || typeof modelDocs !== 'object') continue;
    for (const [cmdPath, doc] of Object.entries(modelDocs)) {
      const key = String(cmdPath || '').trim();
      if (!key || !doc || typeof doc !== 'object') continue;
      if (!byPath.has(key)) {
        byPath.set(key, {
          path: key,
          description: text(doc.description),
          usage: Array.isArray(doc.usage) ? doc.usage.map((x) => String(x).trim()).filter(Boolean) : [],
          scpiSyntax: text(doc.scpiSyntax),
          parameters: Array.isArray(doc.parameters) ? doc.parameters.map((x) => String(x).trim()).filter(Boolean) : [],
          info: Array.isArray(doc.info) ? doc.info.map((x) => String(x).trim()).filter(Boolean) : [],
          models: new Set([model]),
        });
      } else {
        const existing = byPath.get(key);
        existing.models.add(model);
        if (!existing.description && doc.description) existing.description = text(doc.description);
        if (!existing.scpiSyntax && doc.scpiSyntax) existing.scpiSyntax = text(doc.scpiSyntax);
        if (!existing.usage.length && Array.isArray(doc.usage)) existing.usage = doc.usage.map((x) => String(x).trim()).filter(Boolean);
        if (!existing.parameters.length && Array.isArray(doc.parameters)) {
          existing.parameters = doc.parameters.map((x) => String(x).trim()).filter(Boolean);
        }
        if (!existing.info.length && Array.isArray(doc.info)) existing.info = doc.info.map((x) => String(x).trim()).filter(Boolean);
      }
    }
  }

  const chunks = Array.from(byPath.values()).map((entry) => {
    const bodyParts = [
      entry.description ? `Description:\n${entry.description}` : '',
      entry.scpiSyntax ? `SCPI Syntax:\n${entry.scpiSyntax}` : '',
      entry.usage.length ? `Usage:\n${entry.usage.join('\n')}` : '',
      entry.parameters.length ? `Parameters:\n${entry.parameters.join('\n')}` : '',
      entry.info.length ? `Info:\n${entry.info.join('\n')}` : '',
      `Models:\n${Array.from(entry.models).sort().join(', ')}`,
    ].filter(Boolean);
    const body = bodyParts.join('\n\n').slice(0, 3000);
    return {
      id: `tmdev_${slugify(entry.path)}`,
      corpus: 'tmdevices',
      title: entry.path,
      body,
      tags: ['tm_devices', ...entry.path.split('.').slice(0, 3).map(slugify)].filter(Boolean),
      source: 'public/commands/tm_devices_docstrings.json',
    };
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(chunks, null, 2));
  console.log(`Wrote ${chunks.length} tm_devices chunks -> ${OUT_PATH}`);
}

main();
