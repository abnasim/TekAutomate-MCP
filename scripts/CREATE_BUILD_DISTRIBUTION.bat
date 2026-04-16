@echo off
color 0B
title TekAutomate - Create Build Distribution
echo ========================================================
echo  TekAutomate - Create Build Distribution
echo ========================================================
echo.
echo This creates a MINIMAL distribution with just the
echo pre-built app. Users only need Node.js to run it.
echo.
echo NO npm install required - just run TekAutomate.bat
echo.

REM Change to project root directory
cd /d "%~dp0.."

REM Check if build folder exists
if not exist "build\index.html" (
    color 0E
    echo Build folder not found. Building now...
    echo.
    call npm run build
    if %ERRORLEVEL% NEQ 0 (
        color 0C
        echo BUILD FAILED!
        pause
        exit /b 1
    )
)

set ZIPNAME=TekAutomate_v2.0.4_prebuilt.zip

REM Remove old ZIP if exists
if exist "%ZIPNAME%" (
    echo Removing old ZIP file...
    del /Q "%ZIPNAME%"
)

echo.
echo Creating minimal distribution ZIP...
echo.

REM Create a temporary PowerShell script
echo $ErrorActionPreference = 'Stop' > "%TEMP%\create_zip.ps1"
echo $rootPath = '%CD%' >> "%TEMP%\create_zip.ps1"
echo $zipPath = Join-Path $rootPath '%ZIPNAME%' >> "%TEMP%\create_zip.ps1"
echo. >> "%TEMP%\create_zip.ps1"
echo try { >> "%TEMP%\create_zip.ps1"
echo     Write-Host 'Adding files to ZIP...' >> "%TEMP%\create_zip.ps1"
echo     $tempZip = $zipPath + '.tmp' >> "%TEMP%\create_zip.ps1"
echo     if (Test-Path $tempZip) { Remove-Item $tempZip -Force } >> "%TEMP%\create_zip.ps1"
echo     Add-Type -AssemblyName System.IO.Compression.FileSystem >> "%TEMP%\create_zip.ps1"
echo     $zip = [System.IO.Compression.ZipFile]::Open($tempZip, 'Create') >> "%TEMP%\create_zip.ps1"
echo. >> "%TEMP%\create_zip.ps1"
echo     # Add build folder >> "%TEMP%\create_zip.ps1"
echo     $buildPath = Join-Path $rootPath 'build' >> "%TEMP%\create_zip.ps1"
echo     $buildFiles = Get-ChildItem -Path $buildPath -Recurse -File >> "%TEMP%\create_zip.ps1"
echo     foreach ($file in $buildFiles) { >> "%TEMP%\create_zip.ps1"
echo         $relPath = 'build/' + $file.FullName.Substring($buildPath.Length + 1).Replace('\', '/') >> "%TEMP%\create_zip.ps1"
echo         $entry = $zip.CreateEntry($relPath) >> "%TEMP%\create_zip.ps1"
echo         $entryStream = $entry.Open() >> "%TEMP%\create_zip.ps1"
echo         $fileStream = [System.IO.File]::OpenRead($file.FullName) >> "%TEMP%\create_zip.ps1"
echo         $fileStream.CopyTo($entryStream) >> "%TEMP%\create_zip.ps1"
echo         $fileStream.Close() >> "%TEMP%\create_zip.ps1"
echo         $entryStream.Close() >> "%TEMP%\create_zip.ps1"
echo     } >> "%TEMP%\create_zip.ps1"
echo     Write-Host "  Added $($buildFiles.Count) files from build/" >> "%TEMP%\create_zip.ps1"
echo. >> "%TEMP%\create_zip.ps1"
echo     # Add examples folder >> "%TEMP%\create_zip.ps1"
echo     $examplesPath = Join-Path $rootPath 'examples' >> "%TEMP%\create_zip.ps1"
echo     if (Test-Path $examplesPath) { >> "%TEMP%\create_zip.ps1"
echo         $exampleFiles = Get-ChildItem -Path $examplesPath -Recurse -File >> "%TEMP%\create_zip.ps1"
echo         foreach ($file in $exampleFiles) { >> "%TEMP%\create_zip.ps1"
echo             $relPath = 'examples/' + $file.FullName.Substring($examplesPath.Length + 1).Replace('\', '/') >> "%TEMP%\create_zip.ps1"
echo             $entry = $zip.CreateEntry($relPath) >> "%TEMP%\create_zip.ps1"
echo             $entryStream = $entry.Open() >> "%TEMP%\create_zip.ps1"
echo             $fileStream = [System.IO.File]::OpenRead($file.FullName) >> "%TEMP%\create_zip.ps1"
echo             $fileStream.CopyTo($entryStream) >> "%TEMP%\create_zip.ps1"
echo             $fileStream.Close() >> "%TEMP%\create_zip.ps1"
echo             $entryStream.Close() >> "%TEMP%\create_zip.ps1"
echo         } >> "%TEMP%\create_zip.ps1"
echo         Write-Host "  Added $($exampleFiles.Count) files from examples/" >> "%TEMP%\create_zip.ps1"
echo     } >> "%TEMP%\create_zip.ps1"
echo. >> "%TEMP%\create_zip.ps1"
echo     # Add startup scripts and README >> "%TEMP%\create_zip.ps1"
echo     $extraFiles = @('TekAutomate.bat', 'TekAutomate.sh', 'README.md') >> "%TEMP%\create_zip.ps1"
echo     foreach ($script in $extraFiles) { >> "%TEMP%\create_zip.ps1"
echo         $scriptPath = Join-Path $rootPath $script >> "%TEMP%\create_zip.ps1"
echo         if (Test-Path $scriptPath) { >> "%TEMP%\create_zip.ps1"
echo             $entry = $zip.CreateEntry($script) >> "%TEMP%\create_zip.ps1"
echo             $entryStream = $entry.Open() >> "%TEMP%\create_zip.ps1"
echo             $fileStream = [System.IO.File]::OpenRead($scriptPath) >> "%TEMP%\create_zip.ps1"
echo             $fileStream.CopyTo($entryStream) >> "%TEMP%\create_zip.ps1"
echo             $fileStream.Close() >> "%TEMP%\create_zip.ps1"
echo             $entryStream.Close() >> "%TEMP%\create_zip.ps1"
echo             Write-Host "  Added $script" >> "%TEMP%\create_zip.ps1"
echo         } >> "%TEMP%\create_zip.ps1"
echo     } >> "%TEMP%\create_zip.ps1"
echo. >> "%TEMP%\create_zip.ps1"
echo     $zip.Dispose() >> "%TEMP%\create_zip.ps1"
echo     Move-Item $tempZip $zipPath -Force >> "%TEMP%\create_zip.ps1"
echo     $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2) >> "%TEMP%\create_zip.ps1"
echo     Write-Host '' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '========================================================' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '  SUCCESS!' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '========================================================' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '' >> "%TEMP%\create_zip.ps1"
echo     Write-Host "Created: $zipPath" >> "%TEMP%\create_zip.ps1"
echo     Write-Host "Size: $sizeMB MB" >> "%TEMP%\create_zip.ps1"
echo     Write-Host '' >> "%TEMP%\create_zip.ps1"
echo     Write-Host 'Contents:' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '  - build/ (pre-compiled app)' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '  - examples/ (sample workflows)' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '  - TekAutomate.bat (Windows)' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '  - TekAutomate.sh (macOS)' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '  - README.md' >> "%TEMP%\create_zip.ps1"
echo     Write-Host '' >> "%TEMP%\create_zip.ps1"
echo     Write-Host 'Users just need Node.js installed, then run TekAutomate.bat' >> "%TEMP%\create_zip.ps1"
echo     exit 0 >> "%TEMP%\create_zip.ps1"
echo } catch { >> "%TEMP%\create_zip.ps1"
echo     Write-Host "ERROR: $_" >> "%TEMP%\create_zip.ps1"
echo     exit 1 >> "%TEMP%\create_zip.ps1"
echo } >> "%TEMP%\create_zip.ps1"

REM Run the PowerShell script
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\create_zip.ps1"

if %ERRORLEVEL% EQU 0 (
    color 0A
    echo.
    echo Done!
) else (
    color 0C
    echo.
    echo Failed to create ZIP.
)

REM Cleanup
del "%TEMP%\create_zip.ps1" 2>nul

pause
