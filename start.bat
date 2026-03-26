@echo off
color 0B
title TekAutomate

REM Suppress Node.js deprecation warnings
set NODE_NO_WARNINGS=1

echo ========================================================
echo  TekAutomate
echo ========================================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    color 0E
    echo WARNING: Dependencies not installed!
    echo.
    echo Please run SETUP.bat first to install dependencies.
    echo.
    pause
    exit /b 1
)

if exist "mcp-server\\package.json" (
    if not exist "mcp-server\\node_modules" (
        color 0E
        echo WARNING: MCP server dependencies not installed yet.
        echo.
        echo Please run SETUP.bat again before using AI/MCP features.
        echo.
    )
)

REM Check if Node.js is available
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo ERROR: Node.js is not installed!
    echo.
    echo Please run SETUP.bat first to install Node.js.
    echo.
    pause
    exit /b 1
)

echo Starting development server...
echo.
REM Kill stale MCP listener on port 8787 before starting a fresh one (silent fail).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787 " ^| findstr "LISTENING"') do (
  taskkill /PID %%p /T /F >nul 2>nul
)
REM Try to start MCP server in background (silent fail).
netstat -ano | findstr ":8787 " | findstr "LISTENING" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    start "TekAutomate MCP" cmd /k "title TekAutomate MCP && cd /d %~dp0mcp-server && set MCP_PROVIDER_SUPPLEMENTS=false && set MCP_ROUTER_ENABLED=true && npm run dev"
)
echo.
echo The application will open in your browser at:
echo http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo.
echo ========================================================
echo.

REM Start the development server
call npm start

REM Stop MCP listener when TekAutomate exits (silent fail).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /T /F >nul 2>nul
)

REM If we get here, the server was stopped
echo.
echo Server stopped.
pause
