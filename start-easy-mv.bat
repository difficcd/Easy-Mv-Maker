@echo off
title Easy MV Maker
cd /d "%~dp0"

echo ============================================
echo   Easy MV Maker  -  http://localhost:5175/
echo ============================================
echo.

rem If a server is already listening on 5175, just open the browser and exit.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo Server already running - opening browser...
  start "" http://localhost:5175/
  timeout /t 2 >nul
  exit /b
)

echo Starting server... (close this window to stop)
echo Tablet on same Wi-Fi: http://%COMPUTERNAME%:5175  (or the PC's LAN IP)
echo.

rem Open the browser a few seconds after the server starts.
start "" /min cmd /c "timeout /t 5 >nul & start "" http://localhost:5175/"

rem Start API (:8787) + web (:5175) together.
npx concurrently -k -n api,web -c green,cyan "node server/index.js" "vite --host --port 5175 --strictPort"

echo.
echo Server stopped. Press any key to close.
pause >nul
