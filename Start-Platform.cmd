@echo off
setlocal
title NTU AI Medical Evaluation Platform
cd /d "%~dp0"
if not exist "%~dp0node_modules\" goto firstsetup
if not exist "%~dp0.env.local" goto firstsetup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-platform.ps1"
if errorlevel 1 pause
goto end
:firstsetup
echo First-time setup is required. Opening the setup wizard...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\first-time-setup.ps1"
if errorlevel 1 pause
:end
endlocal
