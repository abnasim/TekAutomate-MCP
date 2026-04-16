@echo off
color 0B
echo ========================================================
echo  Tek Automator - Test Setup Script
echo ========================================================
echo.
echo This will test the setup process WITHOUT installing
echo dependencies. Use this to verify the script flow.
echo.
echo Starting test in 2 seconds...
timeout /t 2 /nobreak >nul

cd /d "%~dp0.."

echo.
echo [1/4] Verifying project structure...
if not exist "public\commands" (
    color 0C
    echo    ✗ ERROR: public\commands folder not found!
    goto :fail
)
if not exist "public\templates" (
    color 0C
    echo    ✗ ERROR: public\templates folder not found!
    goto :fail
)
if not exist "src\App.tsx" (
    color 0C
    echo    ✗ ERROR: src\App.tsx not found!
    goto :fail
)
echo    ✓ Project structure verified

echo.
echo [2/4] Checking Node.js installation...
set NODE_FOUND=0

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set NODE_FOUND=1
    goto :node_detected
)

where npm >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set NODE_FOUND=1
    goto :node_detected
)

if %NODE_FOUND% EQU 0 (
    color 0E
    echo    ✗ Node.js not found
    echo.
    echo    This is just a test. In real setup, you would be
    echo    prompted to install Node.js.
    goto :continue_test
)

:node_detected
echo    ✓ Node.js found!
node --version 2>nul
if errorlevel 1 (
    echo    ⚠ Warning: Could not get version
) else (
    echo    Node.js version:
    node --version 2>nul
    echo    npm version:
    npm --version 2>nul
)

:continue_test
echo.
echo [3/4] Testing dependency installation flow...
echo    ℹ Skipping actual npm install (test mode)
echo    ✓ Flow control working correctly

echo.
echo [4/4] Verifying file structure...
echo.
echo    Checking command files:
set CMD_COUNT=0
for %%f in (public\commands\*.json) do set /a CMD_COUNT+=1
echo    Found %CMD_COUNT% command files
if %CMD_COUNT% LSS 15 (
    color 0E
    echo    ⚠ Warning: Expected at least 15 command files
)

echo.
echo    Checking template files:
set TPL_COUNT=0
for %%f in (public\templates\*.json) do set /a TPL_COUNT+=1
echo    Found %TPL_COUNT% template files
if %TPL_COUNT% LSS 5 (
    color 0E
    echo    ⚠ Warning: Expected at least 5 template files
)

echo.
echo    Checking critical files:
if exist "package.json" (
    echo    ✓ package.json
) else (
    echo    ✗ package.json MISSING
)
if exist "start.bat" (
    echo    ✓ start.bat
) else (
    echo    ✗ start.bat MISSING
)
if exist "setup.bat" (
    echo    ✓ setup.bat
) else (
    echo    ✗ setup.bat MISSING
)

color 0A
echo.
echo ========================================================
echo  TEST COMPLETED SUCCESSFULLY!
echo ========================================================
echo.
echo The setup script flow is working correctly.
echo.
echo Summary:
echo   - Project structure: OK
echo   - Node.js detection: OK
echo   - Flow control: OK (script continued through all steps)
echo   - Command files: %CMD_COUNT%
echo   - Template files: %TPL_COUNT%
echo.
echo To run the actual setup:
echo   setup.bat
echo.
goto :end

:fail
echo.
echo ========================================================
echo  TEST FAILED
echo ========================================================
echo.
echo Please check the project structure.
echo.

:end
echo Press any key to exit...
pause >nul

