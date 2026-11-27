@echo off
setlocal EnableExtensions
pushd "%~dp0"

echo.
echo ====================================================
echo   VYRN Mobile - Install ^& Start
echo ====================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on PATH.
  echo Install the version pinned in the repository .nvmrc file.
  popd
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is not available on PATH.
  popd
  exit /b 1
)

if not exist package-lock.json (
  echo ERROR: frontend/package-lock.json is missing.
  echo Restore it from Git before installing. Do not regenerate it casually.
  popd
  exit /b 1
)

if not exist .env (
  if exist .env.example (
    copy /Y .env.example .env >nul
    echo Created .env from .env.example. Verify EXPO_PUBLIC_API_URL before testing.
  )
)

if not exist node_modules\.bin\expo.cmd (
  echo Installing exact locked dependencies with npm ci...
  call npm ci
  if errorlevel 1 (
    echo ERROR: npm ci failed. Check the npm output above.
    popd
    exit /b 1
  )
) else (
  echo Existing locked dependency install found.
)

if not exist node_modules\.bin\expo.cmd (
  echo ERROR: Expo CLI was not installed. Run npm ci and inspect the error.
  popd
  exit /b 1
)

echo.
echo Starting Expo. Use --clear only when you need to reset Metro's cache.
echo.
call npm run start -- %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
