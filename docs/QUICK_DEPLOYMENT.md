# Tek Automator - Quick Deployment

## 🚀 What's Included

- **start.bat** - Main launcher (starts React frontend + MCP server)
- **TekAutomate.bat** - MCP server only launcher
- **mcp-server/** - Smart SCPI Assistant (16,894+ commands)
- **public/** - PowerShell utilities and commands
- **docs/** - Documentation
- **package.json** - Frontend dependencies
- **.env.example** - Environment template

## ⚡ Quick Start (2 minutes)

### 1. Extract the Package
Extract `TekAutomator-Deployment-v3.2.0.zip` to your desired location

### 2. Run Setup
```bash
# Install dependencies
npm install --legacy-peer-deps

# Configure environment
copy .env.example .env
```

### 3. Start the Application
```bash
# Start everything (React + MCP server)
start.bat

# OR start MCP server only
TekAutomate.bat
```

## 🎯 Access Points

- **React Frontend**: http://localhost:3000
- **MCP Server**: http://localhost:8787
- **Smart SCPI Assistant**: Built into MCP server

## 🔧 Configuration

Edit `.env` file:
```bash
# MCP Mode (no API key needed)
OPENAI_API_KEY=__mcp_only__

# AI Mode (requires OpenAI key)
OPENAI_API_KEY=sk-your-key-here
```

## 🧪 Test Smart SCPI Assistant

```bash
# Test specific queries
curl -X POST -H "Content-Type: application/json" -d '{
  "userMessage": "power measurement with harmonics",
  "mode": "mcp_only",
  "apiKey": "__mcp_only__"
}' http://localhost:8787/ai/chat
```

## ✅ Features Working

- ✅ Smart SCPI Assistant - Conversational command discovery
- ✅ Specific Query Detection - "I2C bus trigger" → Detailed commands
- ✅ Exploratory Interface - Browse 16,894+ SCPI commands
- ✅ MCP Mode - No API key required, completely deterministic
- ✅ React Frontend - Web interface for Tek Automator

## 🎉 Success Indicators

When properly deployed:
```
🚀 Starting TekAutomate MCP Server v3.2.0
✅ All indexes initialized in ~4000ms
MCP server listening on http://localhost:8787
Starting development server...
The application will open in your browser at:
http://localhost:3000
```

## 📞 Troubleshooting

**"craco not recognized"** → Run `npm install --legacy-peer-deps`  
**Port 8787 in use** → Kill Node processes: `taskkill /F /IM node.exe`  
**Dependencies not installed** → Run `npm install --legacy-peer-deps`  

**Ready to use!** 🚀
