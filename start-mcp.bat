@echo off
color 0B
title TekAutomate MCP Server
set NODE_NO_WARNINGS=1

echo ========================================================
echo  TekAutomate MCP Server  (standalone — no UI needed)
echo ========================================================
echo.
echo  Scope executor  :  http://localhost:8765  (start separately)
echo  MCP HTTP server :  http://localhost:8787
echo  MCP endpoint    :  http://localhost:8787/mcp
echo.
echo  Claude Code CLI config  (~/.claude/settings.json or /mcp add):
echo    { "url": "http://localhost:8787/mcp" }
echo.
echo  NOTE: Claude Desktop REJECTS http:// even for localhost.
echo        For Claude Desktop use start-mcp-stdio.bat instead.
echo.
echo ========================================================
echo.

REM ── Preflight checks ─────────────────────────────────────
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo ERROR: Node.js is not installed. Run setup.bat first.
    pause & exit /b 1
)

if not exist "mcp-server\node_modules" (
    color 0E
    echo WARNING: MCP server dependencies not installed.
    echo Running npm install in mcp-server...
    echo.
    cd /d "%~dp0mcp-server"
    call npm install
    cd /d "%~dp0"
)

REM ── Optionally launch scope executor ─────────────────────
REM The executor must be running for live instrument tools to work.
REM Skip this block if you already have it running.
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Scope executor not detected on port 8765.
    if exist "scope-executor\TekAutomateExecutor.exe" (
        echo [INFO] Launching TekAutomateExecutor.exe...
        start "TekAutomate Executor" "scope-executor\TekAutomateExecutor.exe"
        timeout /t 3 /nobreak >nul
    ) else if exist "scope-executor\run.bat" (
        echo [INFO] Launching scope-executor\run.bat...
        start "TekAutomate Executor" cmd /k "cd /d %~dp0scope-executor && call run.bat"
        timeout /t 3 /nobreak >nul
    ) else (
        echo [WARN] No scope executor found. Live instrument tools will not work.
        echo        Start the executor manually before using live tools.
    )
) else (
    echo [OK] Scope executor already running on port 8765.
)

REM ── Kill any stale MCP server on 8787 ────────────────────
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787 " ^| findstr "LISTENING"') do (
    taskkill /PID %%p /T /F >nul 2>nul
)

echo.
echo Starting MCP server...
echo.

REM ── Start MCP HTTP server (foreground) ───────────────────
cd /d "%~dp0mcp-server"
call npm run dev

echo.
echo MCP server stopped.
pause
