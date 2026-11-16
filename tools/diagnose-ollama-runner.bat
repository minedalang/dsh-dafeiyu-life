@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnose-ollama-runner.ps1"
if errorlevel 1 echo Diagnostic could not complete. Check PowerShell 5.1 and Ollama log permissions.
endlocal
