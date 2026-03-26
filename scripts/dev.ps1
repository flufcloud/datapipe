Param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "==> Starting execution engine on http://127.0.0.1:4001 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoLogo", "-NoExit", "-Command", "cd `"$PSScriptRoot\..\apps\execution-engine`"; npm install; npm start"

Write-Host "==> Starting orchestrator (Phoenix) on http://127.0.0.1:4000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoLogo", "-NoExit", "-Command", "cd `"$PSScriptRoot\..\apps\orchestrator`"; mix setup; mix phx.server"

Write-Host "==> Starting web app (Vite dev server) ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoLogo", "-NoExit", "-Command", "cd `"$PSScriptRoot\..\apps\web`"; npm install; npm run dev"

$url = "http://127.0.0.1:5173"
Write-Host "`nDataPipe is booting. Once Vite finishes compiling, open:" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Yellow

Write-Host "`nAll DataPipe dev services are starting." -ForegroundColor Green
