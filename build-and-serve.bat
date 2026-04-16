@echo off
color 0B
title TekAutomate - Build and Serve

REM Suppress Node.js deprecation warnings
set NODE_NO_WARNINGS=1

echo ========================================================
echo  TekAutomate - Production Build and Server
echo ========================================================
echo.

REM Check if Node.js is available
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo ERROR: Node.js is not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    color 0E
    echo WARNING: Dependencies not installed!
    echo Running setup first...
    echo.
    call npm install --legacy-peer-deps
    if %ERRORLEVEL% NEQ 0 (
        color 0C
        echo ERROR: npm install failed!
        pause
        exit /b 1
    )
)

REM Check if build folder already exists
if exist "build\index.html" (
    echo.
    echo Found existing build. Skipping rebuild...
    echo To force rebuild, delete the build folder first.
    echo.
    goto serve
)

echo.
echo [1/2] Building production version...
echo      This may take 1-2 minutes...
echo.

call npm run build

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo ========================================================
    echo  BUILD FAILED!
    echo ========================================================
    echo.
    echo Check the errors above and try again.
    pause
    exit /b 1
)

REM Check if build folder was created
if not exist "build" (
    color 0C
    echo ERROR: Build folder not created!
    pause
    exit /b 1
)

:serve
color 0A
echo.
echo ========================================================
echo  Starting Production Server
echo ========================================================
echo.
echo.
echo The application will be available at:
echo.
echo    http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo ========================================================
echo.

REM Serve the build folder
npx serve build -l 3000

echo.
echo Server stopped.
pause
