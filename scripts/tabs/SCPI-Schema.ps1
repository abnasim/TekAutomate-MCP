Set-Location 'C:\Users\u650455\Desktop\Tek_Automator\Tek_Automator'
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  SCPI-Schema' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host ''
npm run test:scpi-schema
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
Write-Host '  DONE: SCPI-Schema' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor DarkGray
Read-Host 'Press Enter to close'
