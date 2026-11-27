VYRN mobile app
===============

The maintained Expo application lives in this folder. The repository root README is the source of truth for the full backend, database and product setup.

Local development
-----------------

1. Use Node.js 20.19.4 (pinned in the repository .nvmrc).
2. Install the exact committed dependencies:

   npm ci

3. Copy the environment template:

   Windows PowerShell:
     Copy-Item .env.example .env

   macOS / Linux:
     cp .env.example .env

4. The template defaults to the deployed HTTPS API:
   https://neurofit-ai-backend.onrender.com/api

   This works from Expo Go and physical phones. For a local backend, replace
   EXPO_PUBLIC_API_URL in .env with the address reachable from your device:
   - Android Emulator: http://10.0.2.2:8000/api
   - iOS Simulator / local web: http://localhost:8000/api
   - Physical phone on the same Wi-Fi: http://YOUR_LAPTOP_LAN_IP:8000/api

   Never use localhost from a physical phone; localhost refers to the phone.
   For a local backend on a physical phone, allow port 8000 through the laptop
   firewall. Restart Expo after changing .env so the public variable is rebuilt.

5. To run your own backend, start FastAPI from the backend folder and configure
   Supabase/Groq credentials there. The mobile app never needs backend secrets.

6. Start Expo:

   npm run start

   The normal start preserves Metro's cache. Use this only when troubleshooting
   a stale bundler cache:

   npm run start:clear

Checks
-----

   npm run typecheck
   npx expo install --check
   npx expo-doctor
   npx expo export --platform android --output-dir .expo-export-android
   npx expo export --platform ios --output-dir .expo-export-ios

Native builds
-------------

The EAS preview profile creates an internal Android APK:

   eas login
   eas build --platform android --profile preview

The preview and production profiles use the hosted HTTPS API URL. A JavaScript
export is not a native installable build. Install the APK on a physical Android
phone and verify login, onboarding, dashboard, workouts, notifications, and
the optional 3D recovery view before distributing it.

Important
---------

- Do not delete package-lock.json; use npm ci for reproducible installs.
- Do not change the EAS project ID, URI scheme, or app identifiers without an
  explicit migration plan.
- Never put backend secrets in EXPO_PUBLIC_* variables.
- The Render Free API may cold-start after inactivity; production latency
  requires an always-on backend compute plan.
- Camera-based exercise tracking is not part of the current baseline.
