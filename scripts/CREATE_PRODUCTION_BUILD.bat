@echo off
color 0B
title Tek Automator - Create Production Build Distribution
echo ========================================================
echo  Tek Automator - Create Production Build Distribution
echo ========================================================
echo.
echo This will:
echo   1. Run 'npm run build' to create production build
echo   2. Create a ZIP with optimized build/ folder
echo   3. Include a simple server script to run the app
echo.
echo This is FASTER and more PRODUCTION-READY than dev mode.
echo.
pause

REM Change to project root directory
cd /d "%~dp0.."

REM Step 1: Clean old build
echo.
echo [STEP 1/3] Cleaning old build folder...
echo ----------------------------------------------------------
if exist "build" (
    echo Removing old build folder...
    rmdir /S /Q "build"
)

REM Step 2: Build production version
echo.
echo [STEP 2/3] Building production version...
echo ----------------------------------------------------------
echo This may take 1-2 minutes...
echo.
call npm run build

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo ========================================================
    echo [ERROR] Build FAILED!
    echo ========================================================
    echo.
    echo The production build failed. Check the errors above.
    echo Fix any issues and try again.
    echo.
    pause
    exit /b 1
)

REM Step 3: Create production ZIP
echo.
echo [STEP 3/3] Creating production distribution ZIP...
echo ----------------------------------------------------------

REM Get current folder name for ZIP file name
for %%I in (.) do set FOLDERNAME=%%~nxI
set ZIPNAME=%FOLDERNAME%_Production_v1.0.zip

REM Remove old ZIP if exists
if exist "%ZIPNAME%" (
    echo Removing old production ZIP file...
    del /Q "%ZIPNAME%"
)

echo Creating production ZIP...
echo.

REM Create production README
echo Creating production README...
copy /Y "%~dp0README_PRODUCTION.md" "README.md" >nul

REM Create SERVE.bat from template
echo Creating SERVE.bat...
copy /Y "%~dp0SERVE_FINAL.bat" "SERVE.bat" >nul

REM Use PowerShell to create production ZIP
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; " ^
    "$zipPath = Join-Path '%CD%' '%ZIPNAME%'; " ^
    "$rootPath = '%CD%'; " ^
    "try { " ^
    "  Write-Host 'Creating production distribution ZIP...'; " ^
    "  Write-Host ''; " ^
    "  $tempZip = $zipPath + '.tmp'; " ^
    "  if (Test-Path $tempZip) { Remove-Item $tempZip -Force }; " ^
    "  Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
    "  $zip = [System.IO.Compression.ZipFile]::Open($tempZip, 'Create'); " ^
    "  Write-Host 'Including files:'; " ^
    "  Write-Host '  - build/ folder (production build)'; " ^
    "  $buildFiles = Get-ChildItem -Path (Join-Path $rootPath 'build') -Recurse -File; " ^
    "  $fileCount = $buildFiles.Count; " ^
    "  Write-Host \"  - $fileCount files from build folder\"; " ^
    "  Write-Host '  - SERVE.bat (startup script)'; " ^
    "  Write-Host '  - README.md (production user guide)'; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Excluding:'; " ^
    "  Write-Host '  - Source code (not needed)'; " ^
    "  Write-Host '  - node_modules (not needed)'; " ^
    "  Write-Host '  - docs folder (not needed)'; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Adding files to ZIP...'; " ^
    "  $progress = 0; " ^
    "  foreach ($file in $buildFiles) { " ^
    "    $relPath = 'build/' + $file.FullName.Substring((Join-Path $rootPath 'build').Length + 1).Replace('\', '/'); " ^
    "    $entry = $zip.CreateEntry($relPath); " ^
    "    $entryStream = $entry.Open(); " ^
    "    $fileStream = [System.IO.File]::OpenRead($file.FullName); " ^
    "    $fileStream.CopyTo($entryStream); " ^
    "    $fileStream.Close(); " ^
    "    $entryStream.Close(); " ^
    "    $progress++; " ^
    "    if ($progress %% 50 -eq 0) { Write-Host \"  Added $progress / $fileCount files...\" } " ^
    "  }; " ^
    "  $serveBat = Join-Path $rootPath 'SERVE.bat'; " ^
    "  if (Test-Path $serveBat) { " ^
    "    $entry = $zip.CreateEntry('SERVE.bat'); " ^
    "    $entryStream = $entry.Open(); " ^
    "    $fileStream = [System.IO.File]::OpenRead($serveBat); " ^
    "    $fileStream.CopyTo($entryStream); " ^
    "    $fileStream.Close(); " ^
    "    $entryStream.Close(); " ^
    "  }; " ^
    "  $readme = Join-Path $rootPath 'README.md'; " ^
    "  if (Test-Path $readme) { " ^
    "    $entry = $zip.CreateEntry('README.md'); " ^
    "    $entryStream = $entry.Open(); " ^
    "    $fileStream = [System.IO.File]::OpenRead($readme); " ^
    "    $fileStream.CopyTo($entryStream); " ^
    "    $fileStream.Close(); " ^
    "    $entryStream.Close(); " ^
    "  }; " ^
    "  $zip.Dispose(); " ^
    "  Move-Item $tempZip $zipPath -Force; " ^
    "  $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2); " ^
    "  Write-Host ''; " ^
    "  Write-Host '========================================================'; " ^
    "  Write-Host '  PRODUCTION BUILD SUCCESS!'; " ^
    "  Write-Host '========================================================'; " ^
    "  Write-Host ''; " ^
    "  Write-Host \"Production ZIP created: $zipPath\"; " ^
    "  Write-Host \"Size: $sizeMB MB (optimized, minified, production-ready)\"; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'What users get:'; " ^
    "  Write-Host '  - Pre-built production version'; " ^
    "  Write-Host '  - SERVE.bat to start the server'; " ^
    "  Write-Host '  - README.md with simple instructions'; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Benefits of production build:'; " ^
    "  Write-Host '  ✓ Much smaller size (5-15 MB)'; " ^
    "  Write-Host '  ✓ Faster loading (optimized and minified)'; " ^
    "  Write-Host '  ✓ Production-ready'; " ^
    "  Write-Host '  ✓ No npm install required'; " ^
    "  Write-Host '  ✓ Just double-click SERVE.bat'; " ^
    "  Write-Host ''; " ^
    "  exit 0 " ^
    "} catch { " ^
    "  Write-Host ''; " ^
    "  Write-Host 'ERROR: ' $_.Exception.Message; " ^
    "  exit 1 " ^
    "}"

REM Cleanup temp files
if exist "SERVE.bat" del /Q "SERVE.bat"
if exist "README.md" del /Q "README.md"

REM Check if ZIP file was actually created
if exist "%ZIPNAME%" (
    color 0A
    cls
    echo.
    echo ========================================================
    echo  PRODUCTION BUILD COMPLETE!
    echo ========================================================
    echo.
    echo Created: %ZIPNAME%
    echo.
    echo This is the PRODUCTION version - optimized and minified.
    echo.
    echo Users should:
    echo   1. Make sure Node.js is installed (https://nodejs.org/)
    echo   2. Extract the ZIP file
    echo   3. Double-click SERVE.bat
    echo   4. Browser opens automatically at http://localhost:3000
    echo.
    echo What's included:
    echo   ✓ Pre-built production version (build/ folder)
    echo   ✓ SERVE.bat (startup script with Node.js detection)
    echo   ✓ README.md (simple production instructions)
    echo.
    echo What's NOT included:
    echo   ✗ Source code (not needed)
    echo   ✗ node_modules (not needed)
    echo   ✗ docs folder (not needed)
    echo.
    echo ========================================================
    echo.
    goto :end
) else (
    color 0C
    echo.
    echo ========================================================
    echo  ERROR: Failed to create production ZIP
    echo ========================================================
    echo.
    pause
    exit /b 1
)

:end
pause
