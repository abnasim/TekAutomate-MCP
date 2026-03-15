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
- `POST /ai/responses-proxy` (SSE — proxies OpenAI Responses API using server-side key + vector store)

## App integration

Set either:

- `REACT_APP_AI_USE_MCP=true`
- or `localStorage.setItem('tekautomate.ai.use_mcp','true')`

Optional MCP host override:

- `REACT_APP_MCP_HOST=http://localhost:8787`
- or `localStorage.setItem('tekautomate.mcp.host','http://localhost:8787')`

## Environment variables

Copy `.env.example` to `.env` and configure:

```
# Your OpenAI key — owns the vector store, never sent to users
OPENAI_SERVER_API_KEY=sk-proj-your-key-here

# Vector store created under that key
COMMAND_VECTOR_STORE_ID=vs_xxxxxxxxxxxxxxxxxxxx
```

The `/ai/responses-proxy` endpoint uses `OPENAI_SERVER_API_KEY` for the OpenAI Responses API call so the vector store (created under your account) is always accessible, regardless of which user key is supplied. Users' API keys are only used for the `/ai/chat` tool-loop path.
