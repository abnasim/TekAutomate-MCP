# Distribution Guide

## Creating a Distribution ZIP

When sharing Tek Automator with your team, you should create a clean distribution ZIP that excludes unnecessary files.

### Why Exclude node_modules?

The `node_modules` folder contains all npm dependencies and is approximately **800MB**. Including it in the ZIP would make the file:
- **200MB+ compressed** (unnecessarily large)
- **Slow to download/upload**
- **Wasteful** - users can install dependencies themselves

### Quick Method: Use the Script

Run the provided script to create a clean distribution ZIP:

```batch
scripts\CREATE_DISTRIBUTION.bat
```

This script will:
- ✅ Include all necessary files (source code, configs, docs)
- ✅ Include all command files (`public/commands/*.json`)
- ✅ Include all template files (`public/templates/*.json`)
- ❌ Exclude `node_modules/` folder
- ❌ Exclude `logs/` folder
- ❌ Exclude `build/` folder
- ❌ Exclude `.git/` folder
- ❌ Exclude IDE files (`.vscode/`, `.idea/`)

The resulting ZIP should be **~5-10MB** instead of 200MB+.

### Verify the Distribution ZIP

After creating the ZIP, verify it contains all necessary files:

```batch
scripts\VERIFY_ZIP.bat
```

This will check that:
- ✅ All command JSON files are included (17 files)
- ✅ All template JSON files are included (6 files)
- ✅ Critical files like `setup.bat`, `start.bat`, `package.json` are present
- ✅ Folder structure is preserved correctly

### Manual Method

If you prefer to create the ZIP manually:

1. **Exclude these folders/files:**
   - `node_modules/` (800MB - users install via SETUP.bat)
   - `logs/` (temporary log files)
   - `build/` (build output, if exists)
   - `.git/` (version control, if using Git)
   - `.vscode/`, `.idea/` (IDE settings)
   - Any `.zip` files

2. **Include these:**
   - `SETUP.bat` - Installation script
   - `START.bat` - Launch script
   - `README.md` - User guide
   - `package.json` - Dependencies list
   - `package-lock.json` - Dependency lock file
   - `tsconfig.json` - TypeScript config
   - `.gitignore` - Git ignore rules
   - `public/` - All public assets
   - `src/` - All source code
   - `docs/` - All documentation
   - `scripts/` - Utility scripts

### Distribution Checklist

Before sharing the ZIP:

- [ ] ZIP file is ~5-10MB (not 200MB+)
- [ ] `node_modules/` is NOT included
- [ ] `logs/` folder is NOT included
- [ ] All source code is included
- [ ] All documentation is included
- [ ] `SETUP.bat` and `START.bat` are included
- [ ] Run `scripts\VERIFY_ZIP.bat` to confirm:
  - [ ] 17 command JSON files in `public/commands/`
  - [ ] 6 template JSON files in `public/templates/`
  - [ ] All critical files present
- [ ] Test the ZIP on a clean machine:
  - [ ] Extract ZIP
  - [ ] Run `SETUP.bat`
  - [ ] Verify it proceeds through all 4 steps
  - [ ] Run `START.bat`
  - [ ] Verify application works

### What Users Need to Do

When users receive the ZIP:

1. **Extract** the ZIP file to a folder
2. **Run `SETUP.bat`** - This installs all dependencies (~2-3 minutes)
3. **Run `START.bat`** - This launches the application

The `SETUP.bat` script will:
- Check for Node.js installation
- Install all npm dependencies (creates `node_modules/` folder)
- Verify installation

### File Size Comparison

| What's Included | ZIP Size |
|----------------|----------|
| With `node_modules/` | ~200MB |
| Without `node_modules/` | ~5-10MB |
| **Savings** | **~190MB** |

### Troubleshooting

**Problem:** ZIP file is still 200MB+
- **Solution:** Make sure `node_modules/` folder is excluded. Check your ZIP tool's exclusion settings.

**Problem:** Users can't run the app after extracting
- **Solution:** Make sure `package.json` is included. Users need to run `SETUP.bat` first.

**Problem:** Script fails to create ZIP
- **Solution:** 
  - If using 7-Zip: Make sure 7-Zip is installed and in PATH
  - If using PowerShell: Should work on Windows 10/11 by default
  - Try creating ZIP manually using Windows Explorer (right-click → Send to → Compressed folder)

