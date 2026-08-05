@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Build Win11 Optimizer

echo.
echo  ====================================
echo   Building Win11 Optimizer Package
echo  ====================================
echo.

cd /d "%~dp0ui"
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)

echo  [1/8] Verifying configuration copies...
fc /b "..\config\schema.json" "public\schema.json" >nul
if errorlevel 1 (
    echo  Schema copies do not match.
    set "exitCode=!errorlevel!"
    goto :fail
)
for %%P in (conservative balanced extreme) do (
    fc /b "..\config\presets\%%P.json" "public\presets\%%P.json" >nul
    if errorlevel 1 (
        echo  Preset copies do not match: %%P
        set "exitCode=!errorlevel!"
        goto :fail
    )
)
echo.

echo  [2/8] Installing dependencies...
call npm ci
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  [3/8] Building static web UI...
call npm run build
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  [4/8] Running tests...
call npm run test
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  [5/8] Linting sources...
call npm run lint
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  [6/8] Checking TypeScript...
call npx tsc --noEmit --incremental false
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  [7/8] Creating Electron portable executable...
if exist "..\build-electron" rmdir /s /q "..\build-electron"
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
if exist "..\dist" rmdir /s /q "..\dist"
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
call npm run package
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
echo.

echo  [8/8] Publishing single-file release...
if not exist "..\build-electron\Win11Optimizer.exe" (
    echo  Packaged executable was not created.
    set "exitCode=1"
    goto :fail
)
mkdir "..\dist"
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
copy /Y "..\build-electron\Win11Optimizer.exe" "..\dist\Win11Optimizer.exe" >nul
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)
for %%F in ("..\dist\Win11Optimizer.exe") do set "artifactSize=%%~zF"
for /f "usebackq delims=" %%H in (`powershell.exe -NoLogo -NoProfile -NonInteractive -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '..\dist\Win11Optimizer.exe').Hash"`) do set "artifactHash=%%H"
if not defined artifactHash (
    echo  Unable to calculate the executable SHA-256 hash.
    set "exitCode=1"
    goto :fail
)
rmdir /s /q "..\build-electron"
if errorlevel 1 (
    set "exitCode=!errorlevel!"
    goto :fail
)

echo.
echo  ====================================
echo   Build complete!
echo   Output: dist\Win11Optimizer.exe
echo   Size: !artifactSize! bytes
echo   SHA-256: !artifactHash!
echo  ====================================
echo.
endlocal & exit /b 0

:fail
if not defined exitCode set "exitCode=1"
echo.
echo  Build failed with exit code !exitCode!.
endlocal & exit /b %exitCode%
