@echo off
color 0B
echo ========================================================
echo  Tek Automator - Verify Distribution ZIP
echo ========================================================
echo.

REM Change to project root directory
cd /d "%~dp0.."

REM Find the ZIP file
for %%I in (.) do set FOLDERNAME=%%~nxI
set ZIPNAME=%FOLDERNAME%_v1.0.zip

if not exist "%ZIPNAME%" (
    color 0C
    echo ERROR: ZIP file not found!
    echo Expected: %ZIPNAME%
    echo.
    echo Please run CREATE_DISTRIBUTION.bat first.
    pause
    exit /b 1
)

echo Found ZIP file: %ZIPNAME%
echo.
echo Analyzing ZIP contents...
echo.

REM Use PowerShell to list ZIP contents
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop'; " ^
    "$zipPath = Join-Path '%CD%' '%ZIPNAME%'; " ^
    "try { " ^
    "  Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
    "  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath); " ^
    "  $allEntries = $zip.Entries; " ^
    "  $totalFiles = $allEntries.Count; " ^
    "  Write-Host \"Total files in ZIP: $totalFiles\"; " ^
    "  Write-Host ''; " ^
    "  Write-Host 'Checking critical folders:'; " ^
    "  Write-Host ''; " ^
    "  $commands = $allEntries | Where-Object { $_.FullName -like 'public/commands/*' -and $_.Name -ne '' }; " ^
    "  $templates = $allEntries | Where-Object { $_.FullName -like 'public/templates/*' -and $_.Name -ne '' }; " ^
    "  $src = $allEntries | Where-Object { $_.FullName -like 'src/*' -and $_.Name -ne '' }; " ^
    "  Write-Host \"public/commands/: $($commands.Count) files\"; " ^
    "  if ($commands.Count -gt 0) { " ^
    "    foreach ($cmd in $commands) { Write-Host \"  - $($cmd.Name)\" } " ^
    "  } else { " ^
    "    Write-Host '  WARNING: No command files found!' -ForegroundColor Red " ^
    "  }; " ^
    "  Write-Host ''; " ^
    "  Write-Host \"public/templates/: $($templates.Count) files\"; " ^
    "  if ($templates.Count -gt 0) { " ^
    "    foreach ($tpl in $templates) { Write-Host \"  - $($tpl.Name)\" } " ^
    "  } else { " ^
    "    Write-Host '  WARNING: No template files found!' -ForegroundColor Red " ^
    "  }; " ^
    "  Write-Host ''; " ^
    "  Write-Host \"src/: $($src.Count) files\"; " ^
    "  Write-Host ''; " ^
    "  $hasSetup = $allEntries | Where-Object { $_.Name -eq 'setup.bat' }; " ^
    "  $hasStart = $allEntries | Where-Object { $_.Name -eq 'start.bat' }; " ^
    "  $hasPackageJson = $allEntries | Where-Object { $_.Name -eq 'package.json' }; " ^
    "  Write-Host 'Critical files:'; " ^
    "  if ($hasSetup) { Write-Host '  ✓ setup.bat' -ForegroundColor Green } else { Write-Host '  ✗ setup.bat MISSING!' -ForegroundColor Red }; " ^
    "  if ($hasStart) { Write-Host '  ✓ start.bat' -ForegroundColor Green } else { Write-Host '  ✗ start.bat MISSING!' -ForegroundColor Red }; " ^
    "  if ($hasPackageJson) { Write-Host '  ✓ package.json' -ForegroundColor Green } else { Write-Host '  ✗ package.json MISSING!' -ForegroundColor Red }; " ^
    "  Write-Host ''; " ^
    "  $zip.Dispose(); " ^
    "  if ($commands.Count -gt 0 -and $templates.Count -gt 0 -and $hasSetup -and $hasStart -and $hasPackageJson) { " ^
    "    Write-Host '========================================================'; " ^
    "    Write-Host '  ZIP VERIFICATION PASSED!' -ForegroundColor Green; " ^
    "    Write-Host '========================================================'; " ^
    "    Write-Host ''; " ^
    "    Write-Host 'All critical files and folders are present.'; " ^
    "    Write-Host 'The ZIP is ready for distribution.'; " ^
    "  } else { " ^
    "    Write-Host '========================================================'; " ^
    "    Write-Host '  ZIP VERIFICATION FAILED!' -ForegroundColor Red; " ^
    "    Write-Host '========================================================'; " ^
    "    Write-Host ''; " ^
    "    Write-Host 'Some critical files or folders are missing.'; " ^
    "    Write-Host 'Please recreate the ZIP using CREATE_DISTRIBUTION.bat'; " ^
    "  }; " ^
    "  exit 0 " ^
    "} catch { " ^
    "  Write-Host ''; " ^
    "  Write-Host 'ERROR: ' $_.Exception.Message -ForegroundColor Red; " ^
    "  exit 1 " ^
    "}"

echo.
pause

