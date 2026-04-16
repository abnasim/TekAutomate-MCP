@echo off
cd /d "%~dp0"
title Tek Automate Executor
color 0A

echo ============================================
echo   Tek Automate Executor - Launcher
echo ============================================
echo.

:: If .venv exists, verify it is Python 3.10+
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -c "import sys;exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1 && (
        echo [OK] .venv found (Python 3.10+)
        goto :check_packages
    )
    echo [WARN] .venv is broken or too old - rebuilding...
    rmdir /s /q .venv >nul 2>&1
)

:: .venv does not exist - create it.
:: Priority: bundled python311 first, then system Python as fallback.
:: Everything runs inside .venv. System Python is never modified.

:: Method 1: Bundled Python 3.11
if exist "python311\python.exe" (
    echo [OK] Using bundled Python 3.11
    echo [SETUP] Creating .venv...
    "python311\python.exe" -m virtualenv .venv --quiet && (
        echo [OK] .venv created from bundled Python
        goto :check_packages
    )
    echo [WARN] Bundled virtualenv failed, trying system Python...
)

:: Method 2: System Python fallback
set "PY="

where py >nul 2>&1 && (
    for /f "tokens=*" %%i in ('py -3.11 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%i"
)
if defined PY goto :create_venv_system

where py >nul 2>&1 && (
    for /f "tokens=*" %%i in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%i"
)
if defined PY goto :create_venv_system

where py >nul 2>&1 && (
    for /f "tokens=*" %%i in ('py -3.10 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%i"
)
if defined PY goto :create_venv_system

if exist "C:\Python311\python.exe" set "PY=C:\Python311\python.exe" & goto :create_venv_system
if exist "C:\Python312\python.exe" set "PY=C:\Python312\python.exe" & goto :create_venv_system
if exist "C:\Python310\python.exe" set "PY=C:\Python310\python.exe" & goto :create_venv_system
if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe" & goto :create_venv_system
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe" & goto :create_venv_system
if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python310\python.exe" & goto :create_venv_system
if exist "%PROGRAMFILES%\Python311\python.exe" set "PY=%PROGRAMFILES%\Python311\python.exe" & goto :create_venv_system
if exist "%PROGRAMFILES%\Python312\python.exe" set "PY=%PROGRAMFILES%\Python312\python.exe" & goto :create_venv_system

echo.
echo [ERROR] No bundled python311 folder and no system Python 3.10+ found!
echo.
pause
exit /b 1

:create_venv_system
echo [OK] System Python: %PY%
echo [SETUP] Creating .venv...
"%PY%" -m venv .venv || (
    echo [WARN] Retrying with --clear...
    "%PY%" -m venv --clear .venv || (
        echo [ERROR] Cannot create .venv.
        pause
        exit /b 1
    )
)
echo [OK] .venv created

:check_packages
if not exist ".venv\.packages_installed" (
    echo [SETUP] Installing packages into .venv...
    if exist "offline_wheels" (
        echo [SETUP] Using offline wheels...
        ".venv\Scripts\python.exe" -m pip install --quiet --no-index --find-links offline_wheels pyvisa pyvisa-py tm_devices tekhsi qrcode Pillow TKinterModernThemes pystray && (
            echo ok> ".venv\.packages_installed"
            echo [OK] Packages installed from offline wheels
            goto :launch
        )
        echo [WARN] Offline install incomplete, trying online...
    )
    ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
    ".venv\Scripts\python.exe" -m pip install --quiet pyvisa pyvisa-py tm_devices tekhsi qrcode Pillow TKinterModernThemes pystray && (
        echo ok> ".venv\.packages_installed"
    )
    echo [OK] Packages ready
)

echo.

:launch
if exist ".venv\Scripts\pythonw.exe" (
    echo [OK] Launching executor from source (.venv)...
    start "" ".venv\Scripts\pythonw.exe" executor.py
    goto :eof
)

if exist ".venv\Scripts\python.exe" (
    echo [OK] Launching executor from source (.venv)...
    start "" ".venv\Scripts\python.exe" executor.py
    goto :eof
)

if exist "dist\TekAutomateExecutor.exe" (
    echo [WARN] .venv launcher missing, falling back to packaged EXE...
    start "" "dist\TekAutomateExecutor.exe"
) else (
    echo [ERROR] No runnable executor found.
    pause
    exit /b 1
)
