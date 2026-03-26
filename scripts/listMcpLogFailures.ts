import fs from 'fs';
import path from 'path';

const logDir = path.resolve(process.cwd(), 'mcp-server', 'logs', 'requests');

if (!fs.existsSync(logDir)) {
  console.log('No MCP request logs found.');
  process.exit(0);
}

const files = fs
  .readdirSync(logDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

for (const name of files) {
  const filePath = path.join(logDir, name);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const success = parsed.success === true;
    const postCheck = (parsed.postCheck || {}) as Record<string, unknown>;
    const errors = Array.isArray(postCheck.errors) ? postCheck.errors : [];
    const autoRepairTriggered = postCheck.autoRepairTriggered === true;
    if (!success || errors.length > 0 || autoRepairTriggered) {
      console.log(`\n=== ${name} ===`);
      console.log(JSON.stringify(parsed, null, 2));
    }
  } catch (error) {
    console.error(`Failed to parse ${name}:`, error);
  }
}
