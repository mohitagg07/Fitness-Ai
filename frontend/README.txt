VYRN FIX PACKAGE
=================

This zip mirrors your frontend/ folder structure so you can drop files
straight in. One filename had to be renamed to avoid clashing on
extraction (Windows/zip tools won't let two files both be named
"_layout.tsx" sit in the same flat listing) — see step 2 below.

WHERE EACH FILE GOES (relative to C:\Users\mohit\Desktop\fitai\frontend\):

1. app.json
   -> frontend\app.json   (REPLACE existing file)

2. app\_layout.tsx
   -> frontend\app\_layout.tsx   (REPLACE existing file)
   This is the ROOT layout. It must be a Stack, not a Tabs navigator.

3. app\tabs-group-layout.tsx
   -> RENAME to _layout.tsx, then place at:
      frontend\app\(tabs)\_layout.tsx   (REPLACE existing file)
   This is the layout for the (tabs) route group — this is where the
   "hide all tabs from the bar" logic belongs.

4. assets\icon.png
   -> frontend\assets\icon.png

5. assets\adaptive-icon.png
   -> frontend\assets\adaptive-icon.png

6. assets\splash.png
   -> frontend\assets\splash.png

7. assets\favicon.png
   -> frontend\assets\favicon.png

AFTER COPYING ALL FILES IN:

   cd C:\Users\mohit\Desktop\fitai\frontend
   npx expo prebuild --clean
   eas build -p android --profile preview

WHY THIS FIXES IT:
- Your root app/_layout.tsx had accidentally been overwritten with the
  Tabs-navigator code meant for app/(tabs)/_layout.tsx. That broke
  routing entirely (root layout conflicted with the (tabs) group),
  causing the infinite spinner after the splash screen.
- app.json had icon/splash/adaptive-icon/favicon fields pointing at
  deleted PNGs, so the build had no app icon. The new PNGs are
  generated from assets/branding/logo-mark.png (your green "V" mark)
  on a black background.
