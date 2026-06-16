# FitAI Frontend — Setup (Windows)

## What went wrong

Running `npx expo start` when expo is not installed locally causes npm to fetch
the LATEST expo (currently v56), which is incompatible with this project.
Never use bare `npx expo` — always use the local binary after installing.

---

## Correct Steps (Windows)

### Option A — Double-click (easiest)

1. Extract this zip anywhere (e.g. Desktop)
2. Double-click `install_and_start.bat`
3. Done.

---

### Option B — Command Prompt manually

Open Command Prompt inside the `frontend` folder:

    Step 1 - Clean everything:
    rmdir /s /q node_modules
    del package-lock.json

    Step 2 - Install:
    npm install --legacy-peer-deps

    Step 3 - Start (use LOCAL expo, NOT npx):
    node_modules\.bin\expo start --clear

DO NOT run "npx expo start" — it downloads expo v56 and breaks everything.

---

### Option C — npm start (after install)

Once installed, just run:
    npm start

The package.json scripts use the local expo automatically.

---

## Connecting to Backend

Edit the .env file:

    For PC/Web:
    EXPO_PUBLIC_API_URL=http://localhost:8000/api

    For Android emulator:
    EXPO_PUBLIC_API_URL=http://10.0.2.2:8000/api

    For physical phone (find your IP with: ipconfig):
    EXPO_PUBLIC_API_URL=http://192.168.X.X:8000/api

---

## Common Errors

"Cannot determine the project's Expo SDK version"
  -> You used npx expo without installing first.
  -> Fix: npm install --legacy-peer-deps, then node_modules\.bin\expo start

"ERESOLVE unable to resolve dependency tree"
  -> Always use: npm install --legacy-peer-deps

"Network error / Connection refused"
  -> Backend not running, or wrong IP in .env

"Module not found"
  -> Delete node_modules and .expo, then reinstall
