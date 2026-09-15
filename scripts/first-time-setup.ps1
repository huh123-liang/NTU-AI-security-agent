param(
  [switch]$NonInteractive,
  [switch]$NoLaunch,
  [switch]$ForceDependencyInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvFile = Join-Path $ProjectRoot ".env.local"
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$StatusFile = Join-Path $RuntimeDir "setup-status.json"

function Write-Step([int]$Number, [string]$Title) {
  Write-Host ""
  Write-Host "[$Number/5] $Title" -ForegroundColor Cyan
}

function Read-YesNo([string]$Prompt, [bool]$DefaultYes = $true) {
  if ($NonInteractive) { return $DefaultYes }
  $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
  $answer = (Read-Host "$Prompt $suffix").Trim()
  if (-not $answer) { return $DefaultYes }
  return $answer -match "^[Yy]"
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
  foreach ($candidate in @(
    "C:\Program Files\nodejs\node.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Find-Npm([string]$NodeExe) {
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
  $candidate = Join-Path (Split-Path -Parent $NodeExe) "npm.cmd"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return $null
}

function Find-Python {
  $command = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }
  foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe")
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Test-KeyConfigured {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $false }
  foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
    if ($line -match "^\s*(MODEL_API_KEY|DEEPSEEK_API_KEY)\s*=\s*(\S.+?)\s*$") { return $true }
  }
  return $false
}

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Write-ModelConfiguration([string]$ApiKey) {
  $content = @"
# Created by the MVP2 first-time setup wizard.
# This file is local-only and ignored by Git.
MODEL_PROVIDER=deepseek
MODEL_API_URL=https://api.deepseek.com
MODEL_NAME=deepseek-chat
MODEL_API_KEY=$ApiKey
MODEL_TIMEOUT_MS=90000
MODEL_MAX_ATTEMPTS=3
MODEL_RETRY_DELAY_MS=800
"@
  [IO.File]::WriteAllText($EnvFile, $content, (New-Object Text.UTF8Encoding($false)))
}

function Stop-WithMessage([string]$Message) {
  Write-Host ""
  Write-Host $Message -ForegroundColor Red
  Write-Host "No API key or patient database was uploaded anywhere." -ForegroundColor DarkGray
  if (-not $NonInteractive) { Read-Host "Press Enter to close" | Out-Null }
  exit 1
}

Clear-Host
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host " NTU AI Medical Agent Evaluation Platform - First-time Setup" -ForegroundColor White
Write-Host " AI医疗智能体评估平台 - 首次安装向导" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor DarkCyan
Write-Host "Project: $ProjectRoot"
Write-Host "This wizard installs local dependencies, configures the model backend,"
Write-Host "builds and tests the platform, then starts it. Your API key stays on this PC."

Write-Step 1 "Checking Node.js and Python / 检查 Node.js 与 Python"
$NodeExe = Find-Node
if (-not $NodeExe) {
  Write-Host "Node.js 20 or later is required but was not found." -ForegroundColor Yellow
  Write-Host "Install the LTS version from: https://nodejs.org/en/download"
  if (-not $NonInteractive -and (Read-YesNo "Open the Node.js download page now? / 是否打开下载页面？" $true)) {
    Start-Process "https://nodejs.org/en/download"
  }
  Stop-WithMessage "Install Node.js, then run this setup wizard again."
}

$NodeVersion = (& $NodeExe -p "process.versions.node").Trim()
$NodeMajor = [int]($NodeVersion.Split(".")[0])
if ($NodeMajor -lt 20) {
  Stop-WithMessage "Node.js $NodeVersion is too old. Install Node.js 20 or later, then run the wizard again."
}
$NpmExe = Find-Npm $NodeExe
if (-not $NpmExe) { Stop-WithMessage "npm.cmd was not found next to Node.js. Reinstall the Node.js LTS package." }
Write-Host "Node.js $NodeVersion detected." -ForegroundColor Green
$PythonExe = Find-Python
if (-not $PythonExe) {
  Write-Host "Python 3.10 or later is required for large hospital CSV preprocessing." -ForegroundColor Yellow
  Write-Host "Install Python from: https://www.python.org/downloads/windows/"
  if (-not $NonInteractive -and (Read-YesNo "Open the Python download page now? / 是否打开 Python 下载页面？" $true)) {
    Start-Process "https://www.python.org/downloads/windows/"
  }
  Stop-WithMessage "Install Python 3.10 or later, enable Add Python to PATH, then run this wizard again."
}
$PythonVersion = (& $PythonExe -c "import platform; print(platform.python_version())").Trim()
$PythonMajorMinor = $PythonVersion.Split(".")
if ([int]$PythonMajorMinor[0] -lt 3 -or ([int]$PythonMajorMinor[0] -eq 3 -and [int]$PythonMajorMinor[1] -lt 10)) {
  Stop-WithMessage "Python $PythonVersion is too old. Install Python 3.10 or later."
}
Write-Host "Python $PythonVersion detected for local hospital-data preprocessing." -ForegroundColor Green

Write-Step 2 "Installing project dependencies / 安装项目依赖"
$DependenciesMissing = -not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))
if ($DependenciesMissing -or $ForceDependencyInstall) {
  Write-Host "Running npm install. This can take several minutes on the first computer."
  & $NpmExe install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Dependency installation failed. Check the internet connection and npm access, then retry." }
  Write-Host "Dependencies installed." -ForegroundColor Green
} else {
  Write-Host "Dependencies are already installed; keeping the existing local copy." -ForegroundColor Green
}

Write-Step 3 "Configuring the starter model / 配置初始模型"
$KeyConfigured = Test-KeyConfigured
$KeepExisting = $KeyConfigured -and (Read-YesNo "A local model key is already configured. Keep it? / 保留现有配置？" $true)
if (-not $KeepExisting) {
  Write-Host "You may configure DeepSeek as the starter model. Input is hidden and saved only in .env.local." -ForegroundColor Yellow
  Write-Host "After launch, Admin > Model registry can add Qwen, OpenAI, GLM or another OpenAI-compatible endpoint."
  Write-Host "Press Enter without a key to run the interface without model generation."
  $ApiKey = if ($NonInteractive) { "" } else { Read-SecretText "DeepSeek API key (hidden)" }
  if ($ApiKey -and -not $ApiKey.StartsWith("sk-")) {
    Write-Host "The value does not use the usual sk- prefix. It will still be saved as entered." -ForegroundColor Yellow
  }
  Write-ModelConfiguration $ApiKey
  $KeyConfigured = [bool]$ApiKey
  $ApiKey = $null
  if ($KeyConfigured) {
    Write-Host "Model configuration saved locally. The key was not displayed or logged." -ForegroundColor Green
  } else {
    Write-Host "No key configured. The platform will work, but AI generation will remain unavailable." -ForegroundColor Yellow
  }
} else {
  Write-Host "Existing local model configuration retained without displaying or rewriting the key." -ForegroundColor Green
}

Write-Step 4 "Building and testing / 构建并测试"
& $NpmExe run build
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "The production build failed. Review the messages above and retry the wizard." }
& $NpmExe test
if ($LASTEXITCODE -ne 0) { Stop-WithMessage "Automated tests failed. The platform was not marked ready." }
Write-Host "Build and automated tests passed." -ForegroundColor Green

Write-Step 5 "Completing local setup / 完成本地配置"
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$status = [ordered]@{
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  projectRoot = $ProjectRoot
  nodeVersion = $NodeVersion
  pythonVersion = $PythonVersion
  modelProvider = "deepseek"
  modelKeyConfigured = [bool]$KeyConfigured
  buildVerified = $true
  testsVerified = $true
}
[IO.File]::WriteAllText($StatusFile, ($status | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Setup complete / 安装完成" -ForegroundColor Green
Write-Host "Local database: created automatically on first launch"
Write-Host "Bundled dataset: imported automatically on first launch"
Write-Host "Admin: admin@ntu-demo.local"
Write-Host "Demo password: 123"
Write-Host "Future launches: double-click 一键启动-AI医疗评估平台.cmd or the desktop shortcut."
Write-Host "Do not share .env.local or your API key." -ForegroundColor Yellow

if (-not $NoLaunch) {
  Write-Host ""
  Write-Host "Starting the platform..." -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "start-platform.ps1")
  exit $LASTEXITCODE
}

if (-not $NonInteractive) { Read-Host "Press Enter to close" | Out-Null }
exit 0
