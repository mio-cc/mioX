@echo off
rem ============================================================
rem  ARTEX one-click local launcher (Windows)
rem  1) If the backend is already listening on :8787, just open the browser.
rem  2) If 127.0.0.1:5433 is not listening, start local PostgreSQL
rem     compatible server PGlite (data: .localrun\pgdata-pglite).
rem  3) Launch artex.exe through start.bat (UI embedded, :8787).
rem  4) Open http://localhost:8787 in the browser.
rem  Login is OFF by default (config.json auth.disabled=true).
rem  Close the "ARTEX-SERVER" window to stop the backend.
rem ============================================================
setlocal
cd /d "%~dp0"

set "PORT=5433"
set "API=8787"
set "DB_DIR=%~dp0.localrun\pglite"

rem --- 0) already running? then only open the browser ---
netstat -ano | findstr ":%API% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
	echo [artex] backend already running on %API% - opening browser
	start "" http://localhost:%API%
	exit /b 0
)

rem --- 1) database ---
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
	echo [artex] local database already listening on %PORT%
	goto db_ready
)

if not exist "%DB_DIR%\server.mjs" (
	echo [artex] missing %DB_DIR%\server.mjs
	pause
	exit /b 1
)

echo [artex] starting local database PGlite on %PORT% ...
start "ARTEX-DB" /min /d "%DB_DIR%" cmd /c node server.mjs

set /a tries=0
:wait_db
set /a tries+=1
ping -n 2 127.0.0.1 >nul 2>&1
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto db_ready
if %tries% lss 30 goto wait_db
echo [artex] database did not start in 30s - check the ARTEX-DB window.
pause
exit /b 1

:db_ready
rem --- 2) backend (frontend embedded) ---
echo [artex] starting backend on :%API% ...
start "ARTEX-SERVER" /d "%~dp0" cmd /c start.bat

rem --- 3) browser ---
ping -n 6 127.0.0.1 >nul 2>&1
start "" http://localhost:%API%

echo.
echo [artex] up at http://localhost:%API%  (login disabled by default)
echo.
endlocal
