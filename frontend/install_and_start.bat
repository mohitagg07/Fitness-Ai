@echo off
echo.
echo ====================================================
echo   FitAI Frontend - Clean Install ^& Start
echo ====================================================
echo.

REM Step 1: Delete broken installs
echo [1/4] Cleaning old node_modules and lock files...
if exist node_modules (
    rmdir /s /q node_modules
    echo       Deleted node_modules
)
if exist package-lock.json (
    del /f package-lock.json
    echo       Deleted package-lock.json
)
if exist .expo (
    rmdir /s /q .expo
    echo       Deleted .expo cache
)
echo       Done.
echo.

REM Step 2: Install with legacy peer deps (safest for RN projects)
echo [2/4] Installing packages...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. Check your internet connection.
    pause
    exit /b 1
)
echo       Done.
echo.

REM Step 3: Verify expo is installed locally
echo [3/4] Verifying expo installation...
if not exist node_modules\.bin\expo.cmd (
    echo ERROR: expo not found in node_modules. Something went wrong.
    pause
    exit /b 1
)
echo       expo found in node_modules/.bin
echo.

REM Step 4: Start using LOCAL expo (not npx)
echo [4/4] Starting Expo dev server...
echo.
echo       Use the LOCAL expo binary - NOT npx expo start
echo.
call node_modules\.bin\expo start --clear
