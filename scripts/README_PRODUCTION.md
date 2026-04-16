# Tek Automator - Production Build

## Quick Start

1. **Make sure Node.js is installed** (from https://nodejs.org/)
2. **Double-click `SERVE.bat`**
3. **Manually open browser to: http://localhost:3000**
4. That's it!

---

## Requirements

**Node.js is required** (but you don't need to install dependencies)

- Download from: https://nodejs.org/
- Install the LTS (Long Term Support) version
- After installation, **restart your computer**

---

## How to Run

1. **Make sure Node.js is installed**
   ```
   Open Command Prompt and type: node --version
   If you see a version number (e.g., v18.x.x), you're good!
   ```

2. **Double-click `SERVE.bat`**
   - First time: Installs 'serve' package (automatic)
   - Opens browser at http://localhost:3000
   - Application loads

3. **Stop the server**
   - Press `Ctrl+C` in the window
   - Or just close the window

---

## Troubleshooting

### "Node.js NOT Found" Error

**Problem:** SERVE.bat says Node.js is not found

**Solution:**
1. Install Node.js from https://nodejs.org/
2. **Restart your computer** (required for PATH to update)
3. Run SERVE.bat again

**Still not working?**
- Open Command Prompt
- Type: `node --version`
- If it says "not recognized", Node.js installation may have failed
- Try reinstalling Node.js and check "Add to PATH" option

### Port Already in Use

**Problem:** Error says "Port 3000 is already in use"

**Solution:**
- Another application is using port 3000
- Close other applications
- Or edit SERVE.bat and change `3000` to `3001`

### Application Won't Load

**Problem:** Browser opens but shows error

**Solution:**
1. Check that `build/` folder exists in the same directory
2. Make sure you extracted the entire ZIP file
3. Try refreshing the browser

---

## What This Application Does

- **Visual Workflow Builder** - Create instrument automation workflows
- **4000+ SCPI Commands** - Comprehensive command library for Tektronix instruments
- **50,000+ tm_devices Commands** - Full API tree with documentation
- **Multi-Backend Support** - PyVISA, tm_devices, VXI-11, TekHSI
- **Python Export** - Generate ready-to-run Python scripts

---

## File Structure

```
Tek_Automator_Production/
├── SERVE.bat          ← Double-click this to start
├── README.md          ← This file
└── build/             ← Pre-built application (don't modify)
```

---

## Support

For issues or questions, contact your IT support or team lead.

---

**Version:** 1.0.0 (Production Build)  
**Build Type:** Optimized, minified, production-ready
