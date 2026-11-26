VYRN mobile app
===============

The maintained Expo application lives in this folder. The repository root README is the source of truth for the full backend, database and product setup.

Local development
-----------------

1. Use Node.js 20.19.4 (pinned in the repository's .nvmrc).
2. Install the locked dependencies:

   npm ci

3. Copy the environment template:

   Windows PowerShell:
     Copy-Item .env.example .env

   macOS / Linux:
     cp .env.example .env

4. Set EXPO_PUBLIC_API_URL in .env. Use the address that is reachable from the device:
   - iOS Simulator / local web: http://localhost:8000/api
   - Android Emulator: http://10.0.2.2:8000/api
   - Physical phone: http://YOUR_LAPTOP_LAN_IP:8000/api (same Wi-Fi; allow port 8000 through the firewall)

5. Start the FastAPI backend from the backend folder in a separate terminal. Configure Supabase and Groq credentials first.
6. Start Expo:

   npx expo start --clear

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

Do this only after the backend HTTPS URL is verified and the project has passed local checks. A JavaScript export is not a native installable build. Test the downloaded APK on a physical Android phone before distribution.

Important
---------

- Do not delete package-lock.json; use npm ci for reproducible installs.
- Do not change the EAS project ID or app identifiers without an explicit migration plan.
- Never put backend secrets in EXPO_PUBLIC_* variables.
- Camera-based exercise tracking is not part of the current baseline.
