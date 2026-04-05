# TekAutomate MCP Server

AI orchestration layer for [TekAutomate](https://github.com/abnasim/TekAutomate) — Tektronix oscilloscope test automation.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new?template=https://github.com/abnasim/TekAutomate-MCP)

## What is this?

An MCP server that gives AI assistants access to 9,300+ SCPI commands across Tektronix oscilloscopes, signal generators, power supplies, and spectrum analyzers. Search commands, verify syntax, browse by group, build workflows, and control live instruments.

**No environment variables needed.** Fork, deploy, use.

## Quick Start

### Remote (One-Click Deploy)

Click the Railway button above. Once deployed, use the URL as your MCP connector:

| Client | Config |
|--------|--------|
| **ChatKit** | Workflow Settings > MCP Connector > paste URL |
| **Claude Desktop** | `~/.claude/claude_desktop_config.json` |
| **VS Code** | `.vscode/mcp.json` |
| **Cursor** | `.cursor/mcp.json` |

```json
{
  "mcpServers": {
    "tekautomate": {
      "type": "http",
      "url": "https://YOUR-DEPLOY.up.railway.app/mcp"
    }
  }
}
```

### Local (From Repo)

```bash
git clone https://github.com/abnasim/TekAutomate-MCP.git
cd TekAutomate-MCP
npm install
npm start        # HTTP server on port 8787
```

For stdio transport (Claude Desktop/Code):
```json
{
  "mcpServers": {
    "tekautomate": {
      "command": "npx",
      "args": ["tsx", "src/stdio.ts"],
      "cwd": "/path/to/TekAutomate-MCP"
    }
  }
}
```

## Tools

### SCPI Knowledge (works everywhere)
| Tool | Description |
|------|-------------|
| `search_scpi` | Keyword search across SCPI command database |
| `smart_scpi_lookup` | Natural language to SCPI command finder |
| `get_command_by_header` | Exact lookup by header (e.g. `TRIGger:A:EDGE:SOUrce`) |
| `verify_scpi_commands` | Validate command strings before sending |
| `browse_scpi_commands` | Drill-down browser: groups > commands > details |
| `retrieve_rag_chunks` | Knowledge base: procedures, bugs, patterns |
| `get_template_examples` | Workflow templates and examples |

### Live Instrument Control (requires TekAutomate app)
| Tool | Description |
|------|-------------|
| `send_scpi` | Send SCPI commands to connected instrument |
| `capture_screenshot` | Capture scope display |
| `discover_scpi` | Snapshot/diff instrument state via `*LRN?` |
| `get_visa_resources` | List connected VISA instruments |
| `get_instrument_info` | Current connection context |

### Workflow Builder
| Tool | Description |
|------|-------------|
| `tek_router` | Gateway for build, materialize, save/learn flows |
| `stage_workflow_proposal` | Push workflow changes to TekAutomate UI |

## Supported Instruments

- **Modern Scopes:** MSO2, MSO4, MSO5, MSO6 Series
- **Legacy Scopes:** DPO5000, DPO7000, DPO70000, MSO5000
- **Signal Generators:** AFG, AWG Series
- **Power Supplies:** SMU Series
- **Spectrum Analyzers:** RSA Series
- **Software:** DPOJET, TekExpress

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Tools and API reference page |
| `GET` | `/health` | Health check |
| `POST` | `/mcp` | MCP Streamable HTTP transport |
| `GET` | `/tools/list` | List all tools as JSON |
| `POST` | `/tools/execute` | Execute a tool directly |
| `POST` | `/ai/chat` | AI orchestration endpoint |

## License

MIT
