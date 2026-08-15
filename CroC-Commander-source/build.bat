@echo off
rem croc-commander — build Windows portable .exe
cd /d "%~dp0"

echo ==^> Installing dependencies
call npm install
if errorlevel 1 exit /b 1

echo ==^> Building Windows portable executable
call npm run build:win
if errorlevel 1 exit /b 1

echo.
echo ==^> Done. Artifact in dist\croc-commander-*.exe
dir /b dist\croc-commander-*.exe
