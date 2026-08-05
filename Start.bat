@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Windows 11 Gaming Optimizer

echo.
echo  ====================================
echo   Windows 11 Gaming Optimizer
echo  ====================================
echo.

cd /d "%~dp0ui"
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)

set "PORT=3108"

if not exist "node_modules" (
    echo  Installing dependencies...
    call npm ci
    if errorlevel 1 (
        set "exitCode=!errorlevel!"
        goto :fail
    )
    echo.
)

echo  Building current web UI sources...
call npm run build
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  Starting the local development preview.
echo  System changes are permanently disabled in development mode.
echo  Press Ctrl+C to stop.
echo.
node server.js
set "exitCode=!errorlevel!"
if not "!exitCode!"=="0" goto :fail

endlocal & exit /b 0

:fail
if not defined exitCode set "exitCode=1"
echo.
echo  Startup failed with exit code !exitCode!.
endlocal & exit /b %exitCode%
