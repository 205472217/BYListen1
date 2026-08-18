@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo  Listen1 Windows x64 build script
echo ============================================

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found, please install Node.js 14+ first
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found, please check your Node.js installation
    pause
    exit /b 1
)

echo.
echo [1/2] Installing dependencies: npm install ...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)

echo.
echo [2/2] Building Windows x64 package ...
call npm run dist:win64
if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Build finished, installers are in "dist" folder
echo ============================================
pause
exit /b 0
