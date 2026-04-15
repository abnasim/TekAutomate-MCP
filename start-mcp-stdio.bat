@echo off
color 0A
title TekAutomate MCP - stdio
set NODE_NO_WARNINGS=1

echo ========================================================
echo  TekAutomate MCP Server  (stdio transport)
echo ========================================================
echo.
echo  Transport : stdin / stdout  (Claude spawns this process)
echo  Instrument: reads EXECUTOR_URL + VISA_RESOURCE from .env
echo.
echo  Use this mode with Claude Desktop or Claude Code when
echo  you want Claude to own the process lifecycle.
echo.
echo  Add to Claude Desktop  %%APPDATA%%\Claude\claude_desktop_config.json:
echo  {
echo    "mcpServers": {
echo      "tekautomate": {
echo        "command": "%~f0",
echo        "args": []
echo      }
echo    }
echo  }
echo.
echo  OR point directly at npm:
echo  {
echo    "mcpServers": {
echo      "tekautomate": {
echo        "command": "npm",
echo        "args": ["--prefix", "%~dp0mcp-server", "run", "start:stdio"]
echo      }
echo    }
echo  }
echo.
echo ========================================================
echo.

REM ── Preflight ─────────────────────────────────────────────
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo ERROR: Node.js not found. Run setup.bat first.
    pause & exit /b 1
)

if not exist "mcp-server\node_modules" (
    color 0E
    echo WARNING: MCP server dependencies not installed.
    echo Running npm install in mcp-server...
    cd /d "%~dp0mcp-server"
    call npm install
    cd /d "%~dp0"
)

REM ── Ensure scope executor is running ──────────────────────
REM Instrument control works in stdio mode — same .env, same executor.
REM The transport (stdio vs HTTP) is independent of the instrument layer.
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Scope executor not detected on port 8765.
    if exist "scope-executor\TekAutomateExecutor.exe" (
        echo [INFO] Launching TekAutomateExecutor.exe in background...
        start "TekAutomate Executor" "scope-executor\TekAutomateExecutor.exe"
        timeout /t 3 /nobreak >nul
    ) else if exist "scope-executor\run.bat" (
        echo [INFO] Launching scope-executor\run.bat in background...
        start "TekAutomate Executor" cmd /k "cd /d %~dp0scope-executor && call run.bat"
        timeout /t 3 /nobreak >nul
    ) else (
        echo [WARN] Executor not found. Live instrument tools will not work.
    )
) else (
    echo [OK] Scope executor already running on port 8765.
)

echo.
echo [OK] Starting stdio transport  (JSON-RPC over stdin/stdout)
echo      Claude is now in control of this process.
echo.

REM ── Launch stdio server ───────────────────────────────────
REM stdin/stdout are inherited from the parent (Claude).
REM Do NOT redirect them — Claude communicates through these pipes.
cd /d "%~dp0mcp-server"
npm run start:stdio
