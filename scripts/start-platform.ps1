param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$InstanceFile = Join-Path $RuntimeDir "platform-instance.json"
$PidFile = Join-Path $RuntimeDir "platform.pid"
$PortFile = Join-Path $RuntimeDir "platform.port"
$OutputLog = Join-Path $RuntimeDir "platform.log"
$ErrorLog = Join-Path $RuntimeDir "platform-error.log"
$BasePort = 4190

function Get-Health([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(220)) { return $null }
    $client.EndConnect($pending)
  } catch { return $null }
  finally { $client.Dispose() }
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 2
    if ($health.status -in @("ok", "degraded") -and $health.database -eq "SQLite") { return $health }
    return $null
  } catch { return $null }
}

function Get-ManagedInstance {
  if (-not (Test-Path -LiteralPath $InstanceFile)) { return $null }
  try {
    $instance = Get-Content -LiteralPath $InstanceFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $instance.instanceId -or -not $instance.processId -or -not $instance.port) { return $null }
    if ([string]$instance.projectRoot -ne $ProjectRoot) { return $null }
    $process = Get-Process -Id ([int]$instance.processId) -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -ne "node") { return $null }
    $health = Get-Health ([int]$instance.port)
    if (-not $health -or -not $health.runtime) { return $null }
    if ([string]$health.runtime.instanceId -ne [string]$instance.instanceId) { return $null }
    if ([int]$health.runtime.processId -ne [int]$instance.processId) { return $null }
    if ([string]$health.runtime.projectRoot -ne $ProjectRoot) { return $null }
    return $instance
  } catch { return $null }
}

function Remove-StaleRuntimeIdentity {
  foreach ($file in @($InstanceFile, $PidFile, $PortFile)) {
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  }
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
  foreach ($candidate in @(
    (Join-Path $ProjectRoot ".runtime\node\node.exe"),
    "C:\Program Files\nodejs\node.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
    "E:\nodejs\node.exe"
  )) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
  return $null
}

function Find-Npm([string]$NodeExe) {
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
  $nextToNode = Join-Path (Split-Path -Parent $NodeExe) "npm.cmd"
  if (Test-Path -LiteralPath $nextToNode) { return $nextToNode }
  return $null
}

function Test-BuildRequired {
  $distIndex = Join-Path $ProjectRoot "dist\client\index.html"
  if (-not (Test-Path -LiteralPath $distIndex)) { return $true }
  $builtAt = (Get-Item -LiteralPath $distIndex).LastWriteTimeUtc
  $inputs = @(
    (Join-Path $ProjectRoot "src"),
    (Join-Path $ProjectRoot "index.html"),
    (Join-Path $ProjectRoot "vite.config.mjs"),
    (Join-Path $ProjectRoot "package.json")
  )
  foreach ($inputPath in $inputs) {
    if (-not (Test-Path -LiteralPath $inputPath)) { continue }
    $item = Get-Item -LiteralPath $inputPath
    if (-not $item.PSIsContainer -and $item.LastWriteTimeUtc -gt $builtAt) { return $true }
    if ($item.PSIsContainer) {
      $newer = Get-ChildItem -LiteralPath $inputPath -Recurse -File | Where-Object { $_.LastWriteTimeUtc -gt $builtAt } | Select-Object -First 1
      if ($newer) { return $true }
    }
  }
  return $false
}

function Open-Platform([int]$Port) {
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port/" }
}

Write-Host "NTU AI Medical Agent Evaluation Platform - MVP2" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$managedInstance = Get-ManagedInstance
if ($managedInstance) {
  Write-Host "Verified platform instance is already running on port $($managedInstance.port)." -ForegroundColor Green
  Open-Platform ([int]$managedInstance.port)
  exit 0
}

if ((Test-Path -LiteralPath $InstanceFile) -or (Test-Path -LiteralPath $PidFile) -or (Test-Path -LiteralPath $PortFile)) {
  Write-Host "Removing stale runtime records; unknown services will not be reused." -ForegroundColor Yellow
}
Remove-StaleRuntimeIdentity

$NodeExe = Find-Node
if (-not $NodeExe) {
  Write-Host "Node.js 20 or later is required." -ForegroundColor Red
  Write-Host "Install Node.js from https://nodejs.org and try again."
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "Dependencies are missing from the MVP2 folder." -ForegroundColor Yellow
  Write-Host "Keep the supplied node_modules folder with the project, or run npm install once."
  Read-Host "Press Enter to close"
  exit 1
}

if (Test-BuildRequired) {
  $NpmExe = Find-Npm $NodeExe
  if (-not $NpmExe) {
    Write-Host "npm.cmd was not found, so the updated interface cannot be prepared." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
  Write-Host "Preparing the latest production interface..."
  $build = Start-Process -FilePath $NpmExe -ArgumentList @("run", "build") -WorkingDirectory $ProjectRoot -Wait -PassThru -NoNewWindow
  if ($build.ExitCode -ne 0) { Read-Host "Build failed. Press Enter to close"; exit 1 }
}

$ServerScript = Join-Path $ProjectRoot "scripts\serve.mjs"
if (-not (Test-Path -LiteralPath $ServerScript)) { throw "Server entry point is missing: $ServerScript" }
# Use a path relative to WorkingDirectory so spaces in the project path cannot split the Node argument.
$process = Start-Process -FilePath $NodeExe -ArgumentList @("scripts\serve.mjs", [string]$BasePort) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $OutputLog -RedirectStandardError $ErrorLog -PassThru

$readyPort = $null
for ($attempt = 1; $attempt -le 80; $attempt++) {
  Start-Sleep -Milliseconds 500
  foreach ($port in $BasePort..($BasePort + 9)) {
    $health = Get-Health $port
    if ($health -and $health.runtime -and [int]$health.runtime.processId -eq $process.Id -and [string]$health.runtime.projectRoot -eq $ProjectRoot) {
      $readyPort = $port
      break
    }
  }
  if ($readyPort -or $process.HasExited) { break }
}

if (-not $readyPort) {
  Write-Host "The platform did not start." -ForegroundColor Red
  if (Test-Path -LiteralPath $ErrorLog) {
    Write-Host "Last diagnostic messages:" -ForegroundColor Yellow
    Get-Content -LiteralPath $ErrorLog -Tail 12
  }
  Write-Host "Full log: $ErrorLog"
  Remove-StaleRuntimeIdentity
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "Ready: http://127.0.0.1:$readyPort/" -ForegroundColor Green
if ($health.modelConfigured) {
  Write-Host "$($health.activeModels) active model configuration(s) available. Credentials are stored locally." -ForegroundColor Green
} else {
  Write-Host "No active model credential is configured yet." -ForegroundColor Yellow
  Write-Host "The interface will open. Sign in as Admin and use Model registry to add or test a provider."
}
Open-Platform $readyPort
exit 0
