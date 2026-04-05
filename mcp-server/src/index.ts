import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { createServer } from './server';
import { initCommandIndex } from './core/commandIndex';
import { initProviderCatalog, providerSupplementsEnabled } from './core/providerCatalog';
import { initTmDevicesIndex } from './core/tmDevicesIndex';
import { initRagIndexes } from './core/ragIndex';
import { initTemplateIndex } from './core/templateIndex';
import { bootRouter } from './core/routerIntegration';

// Load .env from mcp-server directory
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

// eslint-disable-next-line import/first
async function main() {
  console.log('[MCP] Starting TekAutomate MCP Server v3.2.0');
  const startedAt = Date.now();
  const initTasks = [
    initCommandIndex(),
    initTmDevicesIndex(),
    initRagIndexes(),
    initTemplateIndex(),
    ...(providerSupplementsEnabled() ? [initProviderCatalog()] : []),
  ];

  await Promise.all(initTasks);
  console.log(`✅ All indexes initialized in ${Date.now() - startedAt}ms`);

  if (String(process.env.MCP_ROUTER_DISABLED || '').trim() !== 'true') {
    console.log('🔧 MCP Router enabled - initializing router tools...');
    const routerStartedAt = Date.now();
    await bootRouter();
    console.log(`✅ Router initialized in ${Date.now() - routerStartedAt}ms`);
  }

  const port = Number(process.env.MCP_PORT || process.env.PORT || 8787);

  createServer(port)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`MCP server listening on http://localhost:${port}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start MCP server:', err);
      process.exit(1);
    });
}

main();
