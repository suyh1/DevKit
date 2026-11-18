@echo off
setlocal
title DevKit Source Preview
pushd "%~dp0" || exit /b 1

node -e "process.exit(Number(process.versions.node.split('.')[0]) < 24 ? 1 : 0)" >nul 2>&1
if errorlevel 1 (
    echo Install Node.js 24 or newer and make sure it is available on PATH.
    goto failed
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo npm was not found on PATH. Check your Node.js installation.
    goto failed
)

node -e "require.resolve('vite'); require.resolve('typescript'); require('electron')" >nul 2>&1
if errorlevel 1 (
    echo Installing project dependencies...
    call npm.cmd ci --include=dev
    if errorlevel 1 goto failed
)

echo Building DevKit from the current source...
call npm.cmd run desktop -- --preview
if errorlevel 1 goto failed
popd
exit /b 0

:failed
echo.
echo DevKit preview could not start. See the message above.
popd
pause
exit /b 1
