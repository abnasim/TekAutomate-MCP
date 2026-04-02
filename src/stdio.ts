/**
 * MCP Stdio Transport Entry Point
 *
 * Exposes the same tools as the HTTP server but over the standard
 * MCP stdio protocol, so Claude Code, Claude Desktop, VS Code (Copilot),
 * Cursor, and any other MCP-compatible client can use TekAutomate tools
 * natively.
 *
 * Usage:
 *   npx tsx mcp-server/src/stdio.ts
 *
 * Nothing in the existing HTTP server is modified — this is an
 * additive, parallel entry point.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types';

import { initCommandIndex } from './core/commandIndex.js';
import { initTmDevicesIndex } from './core/tmDevicesIndex.js';
import { initRagIndexes } from './core/ragIndex.js';
import { initTemplateIndex } from './core/templateIndex.js';
import { initProviderCatalog, providerSupplementsEnabled } from './core/providerCatalog.js';
import { bootRouter } from './core/routerIntegration.js';
import { getMcpExposedTools, runTool } from './tools/index.js';

// ── env ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env') });

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  // All logs go to stderr so they don't corrupt the stdio JSON-RPC stream
  console.error('[tekautomate-mcp] Initializing indexes…');

  const initTasks = [
    initCommandIndex(),
    initTmDevicesIndex(),
    initRagIndexes(),
    initTemplateIndex(),
    ...(providerSupplementsEnabled() ? [initProviderCatalog()] : []),
  ];
  await Promise.all(initTasks);
  console.error('[tekautomate-mcp] Indexes ready');

  if (String(process.env.MCP_ROUTER_DISABLED || '').trim() !== 'true') {
    await bootRouter();
    console.error('[tekautomate-mcp] Router ready');
  }

  // ── Create low-level MCP server ──────────────────────────────────
  const server = new Server(
    { name: 'tekautomate', version: '3.2.0' },
    { capabilities: { tools: {} } },
  );

  // Only expose the slim MCP surface (gateway + live tools)
  // All other tools are routed internally via tek_router
  const toolDefs = getMcpExposedTools();
  const mcpTools = toolDefs.map((def) => ({
    name: def.name,
    description: def.description ?? def.name,
    inputSchema: {
      type: 'object' as const,
      properties: (def.parameters as any)?.properties ?? {},
      ...((def.parameters as any)?.required?.length
        ? { required: (def.parameters as any).required }
        : {}),
    },
  }));

  // ── tools/list handler ───────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools,
  }));

  // ── tools/call handler ───────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await runTool(name, (args as Record<string, unknown>) ?? {});

      let text = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);

      // Cap response size for MCP clients
      const MAX_MCP_RESPONSE = 70000;
      if (text.length > MAX_MCP_RESPONSE) {
        const truncated = text.slice(0, MAX_MCP_RESPONSE);
        const lastNewline = truncated.lastIndexOf('\n');
        text = (lastNewline > MAX_MCP_RESPONSE * 0.8 ? truncated.slice(0, lastNewline) : truncated)
          + `\n\n[Response truncated from ${text.length} to ${MAX_MCP_RESPONSE} chars. Use more specific queries.]`;
      }

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  console.error(`[tekautomate-mcp] Registered ${mcpTools.length} tools via stdio`);

  // ── Connect stdio transport ──────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[tekautomate-mcp] Stdio transport connected — ready for requests');
}

main().catch((err) => {
  console.error('[tekautomate-mcp] Fatal:', err);
  process.exit(1);
});

