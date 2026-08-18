param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$PidFile = Join-Path $RuntimeDir "platform.pid"
$PortFile = Join-Path $RuntimeDir "platform.port"
$BasePort = 4190

function Test-Health([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
    return $health.status -in @("ok", "degraded") -and $health.database -eq "SQLite"
  } catch { return $false }
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
  foreach ($candidate in @("C:\Program Files\nodejs\node.exe", "E:\nodejs\node.exe")) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
  return $null
}

function Open-Platform([int]$Port) {
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port/" }
}

Write-Host "NTU AI Medical Agent Evaluation Platform - MVP2" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

foreach ($port in $BasePort..($BasePort + 9)) {
  if (Test-Health $port) {
    Write-Host "Platform is already running on port $port." -ForegroundColor Green
    Open-Platform $port
    exit 0
  }
}

$NodeExe = Find-Node
if (-not $NodeExe) {
  Write-Host "Node.js 20 or later is required." -ForegroundColor Red
  Write-Host "Install Node.js from https://nodejs.org and try again."
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "Dependencies are missing. Run 'npm install' in the MVP2 folder first." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "dist\client\index.html"))) {
  $NpmExe = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $NpmExe) { throw "npm.cmd was not found." }
  Write-Host "Preparing the production interface for first launch..."
  $build = Start-Process -FilePath $NpmExe -ArgumentList @("run", "build") -WorkingDirectory $ProjectRoot -Wait -PassThru -NoNewWindow
  if ($build.ExitCode -ne 0) { Read-Host "Build failed. Press Enter to close"; exit 1 }
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$ServerScript = Join-Path $ProjectRoot "scripts\serve.mjs"
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $NodeExe
$startInfo.Arguments = '"' + $ServerScript + '" ' + $BasePort
$startInfo.WorkingDirectory = $ProjectRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$process = [System.Diagnostics.Process]::Start($startInfo)
$process.Id | Set-Content -LiteralPath $PidFile -Encoding ASCII

$readyPort = $null
for ($attempt = 1; $attempt -le 80; $attempt++) {
  Start-Sleep -Milliseconds 500
  foreach ($port in $BasePort..($BasePort + 9)) { if (Test-Health $port) { $readyPort = $port; break } }
  if ($readyPort -or $process.HasExited) { break }
}

if (-not $readyPort) {
  Write-Host "The platform did not start. Run 'npm start -- 4190' for detailed output." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$readyPort | Set-Content -LiteralPath $PortFile -Encoding ASCII
Write-Host "Ready: http://127.0.0.1:$readyPort/" -ForegroundColor Green
Open-Platform $readyPort
exit 0
