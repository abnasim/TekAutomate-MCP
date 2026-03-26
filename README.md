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

## Examples

Sample workflows are included in the `examples/` folder.

---

## Author

Ab Nasim (ab.nasim@tek.com)
