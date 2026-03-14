import { createServer } from './server';

const port = Number(process.env.MCP_PORT || 8787);

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
