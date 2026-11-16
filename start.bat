@echo off
REM Quick launcher for Video Frame Studio.
REM Double-click this file (or run `start.bat`) to start the player.

cd /d "%~dp0"

REM Install dependencies on first run if node_modules is missing.
if not exist "node_modules" (
    echo Installing dependencies for the first time...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Please check your Node.js / network setup.
        pause
        exit /b 1
    )
)

echo Starting Video Frame Studio...
call npm start
