# TekAutomate

Version 2.0.4 (Beta)

Visual programming tool for automating Tektronix test equipment.

**Disclaimer:** This is a beta release for testing purposes only. All generated outputs should be reviewed and verified before use.

---

## Quick Start (Prebuilt Distribution)

If you have the prebuilt ZIP (`TekAutomate_v2.0.4_prebuilt.zip`):

### Step 1: Install Node.js

- **Windows:** [node-v24.13.0-x64.msi](https://nodejs.org/dist/v24.13.0/node-v24.13.0-x64.msi)
- **macOS:** [node-v24.13.0.pkg](https://nodejs.org/dist/v24.13.0/node-v24.13.0.pkg)

### Step 2: Extract and Run

- **Windows:** Double-click `TekAutomate.bat`
- **macOS:** Run `./TekAutomate.sh`

### Step 3: Open Browser

Go to http://localhost:3000

---

## Developer Installation (Source Distribution)

If you have the full source code:

### Step 1: Install Node.js

- **Windows:** [node-v24.13.0-x64.msi](https://nodejs.org/dist/v24.13.0/node-v24.13.0-x64.msi)
- **macOS:** [node-v24.13.0.pkg](https://nodejs.org/dist/v24.13.0/node-v24.13.0.pkg)

### Step 2: Run Setup

- **Windows:** Double-click `setup.bat`
- **macOS:** Run `./setup.sh`

This installs both the main app dependencies and the bundled `mcp-server` dependencies required for AI/MCP features.

### Step 3: Start the Application

**Development Mode** (with hot reload):
- **Windows:** Double-click `start.bat`
- **macOS:** Run `./start.sh`

**Production Mode** (faster):
- **Windows:** Double-click `build-and-serve.bat`
- **macOS:** Run `./build-and-serve.sh`

---

## MCP Server Integration

TekAutomate exposes 29 AI tools (SCPI lookup, command building, live instrument control) via the [Model Context Protocol](https://modelcontextprotocol.io). Connect it to any MCP-compatible client:

### Claude Web (claude.ai)

Settings > Connectors > Add Custom Connector:
- **Name:** `TekAutomate`
- **URL:** `https://tekautomate-mcp-production.up.railway.app/mcp`

### Claude Desktop

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tekautomate": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/stdio.ts"],
      "cwd": "/path/to/TekAutomate"
    }
  }
}
```

### Claude Code (CLI)

Add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "tekautomate": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/stdio.ts"],
      "cwd": "/path/to/TekAutomate"
    }
  }
}
```

### VS Code / Cursor

Add `.vscode/mcp.json`:

```json
{
  "servers": {
    "tekautomate": {
      "command": "npx",
      "args": ["tsx", "mcp-server/src/stdio.ts"],
      "cwd": "/path/to/TekAutomate"
    }
  }
}
```

### Transports

| Transport | Use For | URL / Command |
|-----------|---------|---------------|
| **Streamable HTTP** | Claude Web, remote clients | `https://tekautomate-mcp-production.up.railway.app/mcp` |
| **Stdio** | Claude Desktop, Claude Code, VS Code, Cursor | `npx tsx mcp-server/src/stdio.ts` |

Visit `https://tekautomate-mcp-production.up.railway.app` for the full tools & API reference page.

### RAG content and corpus updates

The MCP server now owns its RAG source content under:

- `mcp-server/rag/corpus`

Generated shards are written to:

- `public/rag`

This includes a `scope_logic` corpus for procedural scope knowledge such as:

- clipping recovery
- autoset-first setup
- trigger stabilization
- decode bring-up
- probe compensation

Typical workflow:

1. Add or edit markdown/JSON under `mcp-server/rag/corpus/...`
2. Run `npm --prefix mcp-server run build:rag`
3. Commit both the source corpus files and regenerated `public/rag/*.json`
4. Push

For the standalone hosted MCP repo, the same pattern applies: build locally, then push the generated shards so hosted deployments do not have to guess or rebuild corpus content at runtime.

---

## Examples

Sample workflows are included in the `examples/` folder.

---

## Author

Ab Nasim (ab.nasim@tek.com)
