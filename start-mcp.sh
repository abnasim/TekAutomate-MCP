#!/usr/bin/env bash
# TekAutomate MCP Server — standalone launcher (no UI needed)
# Usage: ./start-mcp.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================"
echo " TekAutomate MCP Server  (standalone — no UI needed)"
echo "========================================================"
echo ""
echo "  Scope executor  :  http://localhost:8765  (start separately)"
echo "  MCP HTTP server :  http://localhost:8787"
echo "  MCP endpoint    :  http://localhost:8787/mcp"
echo ""
echo "  Claude Desktop / Claude Code config:"
echo '    { "url": "http://localhost:8787/mcp" }'
echo ""
echo "========================================================"
echo ""

# Preflight: Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Please install it first."
  exit 1
fi

# Install mcp-server deps if needed
if [ ! -d "mcp-server/node_modules" ]; then
  echo "[INFO] Installing mcp-server dependencies..."
  npm --prefix mcp-server install
fi

# Check scope executor
if ! lsof -iTCP:8765 -sTCP:LISTEN &>/dev/null; then
  echo "[WARN] Scope executor not detected on port 8765."
  echo "       Start scope-executor/run.bat (Windows) or executor.py manually."
  echo "       Live instrument tools will not work until it is running."
  echo ""
fi

# Kill stale MCP server
if lsof -iTCP:8787 -sTCP:LISTEN &>/dev/null; then
  echo "[INFO] Killing stale MCP server on port 8787..."
  kill "$(lsof -t -iTCP:8787 -sTCP:LISTEN)" 2>/dev/null || true
fi

echo "Starting MCP server..."
echo ""
npm --prefix mcp-server run dev
