@echo off
title Tek Automator
echo.
echo Starting Tek Automator...
echo.

if not exist "build" (
    echo ERROR: build folder not found!
    pause
    exit /b 1
)

echo Installing serve...
call npm install -g serve

echo.
echo ============================================
echo  Server starting on http://localhost:3000
echo  Open your browser to that address
echo  Press Ctrl+C here to stop the server
echo ============================================
echo.

call npx serve -s build -l 3000

pause
