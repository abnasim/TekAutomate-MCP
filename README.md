# TekAutomate MCP Server

## Run

```bash
cd mcp-server
npm install
npm run start
```

Server defaults to `http://localhost:8787`.

## Endpoints

- `GET /health`
- `POST /ai/chat` (SSE response)

## App integration

Set either:

- `REACT_APP_AI_USE_MCP=true`
- or `localStorage.setItem('tekautomate.ai.use_mcp','true')`

Optional MCP host override:

- `REACT_APP_MCP_HOST=http://localhost:8787`
- or `localStorage.setItem('tekautomate.mcp.host','http://localhost:8787')`
