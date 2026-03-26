#!/bin/bash

# Suppress Node.js deprecation warnings
export NODE_NO_WARNINGS=1

echo "========================================================"
echo "  TekAutomate"
echo "========================================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "WARNING: Dependencies not installed!"
    echo ""
    echo "Please run ./setup.sh first to install dependencies."
    echo ""
    exit 1
fi

if [ -f "mcp-server/package.json" ] && [ ! -d "mcp-server/node_modules" ]; then
    echo "WARNING: MCP server dependencies not installed yet."
    echo ""
    echo "Please run ./setup.sh again before using AI/MCP features."
    echo ""
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo ""
    echo "Please install Node.js first:"
    echo "https://nodejs.org/dist/v24.13.0/node-v24.13.0.pkg"
    echo ""
    exit 1
fi

echo "Starting development server..."
echo ""
# Kill stale MCP listener on port 8787 before starting a fresh one (silent fail).
if lsof -i:8787 -sTCP:LISTEN -t >/dev/null 2>&1; then
  lsof -i:8787 -sTCP:LISTEN -t | xargs kill -9 >/dev/null 2>&1 || true
fi
# Try to start MCP server in background (silent fail).
MCP_PID=""
if ! lsof -i:8787 -sTCP:LISTEN -t >/dev/null 2>&1; then
  npm --prefix mcp-server run dev > mcp.dev.log 2>&1 &
  MCP_PID=$!
fi

cleanup_mcp() {
  if [ -n "$MCP_PID" ]; then
    kill "$MCP_PID" >/dev/null 2>&1 || true
    pkill -P "$MCP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup_mcp EXIT INT TERM

echo "The application will open in your browser at:"
echo "http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""
echo "========================================================"
echo ""

# Start the development server
npm start
