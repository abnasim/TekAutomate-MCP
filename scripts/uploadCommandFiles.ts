import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

interface UploadManifest {
  vectorStoreId: string;
  uploadedAt: string;
  fileCount: number;
  files: string[];
}

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, 'scripts', 'commandVectorStore.manifest.json');
const FILES = [
  'public/commands/mso_2_4_5_6_7.json',
  'public/commands/MSO_DPO_5k_7k_70K.json',
  'public/commands/afg.json',
  'public/commands/awg.json',
  'public/commands/smu.json',
  'public/commands/dpojet.json',
  'public/commands/tekexpress.json',
  'public/commands/rsa.json',
  'public/commands/tm_devices_full_tree.json',
  'public/commands/tm_devices_docstrings.json',
  'docs/TM_DEVICES_USAGE_PATTERNS.md',
  'docs/TM_DEVICES_ARGUMENT_HANDLING.md',
];

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Set OPENAI_API_KEY before running uploadCommandFiles.ts');
  }

  const fileNames = FILES.filter((name) => {
    const fullPath = path.join(rootDir, name);
    if (fs.existsSync(fullPath)) return true;
    console.log(`SKIP: ${name} not found`);
    return false;
  });
  if (!fileNames.length) {
    throw new Error(`None of the configured command files were found under ${rootDir}`);
  }

  const client = new OpenAI({ apiKey });
  const replace = process.argv.includes('--replace');
  const existingVectorStoreId = process.env.COMMAND_VECTOR_STORE_ID?.trim();

  let vectorStoreId = existingVectorStoreId;
  if (replace || !vectorStoreId) {
    const vectorStore = await client.vectorStores.create({
      name: `TekAutomate Commands ${new Date().toISOString()}`,
    });
    vectorStoreId = vectorStore.id;
  }

  const fileIds: string[] = [];
  for (const name of fileNames) {
    const fullPath = path.join(rootDir, name);
    const uploaded = await client.files.create({
      file: fs.createReadStream(fullPath),
      purpose: 'assistants',
    });
    fileIds.push(uploaded.id);
    console.log(`Uploaded ${name} -> ${uploaded.id}`);
  }

  await client.vectorStores.fileBatches.createAndPoll(vectorStoreId, {
    file_ids: fileIds,
  });

  const manifest: UploadManifest = {
    vectorStoreId,
    uploadedAt: new Date().toISOString(),
    fileCount: fileNames.length,
    files: fileNames,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`COMMAND_VECTOR_STORE_ID=${vectorStoreId}`);
  console.log(`Manifest written to ${manifestPath}`);
  console.log('Add this to mcp-server/.env before enabling Responses file_search.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
