@echo off
setlocal
title NTU AI Medical Evaluation Platform - First-time Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\first-time-setup.ps1"
if errorlevel 1 pause
endlocal
