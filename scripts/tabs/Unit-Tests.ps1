Set-Location 'C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator'
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  Unit-Tests' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''
npm test
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  DONE: Unit-Tests' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor DarkGray
Read-Host 'Press Enter to close'
