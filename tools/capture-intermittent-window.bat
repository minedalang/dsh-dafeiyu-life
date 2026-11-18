@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "DURATION=%~1"
if not defined DURATION set "DURATION=900"
echo Event-based process-start trace. Reproduce the intermittent black console window while this runs.
echo Captures ONLY time, process name, PID, parent PID and trace source.
echo NO command lines, window titles, messages, images, cookies or keys.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture-intermittent-window.ps1" -Seconds "%DURATION%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo Capture failed with code %RC%.
pause
exit /b %RC%
