@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "UID_TO_CHECK=%~1"
set "CAPTURE_SECONDS=%~2"
if not defined CAPTURE_SECONDS set "CAPTURE_SECONDS=90"
echo This tool collects only process names, PID, parent PID and safe DSH/DM status.
echo Reproduce the black window or image test during the next %CAPTURE_SECONDS% seconds.
echo No command lines, screenshots, keys, image data or private message bodies are collected.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture-window-dm-vision.ps1" -Uid "%UID_TO_CHECK%" -Seconds "%CAPTURE_SECONDS%"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo Capture failed. Exit code %RC%.
pause
exit /b %RC%
