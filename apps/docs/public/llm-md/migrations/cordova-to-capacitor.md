# Cordova → Capacitor

Source: https://kensaur.us/mushi-mushi/docs/migrations/cordova-to-capacitor

---
title: 'Cordova → Capacitor'
description: Migrate a Cordova app to Capacitor in place (same web code, a new native shell) and add Mushi Mushi bug reporting with @mushi-mushi/capacitor.
---

# Cordova → Capacitor

 

Capacitor, built by the Ionic team, is a successor to Cordova. This guide
migrates an existing Cordova app to Capacitor in place (same web codebase,
new native shell) and mounts Mushi Mushi with the `@mushi-mushi/capacitor`
plugin.

The official upstream guide is [capacitorjs.com/cordova](https://capacitorjs.com/cordova);
this page is the Mushi-aware companion to it.

## Why migrate

- Check whether the Cordova plugins you depend on are still maintained;
  most common ones have an official Capacitor counterpart (table below).
- Capacitor's native projects are first-class (`ios/`, `android/`): you
  commit them and edit them like any other Xcode / Android Studio project.
- Mushi has a Capacitor plugin ([`@mushi-mushi/capacitor`](/sdks/capacitor))
  with native shake-to-report and screenshot capture. There is no Mushi
  Cordova plugin; in a Cordova app you would have run `@mushi-mushi/web`
  inside the WebView.

## Prerequisites

- Working Cordova app that builds for at least one platform.
- For Capacitor 8: Node 22+, Xcode 26+ for iOS, Android Studio 2025.2.1+
  for Android ([environment setup](https://capacitorjs.com/docs/getting-started/environment-setup)).
- A Mushi project. If you already use `@mushi-mushi/web` in the Cordova
  app, keep the same `projectId` and `apiKey`.

## API mapping (Cordova plugins → Capacitor)

Most popular Cordova plugins have a 1:1 Capacitor counterpart:

| Cordova plugin | Capacitor equivalent |
|----------------|----------------------|
| `cordova-plugin-camera` | `@capacitor/camera` |
| `cordova-plugin-geolocation` | `@capacitor/geolocation` |
| `cordova-plugin-statusbar` | `@capacitor/status-bar` |
| `cordova-plugin-splashscreen` | `@capacitor/splash-screen` |
| `cordova-plugin-network-information` | `@capacitor/network` |
| `cordova-plugin-device` | `@capacitor/device` |
| `cordova-plugin-file` | `@capacitor/filesystem` |
| `cordova-plugin-inappbrowser` | `@capacitor/browser` |
| `cordova-plugin-clipboard` | `@capacitor/clipboard` |
| `cordova-plugin-vibration` | `@capacitor/haptics` |
| `cordova-plugin-share` | `@capacitor/share` |
| `cordova-plugin-firebase-messaging` | `@capacitor/push-notifications` + `@capacitor-firebase/messaging` |
| `cordova-sqlite-storage` | `@capacitor-community/sqlite` |
| `@mushi-mushi/web` in the WebView | `@mushi-mushi/capacitor` (adds native shake and screenshots) |

For anything not listed, search the [Capacitor Plugins](https://capacitorjs.com/docs/plugins)
catalog or the [Capawesome community plugins](https://capawesome.io/plugins/).

## Migration checklist

Capacitor edits a lot of files (`package.json`, native projects). Branch off so you can roll back cleanly.</>,

      id: 'install',
      label: 'Install Capacitor in the existing project',
      content: {`npm install @capacitor/cli @capacitor/core
npx cap init "" ""
# Use the App Name + Bundle ID from your Cordova config.xml
`},

      id: 'build',
      label: 'Build your web bundle once before adding platforms',
      content: {`npm run build
# Capacitor reads capacitor.config.json -> webDir to copy your web assets
# into the native projects on \`npx cap sync\`. Set webDir to "www", "dist",
# or whatever your build outputs.`},

      id: 'platforms',
      label: 'Add native platforms',
      content: {`npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`},

      id: 'assets',
      label: 'Regenerate splash screens and icons',
      content: {`npm install -D @capacitor/assets
npx @capacitor/assets generate --ios --android
# Replaces the old Cordova \`config.xml\` icon/splash declarations`},

      id: 'plugins',
      label: 'Replace Cordova plugins with Capacitor equivalents',
      content: <>Use the table above. After replacing each, run npx cap sync.</>,

      id: 'mushi',
      label: 'Add @mushi-mushi/capacitor',
      content: {`# If you ran @mushi-mushi/web in the Cordova WebView, remove its
# Mushi.init call; the Capacitor plugin replaces it.
npm install @mushi-mushi/capacitor
npx cap sync

# In src/main.ts (or wherever you bootstrap your app):

await Mushi.configure({
  projectId: 'YOUR_PROJECT_ID',  // same as before
  apiKey:    'YOUR_PUBLIC_KEY',  // same as before
  triggerMode: 'shake',
})`},

      id: 'permissions',
      label: 'Audit native permissions (`Info.plist`, `AndroidManifest.xml`)',
      content: <>Cordova merged permissions from config.xml at build time. Capacitor expects you to edit the native files directly. The iOS and Android docs list the keys for camera, location, push, etc.</>,

      id: 'deep-links',
      label: 'Re-wire deep links and custom URL schemes',
      content: <>Move from cordova-plugin-customurlscheme to @capacitor/app's App.addListener('appUrlOpen', ...) and Capacitor's native scheme config.</>,

      id: 'remove-cordova',
      label: 'Remove Cordova',
      content: {`# Once everything works on both platforms:
npm uninstall cordova cordova-android cordova-ios
rm -rf platforms plugins config.xml`},

      id: 'verify',
      label: 'Smoke-test on a device, including a Mushi report',
      optional: false,
      content: <>Open the app, trigger the Mushi widget (shake or tap), submit a test report, and confirm it appears on the Reports page of the Mushi admin console. Filter by SDK to see only the Capacitor build.</>,

/>

## Common gotchas

- **iOS scheme defaults changed.** Capacitor uses `capacitor://` by default
  on iOS. If your app stores anything under origin-bound web APIs
  (LocalStorage, cookies, IndexedDB), set `server.iosScheme: "ionic"` in
  `capacitor.config.json` to keep the origin Cordova used and avoid
  losing user data.
- **Splash hide timing.** `@capacitor/splash-screen` hides itself after
  `launchShowDuration` by default (`launchAutoHide: true`). To hide it
  when your app is ready instead, set `launchAutoHide: false` and call
  `SplashScreen.hide()` once your app is mounted.
- **`whitelist` plugin gone.** Capacitor uses native ATS (iOS) and
  `usesCleartextTraffic` (Android) instead of Cordova's whitelist. Add your
  Mushi endpoint and any other API hosts to those if you allow non-HTTPS.

## Rollback

You branched in step 1, so:

```bash
git checkout main
# Capacitor's ios/ and android/ projects were committed on the migration
# branch only, so main still has the Cordova app.
```

If you committed and pushed before discovering a regression, revert the
merge commit; Cordova builds will start working again immediately.

## Related guides

- [Capacitor → React Native](/migrations/capacitor-to-react-native), if you later want to move on from Capacitor.
- [`@mushi-mushi/capacitor` SDK reference](/sdks/capacitor)
- [Capacitor bottom-dock notes](/sdks/capacitor-bottom-dock): keep the Mushi widget above your tab bar.

## References

- [Capacitor: Cordova → Capacitor migration](https://capacitorjs.com/cordova)
- [Capacitor Plugins catalog](https://capacitorjs.com/docs/plugins)
- [Capawesome community plugins](https://capawesome.io/plugins/)
