@echo off
setlocal
cd /d "%~dp0"
echo Dafeiyu Plus automated tests
echo Project: %CD%
echo.
rem A completion marker distinguishes PASS from an interrupted PowerShell run.
set "DAFEIYU_TEST_COMPLETE_FLAG=%TEMP%\dafeiyu-test-completed-%RANDOM%-%RANDOM%.txt"
if exist "%DAFEIYU_TEST_COMPLETE_FLAG%" del "%DAFEIYU_TEST_COMPLETE_FLAG%" >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tests.ps1"
set "RC=%ERRORLEVEL%"
if not exist "%DAFEIYU_TEST_COMPLETE_FLAG%" (
  echo TEST RUN WAS INTERRUPTED BEFORE THE FINAL SUMMARY.
  set "RC=1"
) else (
  findstr /x /c:"PASS" "%DAFEIYU_TEST_COMPLETE_FLAG%" >nul 2>&1
  if errorlevel 1 set "RC=1"
  del "%DAFEIYU_TEST_COMPLETE_FLAG%" >nul 2>&1
)
echo.
if "%RC%"=="0" (
  echo ALL TESTS PASSED.
) else (
  echo SOME TESTS FAILED OR WERE SKIPPED.
  echo Review the log path printed above.
)
echo.
pause
exit /b %RC%
