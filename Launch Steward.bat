@echo off
cd /d "%~dp0"

:: Kill any previous instance on port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Start the server in a minimized background window
start "Steward Server" /min cmd /c "node server.js"

:: Wait a moment for server to bind
timeout /t 2 /nobreak >nul

:: Open the app in the default browser
start "" "http://localhost:3000"
