Set-Location 'C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator'
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  SCPI-Validation' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''
npm run test:scpi
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  DONE: SCPI-Validation' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor DarkGray
Read-Host 'Press Enter to close'
