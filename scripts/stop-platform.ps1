$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile = Join-Path $RuntimeDir "platform.pid"
$PortFile = Join-Path $RuntimeDir "platform.port"

if (-not (Test-Path -LiteralPath $PidFile)) {
  Write-Host "No saved platform process was found." -ForegroundColor Yellow
  exit 0
}

$SavedPid = [int](Get-Content -LiteralPath $PidFile -Raw)
$process = Get-Process -Id $SavedPid -ErrorAction SilentlyContinue

if ($process) {
  Stop-Process -Id $SavedPid -Force
  Write-Host "Platform stopped." -ForegroundColor Green
} else {
  Write-Host "The saved platform process is no longer running." -ForegroundColor Yellow
}

Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PortFile -Force -ErrorAction SilentlyContinue
