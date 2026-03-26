#!/bin/bash

echo ""
echo "========================================================"
echo "   TekAutomate - Setup"
echo "========================================================"
echo ""

# Step 1: Validate Files
echo "[STEP 1/4] Validating project files..."
echo "----------------------------------------------------------"

if [ ! -f "package.json" ]; then
    echo "[ERROR] package.json not found!"
    echo "Make sure you're in the project root folder."
    exit 1
fi
echo "[OK] package.json found"

if [ ! -d "public" ]; then
    echo "[ERROR] public folder not found!"
    exit 1
fi
echo "[OK] public folder found"

if [ ! -d "src" ]; then
    echo "[ERROR] src folder not found!"
    exit 1
fi
echo "[OK] src folder found"

# Step 2: Check Node.js
echo ""
echo "[STEP 2/4] Checking Node.js..."
echo "----------------------------------------------------------"
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js NOT found!"
    echo "Install from: https://nodejs.org/dist/v24.13.0/node-v24.13.0.pkg"
    exit 1
fi
echo "[OK] Node.js found:"
node --version

# Step 3: Check npm
echo ""
echo "[STEP 3/4] Checking npm..."
echo "----------------------------------------------------------"
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm NOT found!"
    exit 1
fi
echo "[OK] npm found:"
npm --version

# Step 4: Install Dependencies
echo ""
echo "[STEP 4/4] Installing dependencies..."
echo "----------------------------------------------------------"
echo "This may take 3-5 minutes, please wait..."
echo ""

npm install --legacy-peer-deps

if [ $? -ne 0 ]; then
    echo ""
    echo "========================================================"
    echo "[ERROR] npm install FAILED!"
    echo "========================================================"
    echo ""
    echo "Please check your internet connection and try again."
    exit 1
fi

if [ -f "mcp-server/package.json" ]; then
    echo ""
    echo "Installing MCP server dependencies..."
    npm --prefix mcp-server install

    if [ $? -ne 0 ]; then
        echo ""
        echo "========================================================"
        echo "[ERROR] MCP server dependency install FAILED!"
        echo "========================================================"
        echo ""
        echo "The main app may start, but AI/MCP features will not work."
        echo "Please check your internet connection and try again."
        exit 1
    fi
fi

# Success
echo ""
echo "========================================================"
echo "           SETUP COMPLETE!"
echo "========================================================"
echo ""
echo "[OK] All files validated"
echo "[OK] Node.js detected"
echo "[OK] App dependencies installed successfully"
if [ -f "mcp-server/package.json" ]; then
    echo "[OK] MCP server dependencies installed successfully"
fi
echo ""
echo "========================================================"
echo "   Ready to Launch!"
echo "========================================================"
echo ""
echo "To start the application:"
echo "   ./start.sh"
echo "   Or run: npm start"
echo ""
echo "========================================================"
