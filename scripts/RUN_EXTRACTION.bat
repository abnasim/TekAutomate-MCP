@echo off
echo ========================================
echo SCPI Command Extraction Script
echo ========================================
echo.

REM Check if PDF exists
if not exist "4-5-6_MSO_Programmer_077189801_RevA.pdf" (
    echo ERROR: PDF file not found!
    echo.
    echo Please place the PDF file in the project root:
    echo   4-5-6_MSO_Programmer_077189801_RevA.pdf
    echo.
    pause
    exit /b 1
)

echo PDF file found. Starting extraction...
echo.

REM Run the enhanced extraction script
python scripts/extract_scpi_enhanced.py

echo.
echo ========================================
echo Extraction complete!
echo ========================================
echo.
echo Output file: mso_commands_enhanced.json
echo.
pause










