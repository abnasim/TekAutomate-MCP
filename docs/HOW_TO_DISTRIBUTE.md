# How to Distribute Tek Automator (Electron)

## ✅ Your Built App

**Location:** `dist\win-unpacked\` folder

This folder contains everything needed to run the app.

---

## Distribution Method

### Create a ZIP of the win-unpacked folder

```powershell
Compress-Archive -Path "dist\win-unpacked" -DestinationPath "TekAutomator_v1.0_Electron.zip"
```

Or manually:
1. Right-click `dist\win-unpacked` folder
2. Send to → Compressed (zipped) folder
3. Rename to: `TekAutomator_v1.0_Electron.zip`

---

## User Instructions

**For users receiving the app:**

```
1. Extract TekAutomator_v1.0_Electron.zip
2. Open the win-unpacked folder
3. Double-click: Tek Automator.exe
4. App launches!
```

**Requirements:**
- Windows 10 or 11
- Nothing else!

---

## What Users Should See

When they run Tek Automator.exe:
- Desktop app window opens
- Commands load automatically
- All 4000+ SCPI commands available
- All 50k+ tm_devices combinations available
- Templates available
- Everything works!

---

## File Size

- **Uncompressed:** ~200 MB (win-unpacked folder)
- **Compressed ZIP:** ~90-100 MB

This is normal for Electron apps with large data files.

---

## Testing Checklist

Before distributing, verify:
- [ ] App launches from win-unpacked folder
- [ ] Commands load (no "Loading Error")
- [ ] Templates load
- [ ] Python export works for all backends
- [ ] Workflow save/load works
- [ ] Tested on at least 2 different PCs

---

## To Rebuild

```bash
npm run electron-build-win
```

Output: `dist\win-unpacked\` folder

---

## Why win-unpacked Instead of Portable .exe?

**Portable .exe:**
- ❌ Gets blocked by Windows Defender (unsigned)
- ❌ Requires exceptions or code signing
- ❌ More hassle for users

**win-unpacked folder:**
- ✅ No Windows Defender blocking
- ✅ Works immediately
- ✅ Professional (same as VS Code portable)
- ✅ Easy to distribute

---

**Distribute the win-unpacked folder - it works!** 🚀
