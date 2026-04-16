@echo off
color 0E
echo ========================================================
echo  Tek Automator - Cleanup Script
echo ========================================================
echo.
echo This will remove outdated and duplicate files.
echo.
echo Files to be removed:
echo   - complete-setup-guide.txt
echo   - final-readme.txt
echo   - download-instructions.txt
echo   - complete-package.json
echo   - ultimate-installer.bat
echo   - app.tsx (if duplicate)
echo   - chat.zip
echo   - Old App version files (App1.0.tsx through App10.2.tsx)
echo.
echo Press any key to continue or Ctrl+C to cancel...
pause > nul

REM Change to project root directory
cd /d "%~dp0.."

echo.
echo [1/3] Removing outdated documentation files...
del /Q complete-setup-guide.txt 2>nul
del /Q final-readme.txt 2>nul
del /Q download-instructions.txt 2>nul
if %ERRORLEVEL% EQU 0 echo    ✓ Documentation files removed

echo.
echo [2/3] Removing duplicate/outdated scripts...
del /Q complete-package.json 2>nul
del /Q app.tsx 2>nul
del /Q chat.zip 2>nul
del /Q tek-script-gen-local.ts 2>nul
del /Q test.py 2>nul
del /Q waveform_utils.py 2>nul
if %ERRORLEVEL% EQU 0 echo    ✓ Script files removed

echo.
echo [3/3] Removing old App version files...
del /Q src\App1.0.tsx 2>nul
del /Q src\App2.0.tsx 2>nul
del /Q src\App3.0.tsx 2>nul
del /Q src\App4.0.tsx 2>nul
del /Q src\App5.0.tsx 2>nul
del /Q src\App6.0.tsx 2>nul
del /Q src\App7.0.tsx 2>nul
del /Q src\App8.0.tsx 2>nul
del /Q src\App9.0.tsx 2>nul
del /Q src\App10.1.tsx 2>nul
del /Q src\App10.2.tsx 2>nul
if %ERRORLEVEL% EQU 0 echo    ✓ Old App versions removed

color 0A
echo.
echo ========================================================
echo  Cleanup Complete!
echo ========================================================
echo.
echo Next steps:
echo   1. Review the remaining files
echo   2. Test SETUP.bat and START.bat
echo   3. Create a ZIP file for distribution
echo.
pause

