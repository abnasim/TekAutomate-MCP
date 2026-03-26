import fs from 'fs';
import path from 'path';

type RagCorpus = 'scpi' | 'tmdevices' | 'app_logic' | 'templates' | 'errors' | 'pyvisa_tekhsi';

interface RagChunk {
  id: string;
  corpus: RagCorpus;
  title: string;
  body: string;
  tags?: string[];
  source?: string;
  pathHint?: string;
}

interface RagManifest {
  version: string;
  generatedAt: string;
  corpora: Partial<Record<RagCorpus, string>>;
  counts: Partial<Record<RagCorpus, number>>;
}

const ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'public', 'commands');
const OUT_DIR = path.join(ROOT, 'public', 'rag');

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' | ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

// Clean command extraction - only extract main command objects
function extractMainCommands(data: unknown, fileName: string): RagChunk[] {
  const chunks: RagChunk[] = [];
  let commandIndex = 0;

  // Handle the grouped structure (like scope files)
  if (data && typeof data === 'object' && (data as any).groups) {
    const obj = data as any;
    Object.entries(obj.groups || {}).forEach(([groupName, groupData]: [string, any]) => {
      if (groupData && Array.isArray(groupData.commands)) {
        groupData.commands.forEach((cmd: any, idx: number) => {
          const title = toText(cmd.name) || toText(cmd.scpi) || `${groupName}_command_${idx}`;
          const scpi = toText(cmd.scpi) || toText(cmd.command) || toText(cmd.syntax);
          const description = toText(cmd.description);
          const category = toText(cmd.category) || groupName;
          
          // Skip if no SCPI command
          if (!scpi.trim()) return;
          
          const body = [
            `Command: ${scpi}`,
            description ? `Description: ${description}` : '',
            `Category: ${category}`,
            cmd.setCommand ? `Set: ${toText(cmd.setCommand)}` : '',
            cmd.queryCommand ? `Query: ${toText(cmd.queryCommand)}` : '',
            cmd.parameters ? `Parameters: ${toText(cmd.parameters)}` : ''
          ].filter(Boolean).join('\n').slice(0, 2000);

          if (body.trim()) {
            chunks.push({
              id: `${slugify(fileName)}_${commandIndex++}`,
              corpus: 'scpi' as RagCorpus,
              title: title.slice(0, 180),
              body,
              tags: [slugify(fileName.replace(/\.json$/i, '')), slugify(groupName), slugify(category)].filter(Boolean),
              source: `public/commands/${fileName}`,
              pathHint: `groups.${groupName}.commands.${idx}`
            });
          }
        });
      }
    });
  }
  // Handle simple array structure (like some smaller files)
  else if (Array.isArray(data)) {
    data.forEach((cmd: any, idx: number) => {
      const title = toText(cmd.name) || toText(cmd.scpi) || `command_${idx}`;
      const scpi = toText(cmd.scpi) || toText(cmd.command) || toText(cmd.syntax);
      const description = toText(cmd.description);
      const category = toText(cmd.category) || 'general';
      
      // Skip if no SCPI command
      if (!scpi.trim()) return;
      
      const body = [
        `Command: ${scpi}`,
        description ? `Description: ${description}` : '',
        `Category: ${category}`,
        cmd.setCommand ? `Set: ${toText(cmd.setCommand)}` : '',
        cmd.queryCommand ? `Query: ${toText(cmd.queryCommand)}` : '',
        cmd.parameters ? `Parameters: ${toText(cmd.parameters)}` : ''
      ].filter(Boolean).join('\n').slice(0, 2000);

      if (body.trim()) {
        chunks.push({
          id: `${slugify(fileName)}_${commandIndex++}`,
          corpus: 'scpi' as RagCorpus,
          title: title.slice(0, 180),
          body,
          tags: [slugify(fileName.replace(/\.json$/i, '')), slugify(category)].filter(Boolean),
          source: `public/commands/${fileName}`,
          pathHint: `${idx}`
        });
      }
    });
  }

  return chunks;
}

function buildScpiChunks(): RagChunk[] {
  ensureDir(OUT_DIR);
  const commandFiles = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.json'));
  const allChunks: RagChunk[] = [];

  console.log('Building clean SCPI RAG index...');
  
  for (const file of commandFiles) {
    if (file.includes('tm_devices') || file.includes('docstrings')) continue; // Skip tm_devices files
    
    const filePath = path.join(COMMANDS_DIR, file);
    try {
      const data = readJson(filePath);
      const chunks = extractMainCommands(data, file);
      allChunks.push(...chunks);
      console.log(`${file}: ${chunks.length} main commands extracted`);
    } catch (err) {
      console.error(`Error processing ${file}:`, err);
    }
  }

  console.log(`Total clean SCPI commands: ${allChunks.length}`);
  return allChunks;
}

function buildOtherCorpora(): { tmdevices: RagChunk[], app_logic: RagChunk[], templates: RagChunk[], errors: RagChunk[], pyvisa_tekhsi: RagChunk[] } {
  const result = {
    tmdevices: [] as RagChunk[],
    app_logic: [] as RagChunk[],
    templates: [] as RagChunk[],
    errors: [] as RagChunk[],
    pyvisa_tekhsi: [] as RagChunk[]
  };

  // Build other corpora (keeping existing logic for these)
  // ... (would add other corpus building logic here if needed)

  return result;
}

function main() {
  ensureDir(OUT_DIR);
  
  const scpiChunks = buildScpiChunks();
  const otherCorpora = buildOtherCorpora();
  
  const corpora: Partial<Record<RagCorpus, string>> = {};
  const counts: Partial<Record<RagCorpus, number>> = {};

  if (scpiChunks.length > 0) {
    const scpiFile = path.join(OUT_DIR, 'scpi_index.json');
    fs.writeFileSync(scpiFile, JSON.stringify(scpiChunks, null, 2));
    corpora.scpi = 'scpi_index.json';
    counts.scpi = scpiChunks.length;
  }

  Object.entries(otherCorpora).forEach(([corpus, chunks]) => {
    if (chunks.length > 0) {
      const file = path.join(OUT_DIR, `${corpus}_index.json`);
      fs.writeFileSync(file, JSON.stringify(chunks, null, 2));
      corpora[corpus as RagCorpus] = `${corpus}_index.json`;
      counts[corpus as RagCorpus] = chunks.length;
    }
  });

  const manifest: RagManifest = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    corpora,
    counts,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  
  console.log('\nClean RAG index generated:');
  Object.entries(counts).forEach(([corpus, count]) => {
    console.log(`  ${corpus}: ${count} chunks`);
  });
  console.log(`Manifest written to: ${path.join(OUT_DIR, 'manifest.json')}`);
}

if (require.main === module) {
  main();
}
