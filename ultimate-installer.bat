@echo off
color 0B
title Tektronix Script Generator - Complete Installer

echo.
echo ========================================================
echo    Tektronix Script Generator - Complete Setup
echo ========================================================
echo.
echo This will:
echo   1. Create all necessary folders
echo   2. Create configuration files
echo   3. Install Node.js dependencies
echo   4. Set up the application
echo.
echo Press any key to continue...
pause > nul

:: Create directory structure
echo.
echo [1/6] Creating directory structure...
if not exist "public" mkdir public
if not exist "public\commands" mkdir public\commands
if not exist "public\templates" mkdir public\templates
if not exist "src" mkdir src
echo    ✓ Directories created

:: Create package.json
echo.
echo [2/6] Creating package.json...
(
echo {
echo   "name": "tek-script-generator",
echo   "version": "1.0.0",
echo   "description": "Tektronix Script Generator",
echo   "private": true,
echo   "dependencies": {
echo     "lucide-react": "^0.263.1",
echo     "react": "^18.2.0",
echo     "react-dom": "^18.2.0",
echo     "react-scripts": "5.0.1",
echo     "typescript": "^4.9.5"
echo   },
echo   "scripts": {
echo     "start": "react-scripts start",
echo     "build": "react-scripts build"
echo   },
echo   "eslintConfig": {
echo     "extends": ["react-app"]
echo   },
echo   "browserslist": {
echo     "production": [">0.2%%", "not dead"],
echo     "development": ["last 1 chrome version"]
echo   }
echo }
) > package.json
echo    ✓ package.json created

:: Create tsconfig.json
echo.
echo [3/6] Creating tsconfig.json...
(
echo {
echo   "compilerOptions": {
echo     "target": "es5",
echo     "lib": ["dom", "dom.iterable", "esnext"],
echo     "allowJs": true,
echo     "skipLibCheck": true,
echo     "esModuleInterop": true,
echo     "allowSyntheticDefaultImports": true,
echo     "strict": true,
echo     "forceConsistentCasingInFileNames": true,
echo     "noFallthroughCasesInSwitch": true,
echo     "module": "esnext",
echo     "moduleResolution": "node",
echo     "resolveJsonModule": true,
echo     "isolatedModules": true,
echo     "noEmit": true,
echo     "jsx": "react-jsx"
echo   },
echo   "include": ["src"]
echo }
) > tsconfig.json
echo    ✓ tsconfig.json created

:: Create index.html
echo.
echo [4/6] Creating public/index.html...
(
echo ^<!DOCTYPE html^>
echo ^<html lang="en"^>
echo   ^<head^>
echo     ^<meta charset="utf-8" /^>
echo     ^<meta name="viewport" content="width=device-width, initial-scale=1" /^>
echo     ^<title^>Tektronix Script Generator^</title^>
echo     ^<script src="https://cdn.tailwindcss.com"^>^</script^>
echo   ^</head^>
echo   ^<body^>
echo     ^<div id="root"^>^</div^>
echo   ^</body^>
echo ^</html^>
) > public\index.html
echo    ✓ public/index.html created

:: Create index.tsx
echo.
echo [5/6] Creating src/index.tsx...
(
echo import React from 'react';
echo import ReactDOM from 'react-dom/client';
echo import App from './App';
echo const root = ReactDOM.createRoot^(document.getElementById^('root'^) as HTMLElement^);
echo root.render^(^<React.StrictMode^>^<App /^>^</React.StrictMode^>^);
) > src\index.tsx
echo    ✓ src/index.tsx created

:: Instructions for JSON files
echo.
echo [6/6] JSON Files Setup...
echo.
color 0E
echo ========================================================
echo   IMPORTANT: Manual Step Required
echo ========================================================
echo.
echo You need to copy the JSON files from the artifacts:
echo.
echo  Commands (15 files to public\commands\):
echo    - system.json, acquisition.json, horizontal.json
echo    - channels.json, trigger.json, data.json
echo    - dpojet.json, display.json, measurement.json
echo    - math.json, cursor.json, save_recall.json
echo    - waveform.json, tekhsi.json, awg.json
echo.
echo  Templates (4 files to public\templates\):
echo    - basic.json, tm_devices.json
echo    - tekhsi.json, advanced.json
echo.
echo  Source Code (1 file to src\):
echo    - App.tsx ^(from artifact: tek-script-gen-local^)
echo.
echo After copying JSON files, press any key to continue...
pause > nul

:: Check for Node.js
color 0B
echo.
echo ========================================================
echo   Installing Dependencies
echo ========================================================
echo.
echo Checking for Node.js...
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo ERROR: Node.js not found!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo Node.js found: 
node --version
echo.
echo Installing packages ^(this may take 2-3 minutes^)...
call npm install

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo ERROR: Installation failed!
    echo Try: npm install --legacy-peer-deps
    echo.
    pause
    exit /b 1
)

:: Success!
color 0A
cls
echo.
echo ========================================================
echo   SUCCESS! Installation Complete!
echo ========================================================
echo.
echo ✓ Directory structure created
echo ✓ Configuration files created  
echo ✓ Dependencies installed
echo.
echo ========================================================
echo   Next Steps:
echo ========================================================
echo.
echo 1. Make sure you copied all JSON files to:
echo    - public\commands\  ^(15 files^)
echo    - public\templates\ ^(4 files^)
echo.
echo 2. Make sure you copied App.tsx to:
echo    - src\App.tsx
echo.
echo 3. Double-click START.bat to launch!
echo.
echo ========================================================
echo.
pause