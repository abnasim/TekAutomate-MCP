@echo off
REM Run on PC WITH internet. Downloads wheels for Python 3.11 64-bit (scope).
REM Copy scope-executor folder to scope, run run.bat there.

cd /d "%~dp0"
if not exist "offline_wheels" mkdir offline_wheels

echo Downloading wheels for Python 3.11 64-bit ^(scope^)...
echo.
py -3 -m pip download -r requirements.txt -d offline_wheels --python-version 311 --platform win_amd64 --only-binary=:all:
if errorlevel 1 (
    echo Main download failed. Trying without --only-binary...
    py -3 -m pip download -r requirements.txt -d offline_wheels --python-version 311 --platform win_amd64
)
echo.
echo Downloading Pillow, libusb-package, qrcode...
py -3 -m pip download Pillow libusb-package qrcode -d offline_wheels --python-version 311 --platform win_amd64 --only-binary=:all:
if errorlevel 1 (
    py -3 -m pip download Pillow libusb-package qrcode -d offline_wheels --python-version 311 --platform win_amd64
)
echo.
echo Done. Copy scope-executor folder to scope, run run.bat.
pause
