# Tek Automator - Deployment Package

## 🚀 Quick Deployment Guide

This deployment package contains everything needed to run Tek Automator on a new computer.

### 📋 What's Included

- **MCP Server** - Core SCPI command processing engine
- **Smart SCPI Assistant** - Conversational command discovery
- **Public Commands** - PowerShell utilities
- **Documentation** - Setup and usage guides
- **Configuration** - Environment templates

### 🛠️ System Requirements

- **Node.js** 18+ (recommended: v20+)
- **PowerShell** (Windows) or **Bash** (Linux/Mac)
- **Git** (optional, for version control)

### ⚡ Quick Setup (5 minutes)

#### 1. Extract the Package
```powershell
# Extract to your desired location
C:\Users\YourName\Documents\TekAutomator\
```

#### 2. Install Dependencies
```powershell
# Navigate to MCP server directory
cd C:\Users\YourName\Documents\TekAutomator\mcp-server

# Install Node.js dependencies
npm install
```

#### 3. Configure Environment
```powershell
# Copy environment template
copy .env.example .env

# Edit .env with your settings
notepad .env
```

#### 4. Start the Server
```powershell
# Start MCP server
npm run dev
```

Server will start on: `http://localhost:8787`

### 🔧 Configuration

#### Environment Variables (.env)
```bash
# OpenAI API Key (only for AI mode, not MCP mode)
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
PORT=8787
NODE_ENV=development

# MCP Settings
MCP_PROVIDER_SUPPLEMENTS=false
MCP_ROUTER_ENABLED=true

# Optional: Custom OpenAI Base URL
OPENAI_BASE_URL=https://api.openai.com
```

### 🎯 Usage Modes

#### MCP Mode (Recommended - No API Key Required)
```bash
# Set mode to mcp_only
apiKey="__mcp_only__"

# Features:
✅ No OpenAI calls
✅ Completely deterministic
✅ Smart SCPI Assistant
✅ Exploratory command browsing
```

#### AI Mode (Requires OpenAI API Key)
```bash
# Set your OpenAI API key
apiKey="sk-your-api-key-here"

# Features:
✅ AI-powered responses
✅ Provider supplements
✅ Enhanced capabilities
```

### 🧪 Testing

#### Test Smart SCPI Assistant
```bash
# Run test scenarios
npx tsx test_specific_queries.ts

# Test conversational flow
npx tsx test_followup_conversation.ts
```

#### Test API Endpoint
```powershell
# Test MCP mode
curl -X POST -H "Content-Type: application/json" -d '{
  "userMessage": "power measurement with harmonics",
  "outputMode": "steps_json",
  "mode": "mcp_only",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "apiKey": "__mcp_only__",
  "flowContext": {
    "backend": "pyvisa",
    "deviceType": "SCOPE",
    "modelFamily": "mso_5_series"
  }
}' http://localhost:8787/ai/chat
```

### 📚 Key Features

#### Smart SCPI Assistant
- **Exploratory Interface**: Browse SCPI commands interactively
- **Specific Query Detection**: "I2C bus trigger" → Detailed I2C commands
- **Follow-up Conversations**: "Tell me more about command 1"
- **No Auto-selection**: User maintains full control

#### Command Categories
- **Power Measurements**: Harmonics, THD, power quality
- **Bus Triggers**: I2C, SPI, CAN, LIN, UART
- **Edge Triggers**: Rising, falling, both edges
- **Acquisition**: Waveform capture and analysis

### 🔍 Troubleshooting

#### Server Won't Start
```bash
# Check Node.js version
node --version  # Should be 18+

# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules
npm install
```

#### Port Already in Use
```bash
# Kill existing Node processes
taskkill /F /IM node.exe

# Or change port in .env
PORT=8788
```

#### Commands Not Found
```bash
# Check if indexes loaded
# Look for: "✅ All indexes initialized" in server output

# Rebuild indexes if needed
npm run build:indexes
```

### 📁 File Structure

```
TekAutomator/
├── mcp-server/
│   ├── src/                    # Server source code
│   │   ├── core/              # Core logic
│   │   ├── tools/             # MCP tools
│   │   └── index.ts           # Server entry
│   ├── package.json           # Dependencies
│   ├── package-lock.json      # Locked versions
│   ├── .env.example          # Environment template
│   └── tsconfig.json         # TypeScript config
├── public/
│   └── commands/             # PowerShell utilities
├── docs/                     # Documentation
├── test_*.ts                # Test scripts
└── DEPLOYMENT_README.md      # This file
```

### 🚀 Production Deployment

#### For Production Use
```bash
# Install production dependencies
npm ci --production

# Start in production mode
NODE_ENV=production npm start

# Use process manager (PM2)
npm install -g pm2
pm2 start src/index.ts --name tekautomator
```

#### Security Considerations
- Store API keys in environment variables only
- Use HTTPS in production
- Implement authentication if needed
- Regular security updates

### 📞 Support

#### Common Issues
1. **"Cannot find module"** → Run `npm install`
2. **"Port 8787 in use"** → Kill Node processes or change port
3. **"API key error"** → Check .env configuration
4. **"No commands found"** → Check indexes loaded in server output

#### Debug Mode
```bash
# Enable debug logging
DEBUG=tekautomate:* npm run dev

# Check server logs for:
# - [DETERMINISTIC_TOOL_LOOP] messages
# - [SPECIFIC_QUERY] detections
# - Index initialization status
```

### 🎉 Success Indicators

When properly deployed, you should see:

```
🚀 Starting TekAutomate MCP Server v3.2.0 - Deterministic Tool Loop Edition
✅ All indexes initialized in 1700ms
✅ Router initialized in 300ms
MCP server listening on http://localhost:8787
```

And test queries should return detailed SCPI command information with syntax and descriptions.

---

**🎯 Ready to use!** The Smart SCPI Assistant will help users explore and discover SCPI commands through natural conversation.
