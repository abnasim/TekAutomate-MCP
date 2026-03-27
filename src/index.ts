import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { createServer } from './server';

// Load .env from mcp-server directory
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

// eslint-disable-next-line import/first
async function main() {
  console.log('🚀 Starting TekAutomate MCP Server v3.2.0 - Deterministic Tool Loop Edition');
  console.log('📋 Features:');
  console.log('   ✅ Clean Router Architecture (no more edge cases)');
  console.log('   ✅ Clean Planner Architecture (no more flawed logic)');
  console.log('   ✅ Deterministic Tool Loop (no OpenAI calls in mcp_only)');
  console.log('   ✅ Smart SCPI Assistant (conversational hierarchy)');
  console.log('   ✅ Context-aware provider supplements');
  console.log('   ✅ Router-based architecture (16,881+ tools)');
  console.log('   ✅ Build mode: Smart SCPI Assistant');
  console.log('   ✅ Chat mode: Provider supplements + AI');
  console.log('   ✅ Definitive routing logic (future-proof)');
  console.log('   ✅ Proper additions and changes handling');
  
  const port = Number(process.env.MCP_PORT || process.env.PORT || 8787);
  const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';

  createServer(port, host)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`MCP server listening on http://${host}:${port} (warming indexes in background if needed)`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start MCP server:', err);
      process.exit(1);
    });
}

main();
