#!/bin/bash

# Suppress Node.js deprecation warnings
export NODE_NO_WARNINGS=1

echo "========================================================"
echo "  TekAutomate - Production Build and Server"
echo "========================================================"
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo "Please install Node.js first:"
    echo "https://nodejs.org/dist/v24.13.0/node-v24.13.0.pkg"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "WARNING: Dependencies not installed!"
    echo "Running setup first..."
    echo ""
    npm install --legacy-peer-deps
    if [ $? -ne 0 ]; then
        echo "ERROR: npm install failed!"
        exit 1
    fi
fi

# Check if build folder already exists
if [ -f "build/index.html" ]; then
    echo ""
    echo "Found existing build. Skipping rebuild..."
    echo "To force rebuild, delete the build folder first."
    echo ""
else
    echo ""
    echo "[1/2] Building production version..."
    echo "      This may take 1-2 minutes..."
    echo ""

    npm run build

    if [ $? -ne 0 ]; then
        echo ""
        echo "========================================================"
        echo "  BUILD FAILED!"
        echo "========================================================"
        echo ""
        echo "Check the errors above and try again."
        exit 1
    fi

    # Check if build folder was created
    if [ ! -d "build" ]; then
        echo "ERROR: Build folder not created!"
        exit 1
    fi
fi

echo ""
echo "========================================================"
echo "  Starting Production Server"
echo "========================================================"
echo ""
echo "The application will be available at:"
echo ""
echo "   http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop the server"
echo "========================================================"
echo ""

# Serve the build folder
npx serve build -l 3000
