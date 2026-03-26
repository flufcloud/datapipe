Write-Host "Starting DataPipe services (orchestrator, execution-engine, web)..." -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "..")

# Start execution-engine
Write-Host "`n[1/3] Starting execution-engine on http://127.0.0.1:4001"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"`$PSScriptRoot/../apps/execution-engine`"; npm install; npm start"

# Start orchestrator
Write-Host "`n[2/3] Starting orchestrator on http://127.0.0.1:4000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"`$PSScriptRoot/../apps/orchestrator`"; mix setup; mix phx.server"

# Start web
Write-Host "`n[3/3] Starting web dev server (Vite)"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"`$PSScriptRoot/../apps/web`"; npm install; npm run dev"

Write-Host "`nAll DataPipe dev services are starting." -ForegroundColor Green
Write-Host "Once Vite finishes booting, open:" -ForegroundColor Green
Write-Host "  http://127.0.0.1:5173" -ForegroundColor Yellow
