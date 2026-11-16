@echo off
setlocal
set "UID_TO_CHECK=%~1"
set "CAPTURE_SECONDS=%~2"
if "%CAPTURE_SECONDS%"=="" set "CAPTURE_SECONDS=90"
echo This tool captures process names, PID/parent PID and safe DSH/DM status only.
echo During the next %CAPTURE_SECONDS% seconds, reproduce the black window or image test.
echo It does NOT capture command lines, screenshots, keys, or message bodies.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0抓取窗口与私信视觉诊断.ps1" -Uid "%UID_TO_CHECK%" -Seconds %CAPTURE_SECONDS%
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo Capture failed. Exit code %RC%.
pause
exit /b %RC%
