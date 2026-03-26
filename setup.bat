@echo off
color 0B
title Tektronix Script Generator - Setup

echo.
echo ========================================================
echo    Tektronix Script Generator - Dependency Installer
echo ========================================================
echo.

REM ===== STEP 1: Validate Files =====
echo [STEP 1/4] Validating project files...
echo ----------------------------------------------------------

if not exist "package.json" (
    color 0C
    echo [ERROR] package.json not found!
    echo Make sure you're in the project root folder.
    pause
    exit /b 1
)
echo [OK] package.json found

if not exist "public" (
    color 0C
    echo [ERROR] public folder not found!
    pause
    exit /b 1
)
echo [OK] public folder found

if not exist "src" (
    color 0C
    echo [ERROR] src folder not found!
    pause
    exit /b 1
)
echo [OK] src folder found

REM ===== STEP 2: Check Node.js =====
echo.
echo [STEP 2/4] Checking Node.js...
echo ----------------------------------------------------------
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Node.js NOT found!
    echo Install from: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version

REM ===== STEP 3: Check npm =====
echo.
echo [STEP 3/4] Checking npm...
echo ----------------------------------------------------------
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] npm NOT found!
    pause
    exit /b 1
)
echo [OK] npm found:
call npm --version

REM ===== STEP 4: Install Dependencies =====
echo.
echo [STEP 4/4] Installing dependencies...
echo ----------------------------------------------------------
echo This may take 3-5 minutes, please wait...
echo.

call npm install --legacy-peer-deps

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo ========================================================
    echo [ERROR] npm install FAILED!
    echo ========================================================
    echo.
    echo Please check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

if exist "mcp-server\\package.json" (
    echo.
    echo Installing MCP server dependencies...
    call npm --prefix mcp-server install

    if %ERRORLEVEL% NEQ 0 (
        color 0C
        echo.
        echo ========================================================
        echo [ERROR] MCP server dependency install FAILED!
        echo ========================================================
        echo.
        echo The main app may start, but AI/MCP features will not work.
        echo Please check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
)

REM ===== SUCCESS =====
color 0A
cls
echo.
echo ========================================================
echo           SETUP COMPLETE!
echo ========================================================
echo.
echo [OK] All files validated
echo [OK] Node.js detected
echo [OK] App dependencies installed successfully
if exist "mcp-server\\package.json" echo [OK] MCP server dependencies installed successfully
echo.
echo ========================================================
echo   Ready to Launch!
echo ========================================================
echo.
echo To start the application:
echo   - Double-click START.bat
echo   - Or run: npm start
echo.
echo ========================================================
echo.
pause
