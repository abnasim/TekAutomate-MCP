import fs from 'fs';
import path from 'path';

const logDir = path.resolve(process.cwd(), 'mcp-server', 'logs', 'requests');

function printFile(filePath: string) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    console.log(`\n=== ${path.basename(filePath)} ===`);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error);
  }
}

fs.mkdirSync(logDir, { recursive: true });
console.log(`Watching ${logDir}`);

const seen = new Set<string>();
for (const name of fs.readdirSync(logDir)) {
  seen.add(name);
}

fs.watch(logDir, (_eventType, filename) => {
  if (!filename || seen.has(filename)) return;
  seen.add(filename);
  const filePath = path.join(logDir, filename);
  setTimeout(() => printFile(filePath), 100);
});
