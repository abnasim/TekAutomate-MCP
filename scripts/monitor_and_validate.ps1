# Monitor extraction and run validation when complete
$jsonPath = "C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator\public\commands\mso_commands_final.json"
$validationScript = "C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator\scripts\validate_extraction.py"

Write-Host "`nMonitoring extraction progress..." -ForegroundColor Cyan
Write-Host "Checking every 30 seconds for completion...`n" -ForegroundColor Cyan

$maxWaitMinutes = 20
$checkIntervalSeconds = 30
$maxChecks = ($maxWaitMinutes * 60) / $checkIntervalSeconds

for ($i = 1; $i -le $maxChecks; $i++) {
    if (Test-Path $jsonPath) {
        $lastWrite = (Get-Item $jsonPath).LastWriteTime
        $age = (Get-Date) - $lastWrite
        
        # If file hasn't been modified in last 10 seconds, extraction is likely complete
        if ($age.TotalSeconds -gt 10) {
            Write-Host "`nExtraction complete!" -ForegroundColor Green
            Write-Host "Running validation script...`n" -ForegroundColor Yellow
            
            python $validationScript
            exit 0
        }
        else {
            Write-Host "[$i/$maxChecks] File still being written... (last modified $([int]$age.TotalSeconds)s ago)" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "[$i/$maxChecks] Waiting for output file..." -ForegroundColor Gray
    }
    
    Start-Sleep -Seconds $checkIntervalSeconds
}

Write-Host "`nTimeout reached. Check extraction manually." -ForegroundColor Red

