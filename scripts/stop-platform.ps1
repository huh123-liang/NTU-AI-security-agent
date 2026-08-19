$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$InstanceFile = Join-Path $RuntimeDir "platform-instance.json"
$PidFile = Join-Path $RuntimeDir "platform.pid"
$PortFile = Join-Path $RuntimeDir "platform.port"

if (-not (Test-Path -LiteralPath $InstanceFile)) {
  Write-Host "No saved platform process was found." -ForegroundColor Yellow
  exit 0
}

try { $instance = Get-Content -LiteralPath $InstanceFile -Raw -Encoding UTF8 | ConvertFrom-Json }
catch { Write-Host "The runtime identity is invalid; no process was stopped." -ForegroundColor Yellow; exit 1 }

if ([string]$instance.projectRoot -ne $ProjectRoot) {
  Write-Host "The runtime identity belongs to another project; no process was stopped." -ForegroundColor Yellow
  exit 1
}

$SavedPid = [int]$instance.processId
$SavedPort = [int]$instance.port
$process = Get-Process -Id $SavedPid -ErrorAction SilentlyContinue
$verified = $false
if ($process -and $process.ProcessName -eq "node") {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$SavedPort/api/v1/health" -TimeoutSec 2
    $verified = $health.runtime -and [string]$health.runtime.instanceId -eq [string]$instance.instanceId -and [int]$health.runtime.processId -eq $SavedPid -and [string]$health.runtime.projectRoot -eq $ProjectRoot
  } catch { $verified = $false }
}

if ($verified) {
  Stop-Process -Id $SavedPid -Force
  Write-Host "Verified platform instance stopped." -ForegroundColor Green
} elseif (-not $process) {
  Write-Host "The recorded platform process is no longer running." -ForegroundColor Yellow
} else {
  Write-Host "The process identity could not be verified; it was not stopped." -ForegroundColor Yellow
  exit 1
}

Remove-Item -LiteralPath $InstanceFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PortFile -Force -ErrorAction SilentlyContinue
