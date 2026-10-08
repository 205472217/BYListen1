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

if not exist "ffmpeg\ffmpeg.exe" (
    echo [ERROR] ffmpeg\ffmpeg.exe not found
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

if exist "dist\win-unpacked" copy /Y "ffmpeg\ffmpeg.exe" "dist\win-unpacked\ffmpeg.exe" >nul
copy /Y "ffmpeg\ffmpeg.exe" "dist\ffmpeg.exe" >nul

echo.
echo ============================================
echo  Build finished, installers are in "dist" folder
echo ============================================
pause
exit /b 0
