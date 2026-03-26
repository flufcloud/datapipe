param(
  [switch] $SkipBuild
)

Write-Host "Running DataPipe verification..."

Push-Location "apps/orchestrator"
Write-Host "`n[1/3] mix test (orchestrator)"
mix test
if ($LASTEXITCODE -ne 0) {
  Write-Error "Orchestrator tests failed."
  Pop-Location
  exit $LASTEXITCODE
}
Pop-Location

Push-Location "apps/execution-engine"
Write-Host "`n[2/3] npm test (execution-engine)"
npm test
if ($LASTEXITCODE -ne 0) {
  Write-Error "Execution-engine tests failed."
  Pop-Location
  exit $LASTEXITCODE
}
Pop-Location

Push-Location "apps/web"
Write-Host "`n[3/3] npm test (web)"
npm test
if ($LASTEXITCODE -ne 0) {
  Write-Error "Web tests failed."
  Pop-Location
  exit $LASTEXITCODE
}

if (-not $SkipBuild) {
  Write-Host "`n[3b/3b] npm run build (web)"
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Web production build failed."
    Pop-Location
    exit $LASTEXITCODE
  }
}

Pop-Location

Write-Host "`nDataPipe verification completed successfully." -ForegroundColor Green
