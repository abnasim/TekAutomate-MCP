# Scripts Directory

This directory contains utility scripts for building, testing, and distributing Tek Automator.

## Available Scripts

### 📦 CREATE_DISTRIBUTION.bat

**Purpose:** Creates a clean distribution ZIP file for sharing with users.

**What it does:**
- Creates a ZIP file excluding `node_modules/` (saves ~190MB)
- Includes all source code, configs, and documentation
- Includes all 17 command JSON files
- Includes all 6 template JSON files
- Shows progress and file counts
- Results in a ~5-10MB ZIP instead of 200MB+

**Usage:**
```batch
scripts\CREATE_DISTRIBUTION.bat
```

**Output:**
- `Tek_Automator_v1.0.zip` in the project root
- Detailed summary of included files

---

### ✅ VERIFY_ZIP.bat

**Purpose:** Verifies that the distribution ZIP contains all necessary files.

**What it does:**
- Lists total file count in ZIP
- Shows all command JSON files (should be 17)
- Shows all template JSON files (should be 6)
- Checks for critical files (setup.bat, start.bat, package.json)
- Color-coded pass/fail output

**Usage:**
```batch
scripts\VERIFY_ZIP.bat
```

**Expected Output:**
```
Total files in ZIP: 5685
public/commands/: 17 files
public/templates/: 6 files
✓ setup.bat
✓ start.bat
✓ package.json
ZIP VERIFICATION PASSED!
```

---

### 🧪 TEST_SETUP.bat

**Purpose:** Tests the setup script flow WITHOUT actually installing dependencies.

**What it does:**
- Verifies project structure
- Checks Node.js installation
- Tests script flow control
- Counts command and template files
- Verifies critical files exist
- Does NOT run `npm install`

**Usage:**
```batch
scripts\TEST_SETUP.bat
```

**When to use:**
- Before creating a distribution
- After modifying setup.bat
- To verify project structure
- To test on a new machine without installing

---

### 🧹 CLEANUP.bat

**Purpose:** Cleans up build artifacts and temporary files.

**What it does:**
- Removes `node_modules/` folder
- Removes `build/` folder
- Removes log files
- Removes temporary files

**Usage:**
```batch
scripts\CLEANUP.bat
```

**When to use:**
- Before creating a fresh distribution
- To free up disk space
- To reset the project to a clean state
- Before committing to version control

---

## Workflow Examples

### Creating a Distribution

```batch
# 1. Clean up old files (optional)
scripts\CLEANUP.bat

# 2. Create the distribution ZIP
scripts\CREATE_DISTRIBUTION.bat

# 3. Verify the ZIP contents
scripts\VERIFY_ZIP.bat

# 4. Test extraction and setup (on a test machine)
# - Extract the ZIP
# - Run setup.bat
# - Run start.bat
```

### Testing Setup Changes

```batch
# 1. Test the setup flow without installing
scripts\TEST_SETUP.bat

# 2. If test passes, run actual setup
setup.bat

# 3. Verify application works
start.bat
```

### Before Sharing with Users

```batch
# 1. Create distribution
scripts\CREATE_DISTRIBUTION.bat

# 2. Verify contents
scripts\VERIFY_ZIP.bat

# 3. Check output shows:
#    - 17 command files
#    - 6 template files
#    - All critical files present
#    - ZIP VERIFICATION PASSED!

# 4. Share the ZIP file with users
```

---

## Script Details

### File Counts

The scripts expect these file counts:

| Location | Files | Type |
|----------|-------|------|
| `public/commands/` | 17 | JSON |
| `public/templates/` | 6 | JSON |
| Root | 3 | BAT (setup, start, cleanup) |

**Command Files (17):**
1. acquisition.json
2. awg.json
3. channels.json
4. cursor.json
5. data.json
6. display.json
7. dpojet.json
8. horizontal.json
9. math.json
10. measurement.json
11. save-recall.json
12. system.json
13. tekexp-ethernet.json
14. tekexpress.json
15. tekhsi.json
16. trigger.json
17. waveform.json

**Template Files (6):**
1. advanced.json
2. basic.json
3. screenshot.json
4. tekexpress.json
5. tekhsi.json
6. tm_devices.json

---

## Troubleshooting

### CREATE_DISTRIBUTION.bat Issues

**Problem:** ZIP file not created
- **Solution:** Check write permissions in the project folder
- **Solution:** Close any programs that might be using the ZIP file
- **Solution:** Try running as Administrator

**Problem:** ZIP file is too large (>50MB)
- **Solution:** Make sure `node_modules/` is excluded
- **Solution:** Run `CLEANUP.bat` first, then create distribution

### VERIFY_ZIP.bat Issues

**Problem:** ZIP file not found
- **Solution:** Run `CREATE_DISTRIBUTION.bat` first
- **Solution:** Check that you're in the correct directory

**Problem:** Wrong file counts
- **Solution:** Recreate the ZIP with `CREATE_DISTRIBUTION.bat`
- **Solution:** Check that all source files are present in your project

### TEST_SETUP.bat Issues

**Problem:** Test fails on project structure
- **Solution:** Make sure you're running from the project root
- **Solution:** Check that `public/commands/` and `public/templates/` folders exist

**Problem:** Node.js not found
- **Solution:** This is just a warning in test mode
- **Solution:** Install Node.js for actual setup

---

## Requirements

All scripts require:
- Windows 10 or later
- PowerShell (built-in on Windows 10/11)
- Command Prompt or PowerShell

For actual setup (not testing):
- Node.js 18+ and npm

---

## Version History

### v1.1 (Current)
- ✅ Added VERIFY_ZIP.bat
- ✅ Added TEST_SETUP.bat
- ✅ Improved CREATE_DISTRIBUTION.bat with progress display
- ✅ Fixed setup.bat flow control issues

### v1.0 (Original)
- CREATE_DISTRIBUTION.bat
- CLEANUP.bat
- ultimate-installer.bat

---

## Related Documentation

- `../docs/DISTRIBUTION_GUIDE.md` - Complete distribution guide
- `../docs/SETUP_TROUBLESHOOTING.md` - Setup troubleshooting
- `../README.md` - Main project documentation
- `../FIXES_APPLIED.md` - Recent fixes and improvements

---

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Refer to `docs/SETUP_TROUBLESHOOTING.md`
3. Verify your project structure matches the expected layout
4. Make sure you're using the latest version of the scripts

