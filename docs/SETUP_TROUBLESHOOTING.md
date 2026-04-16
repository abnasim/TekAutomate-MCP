# Setup Troubleshooting Guide

## Common Issues with SETUP.bat

### Issue 1: Setup Stops After Node.js Detection

**Symptom:**
```
[2/4] Checking Node.js installation...
   ✓ Node.js found!
   Node.js version:
v24.11.1
   npm version:
11.6.2

[Script stops here and doesn't continue to step 3]
```

**Causes:**
1. The version commands may be setting an error level that stops the script
2. The script may be waiting for input that isn't visible
3. Terminal encoding issues with special characters

**Solutions:**

✅ **Solution 1: Updated Script (Recommended)**
The latest version of `setup.bat` includes fixes for this issue:
- Uses `errorlevel` checks instead of `%ERRORLEVEL%` variable
- Redirects stderr to prevent error messages from stopping the script
- Explicitly jumps to the next section with `goto :install_deps`
- Captures npm exit codes in a separate variable

✅ **Solution 2: Manual Installation**
If the script still doesn't work, install dependencies manually:
```batch
npm install
```
Or if that fails:
```batch
npm install --legacy-peer-deps
```

✅ **Solution 3: Check for Hanging Processes**
- Press `Ctrl+C` to see if the script is waiting for input
- Close and reopen the command prompt
- Run the script again

### Issue 2: ZIP File Missing Commands/Templates

**Symptom:**
After extracting the ZIP, the `public/commands/` or `public/templates/` folders are empty.

**Verification:**
Run the verification script:
```batch
scripts\VERIFY_ZIP.bat
```

**Expected Output:**
```
public/commands/: 17 files
public/templates/: 6 files
```

**Solutions:**

✅ **Solution 1: Recreate the ZIP**
The distribution script has been updated to properly include nested files:
```batch
scripts\CREATE_DISTRIBUTION.bat
```

Then verify:
```batch
scripts\VERIFY_ZIP.bat
```

✅ **Solution 2: Check Your Extraction Method**
- Use Windows built-in extraction (right-click → Extract All)
- Or use 7-Zip, WinRAR, or WinZip
- Make sure "Preserve folder structure" is enabled

### Issue 3: Node.js Not Found

**Symptom:**
```
Node.js is not detected!
```

**Solutions:**

✅ **Solution 1: Install Node.js**
1. Download from: https://nodejs.org/
2. Install the LTS version
3. **Close ALL command prompts**
4. Open a NEW command prompt
5. Run `setup.bat` again

✅ **Solution 2: Use Winget (Windows 10/11)**
```batch
winget install OpenJS.NodeJS.LTS
```
Then close and reopen your command prompt.

✅ **Solution 3: Add to PATH Manually**
If Node.js is installed but not detected:
1. Find your Node.js installation (usually `C:\Program Files\nodejs\`)
2. Add it to your PATH:
   - Windows Search → "Environment Variables"
   - Edit "Path" variable
   - Add Node.js installation folder
3. Close and reopen command prompt

### Issue 4: npm install Fails

**Symptom:**
```
ERROR: Installation failed!
```

**Solutions:**

✅ **Solution 1: Use Legacy Peer Deps**
```batch
npm install --legacy-peer-deps
```

✅ **Solution 2: Clear npm Cache**
```batch
npm cache clean --force
npm install
```

✅ **Solution 3: Check Internet Connection**
- Make sure you're connected to the internet
- Check if you're behind a corporate proxy
- Try using a different network

✅ **Solution 4: Update npm**
```batch
npm install -g npm@latest
```

### Issue 5: Permission Denied Errors

**Symptom:**
```
Error: EACCES: permission denied
```

**Solutions:**

✅ **Solution 1: Run as Administrator**
- Right-click on Command Prompt
- Select "Run as administrator"
- Navigate to the project folder
- Run `setup.bat`

✅ **Solution 2: Change Folder Permissions**
- Right-click on the project folder
- Properties → Security
- Make sure your user has "Full control"

### Testing the Fixed Scripts

To verify the fixes are working:

1. **Test setup.bat:**
   ```batch
   setup.bat
   ```
   Should proceed through all 4 steps without stopping.

2. **Test distribution ZIP:**
   ```batch
   scripts\CREATE_DISTRIBUTION.bat
   scripts\VERIFY_ZIP.bat
   ```
   Should show:
   - 17 command files
   - 6 template files
   - All critical files present

3. **Test on a clean machine:**
   - Extract the ZIP to a new folder
   - Run `setup.bat`
   - Verify it completes all 4 steps
   - Run `start.bat`
   - Verify the application launches

### Getting Help

If you're still experiencing issues:

1. Check the error message carefully
2. Try the solutions in this guide
3. Check the main README.md for additional information
4. Make sure you're using the latest version of the scripts

### Version History

**v1.1 (Current)**
- ✅ Fixed: setup.bat now continues after Node.js detection
- ✅ Fixed: Better error level handling
- ✅ Fixed: Explicit goto statements for flow control
- ✅ Added: VERIFY_ZIP.bat script
- ✅ Improved: CREATE_DISTRIBUTION.bat shows file counts

**v1.0 (Original)**
- ❌ Issue: setup.bat could stop after Node.js detection
- ⚠️ Issue: No verification for ZIP contents

