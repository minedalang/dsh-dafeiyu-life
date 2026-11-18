@echo off
setlocal EnableExtensions DisableDelayedExpansion
call "%~dp0capture-window-dm-vision.bat" %*
exit /b %ERRORLEVEL%
