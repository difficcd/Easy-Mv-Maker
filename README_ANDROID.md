# Easy MV Maker (Galaxy Tab / Android Release)

This folder packages the existing Vite/React app as an Android app using Capacitor.

## Prereqs
- Node.js (same as dev)
- Android Studio + Android SDK (for building APK/AAB)

## Commands
```bash
npm install

# already initialized in this folder:
# - capacitor.config.json exists
# - android/ platform is added

# Build web + sync into Android project
npm run android:sync

# Open in Android Studio
npm run android:open
```

## Release (AAB/APK)
Build via Android Studio:
- `Build > Generate Signed Bundle / APK`

## Notes
- Web output is in `dist/` and will be copied to `android/` by `npx cap sync`.
- If you need live reload on-device, use Capacitor `server.url` temporarily (do not ship with it).
