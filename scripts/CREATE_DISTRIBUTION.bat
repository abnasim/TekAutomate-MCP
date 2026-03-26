@echo off
color 0B
title TekAutomate - Create Development Distribution
echo ========================================================
echo  TekAutomate - Create Development Distribution
echo ========================================================
echo.
echo This creates a DEVELOPMENT MODE distribution where users
echo will run 'npm start' (development server).
echo.
echo This will create a clean distribution ZIP file
echo WITHOUT node_modules (users will install via SETUP.bat)
echo.
echo For PRODUCTION BUILD, use: CREATE_PRODUCTION_BUILD.bat
echo.

REM Change to project root directory
cd /d "%~dp0.."

REM Get current folder name for ZIP file name
for %%I in (.) do set FOLDERNAME=%%~nxI
set ZIPNAME=TekAutomate_v2.0.4.zip

REM Remove old ZIP if exists
if exist "%ZIPNAME%" (
    echo Removing old ZIP file...
    del /Q "%ZIPNAME%"
)

echo.
echo Creating distribution ZIP...
echo This may take a moment...
echo.

REM Use PowerShell to create ZIP with proper folder structure preservation
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; " ^
    "$zipPath = Join-Path '%CD%' '%ZIPNAME%'; " ^
    "$rootPath = '%CD%'; " ^
    "try { " ^
    "  Write-Host 'Collecting files and preserving folder structure...'; " ^
    "  Write-Host ''; " ^
    "  $excludeDirs = @('node_modules', 'logs', 'build', '.git', '.vscode', '.idea', '.cursor', 'scripts', 'backups', 'TekAcademy_Export', 'dist', '.venv', 'extra'); " ^
    "  $excludeFiles = @('App1.0.tsx', 'App2.0.tsx', 'App3.0.tsx', 'App4.0.tsx', 'App5.0.tsx', 'App6.0.tsx', 'App7.0.tsx', 'App8.0.tsx', 'App9.0.tsx', 'App10.1.tsx', 'App10.2.tsx', 'test_gpt_prompt.txt', 'test_device_context_fix.py', 'extract-academy.js', 'CUSTOM_GPT_INSTRUCTIONS.txt', 'CUSTOM_GPT_INSTRUCTIONS_BLOCKLY.txt', 'GENERATOR_FIXES_NEEDED.md', 'xml_comparison.md'); " ^
    "  $allFiles = Get-ChildItem -Path $rootPath -Recurse -File | Where-Object { " ^
    "    $relPath = $_.FullName.Substring($rootPath.Length + 1); " ^
    "    $exclude = $false; " ^
    "    foreach ($dir in $excludeDirs) { " ^
    "      if ($relPath -like $dir + '\*' -or $relPath -like $dir) { $exclude = $true; break } " ^
    "    }; " ^
    "    if ($_.Name -in $excludeFiles) { $exclude = $true }; " ^
    "    if ($_.Name -like '*.zip') { $exclude = $true }; " ^
    "    -not $exclude " ^
    "  }; " ^
    "  $fileCount = $allFiles.Count; " ^
    "  Write-Host \"Found $fileCount files to include\"; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Key folders being included:'; " ^
    "  $commandsCount = ($allFiles | Where-Object { $_.FullName -like '*\public\commands\*' }).Count; " ^
    "  $templatesCount = ($allFiles | Where-Object { $_.FullName -like '*\public\templates\*' }).Count; " ^
    "  $helperCount = ($allFiles | Where-Object { $_.FullName -like '*\helper\*' }).Count; " ^
    "  Write-Host \"  - public/commands: $commandsCount files\"; " ^
    "  Write-Host \"  - public/templates: $templatesCount files\"; " ^
    "  Write-Host \"  - helper (raw socket utils): $helperCount files\"; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Creating ZIP file with proper folder structure...'; " ^
    "  $tempZip = $zipPath + '.tmp'; " ^
    "  if (Test-Path $tempZip) { Remove-Item $tempZip -Force }; " ^
    "  Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
    "  $zip = [System.IO.Compression.ZipFile]::Open($tempZip, 'Create'); " ^
    "  $progress = 0; " ^
    "  foreach ($file in $allFiles) { " ^
    "    $relPath = $file.FullName.Substring($rootPath.Length + 1).Replace('\', '/'); " ^
    "    $entry = $zip.CreateEntry($relPath); " ^
    "    $entryStream = $entry.Open(); " ^
    "    $fileStream = [System.IO.File]::OpenRead($file.FullName); " ^
    "    $fileStream.CopyTo($entryStream); " ^
    "    $fileStream.Close(); " ^
    "    $entryStream.Close(); " ^
    "    $progress++; " ^
    "    if ($progress %% 10 -eq 0) { Write-Host \"  Added $progress / $fileCount files...\" } " ^
    "  }; " ^
    "  $zip.Dispose(); " ^
    "  Move-Item $tempZip $zipPath -Force; " ^
    "  $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2); " ^
    "  Write-Host ''; " ^
    "  Write-Host '========================================================'; " ^
    "  Write-Host '  SUCCESS!'; " ^
    "  Write-Host '========================================================'; " ^
    "  Write-Host ''; " ^
    "  Write-Host \"Distribution ZIP created: $zipPath\"; " ^
    "  Write-Host \"Size: $sizeMB MB\"; " ^
    "  Write-Host \"Files included: $fileCount\"; " ^
    "  Write-Host \"  - Commands: $commandsCount JSON files\"; " ^
    "  Write-Host \"  - Templates: $templatesCount JSON files\"; " ^
    "  Write-Host \"  - Helper utilities: $helperCount files\"; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Excluded:'; " ^
    "  Write-Host '  - node_modules folder'; " ^
    "  Write-Host '  - logs folder'; " ^
    "  Write-Host '  - Old App version files (App1.0.tsx - App10.2.tsx)'; " ^
    "  Write-Host ''; " ^
    "  exit 0 " ^
    "} catch { " ^
    "  Write-Host ''; " ^
    "  Write-Host 'ERROR: ' $_.Exception.Message; " ^
    "  exit 1 " ^
    "}"

REM Check if ZIP file was actually created (this is the real check)
if exist "%ZIPNAME%" (
    color 0A
    echo.
    echo ========================================================
    echo  Distribution ZIP Created Successfully!
    echo ========================================================
    echo.
    echo The ZIP preserves the exact folder structure.
    echo Users should:
    echo   1. Extract the ZIP file (maintains folder structure)
    echo   2. Run SETUP.bat to install dependencies
    echo   3. Run START.bat to launch the application
    echo.
    goto :end
) else (
    color 0C
    echo.
    echo ========================================================
    echo  ERROR: Failed to create ZIP file
    echo ========================================================
    echo.
    echo Troubleshooting:
    echo   1. Make sure you have write permissions
    echo   2. Close any programs using the ZIP file
    echo   3. Try running as Administrator
    echo.
    goto :end
)

:end
pause
