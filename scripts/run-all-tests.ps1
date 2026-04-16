$root = "C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator"
$scriptsDir = "$root\scripts\tabs"

# Create the tabs folder if it doesn't exist
if (-not (Test-Path $scriptsDir)) { New-Item -ItemType Directory -Path $scriptsDir | Out-Null }

# Helper: write a tab script file
function Write-Tab {
    param([string]$Name, [string]$Body)
    $file = "$scriptsDir\$Name.ps1"
    Set-Content -Path $file -Value @"
Set-Location '$root'
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  $Name' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''
$Body
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  DONE: $Name' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor DarkGray
Read-Host 'Press Enter to close'
"@
    return $file
}

# Write one file per tab
Write-Tab "Dev-Server"       "npm start"
Write-Tab "Unit-Tests"       "npm test"
Write-Tab "SCPI-Validation"  "npm run test:scpi"
Write-Tab "SCPI-Schema"      "npm run test:scpi-schema"
Write-Tab "Python-Validate"  "npm run test:python-validate"
Write-Tab "Product-13k"      "npm run test:product"
Write-Tab "Param-Pipeline"   "npm run test:param-pipeline"
Write-Tab "Regression-E2E"   "Write-Host 'Waiting 35s for dev server...' -ForegroundColor Yellow; Start-Sleep 35; npm run test:regression"
Write-Tab "Full-E2E"         "Write-Host 'Waiting 35s for dev server...' -ForegroundColor Yellow; Start-Sleep 35; npm run test:e2e"

# Build the wt argument list  (first tab uses no keyword, rest use "; new-tab")
$tabs = @(
    "new-tab --title `"Dev Server`"      -- powershell.exe -NoExit -File `"$scriptsDir\Dev-Server.ps1`"",
    "new-tab --title `"Unit Tests`"      -- powershell.exe -NoExit -File `"$scriptsDir\Unit-Tests.ps1`"",
    "new-tab --title `"SCPI Validation`" -- powershell.exe -NoExit -File `"$scriptsDir\SCPI-Validation.ps1`"",
    "new-tab --title `"SCPI Schema`"     -- powershell.exe -NoExit -File `"$scriptsDir\SCPI-Schema.ps1`"",
    "new-tab --title `"Python Validate`" -- powershell.exe -NoExit -File `"$scriptsDir\Python-Validate.ps1`"",
    "new-tab --title `"Product 13k`"     -- powershell.exe -NoExit -File `"$scriptsDir\Product-13k.ps1`"",
    "new-tab --title `"Param Pipeline`"  -- powershell.exe -NoExit -File `"$scriptsDir\Param-Pipeline.ps1`"",
    "new-tab --title `"Regression E2E`"  -- powershell.exe -NoExit -File `"$scriptsDir\Regression-E2E.ps1`"",
    "new-tab --title `"Full E2E`"        -- powershell.exe -NoExit -File `"$scriptsDir\Full-E2E.ps1`""
)

$wtArgs = $tabs -join " ; "

Write-Host "Launching Windows Terminal with all test tabs..." -ForegroundColor Cyan
Start-Process wt -ArgumentList $wtArgs
