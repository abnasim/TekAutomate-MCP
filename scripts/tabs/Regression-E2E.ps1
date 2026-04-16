Set-Location 'C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator'
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  Regression-E2E' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Waiting 35s for dev server...' -ForegroundColor Yellow; Start-Sleep 35; npm run test:regression
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  DONE: Regression-E2E' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor DarkGray
Read-Host 'Press Enter to close'
