# Cordova → Capacitor

Source: https://kensaur.us/mushi-mushi/docs/migrations/cordova-to-capacitor

---
title: 'Cordova → Capacitor'
---

# Cordova → Capacitor

 

Capacitor is the modern successor to Cordova from the same Ionic team.
This guide migrates an existing Cordova app to Capacitor in place — same
web codebase, new native shell — and re-mounts Mushi using the
`@mushi-mushi/capacitor` plugin.

The official upstream guide is [capacitorjs.com/cordova](https://capacitorjs.com/cordova);
this page is the Mushi-aware companion to it.

## Why migrate

- Cordova plugin maintenance has slowed considerably since 2023.
- Capacitor uses standard `WKWebView` / `WebView` instead of Cordova's
  managed shell — easier to debug, plays nicer with modern web platform
  features.
- Capacitor's native projects are first-class (`ios/`, `android/`) — you
  can edit them like any other Xcode / Android Studio project.
- Mushi ships a first-party Capacitor plugin
  ([`@mushi-mushi/capacitor`](/sdks/capacitor)); the Cordova SDK has been
  in maintenance mode since 0.5.

## Prerequisites

- Working Cordova app that builds for at least one platform.
- Node 18+ and the platform SDKs (Xcode 15+ for iOS, Android Studio Hedgehog+
  for Android).
- Mushi project already created — we keep the same `projectId` and `apiKey`.

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
| Mushi Cordova SDK *(deprecated)* | `@mushi-mushi/capacitor` |

For anything not listed, search the [Capacitor Plugins](https://capacitorjs.com/docs/plugins)
catalog or the [Capawesome community plugins](https://capawesome.io/plugins/).

## Migration checklist

Capacitor edits a lot of files (`package.json`, native projects). Branch off so you can roll back cleanly.</>,
    },
    {
      id: 'install',
      label: 'Install Capacitor in the existing project',
      content: {`npm install @capacitor/cli @capacitor/core
npx cap init "" ""
# Use the App Name + Bundle ID from your Cordova config.xml
`},
    },
    {
      id: 'build',
      label: 'Build your web bundle once before adding platforms',
      content: {`npm run build
# Capacitor reads capacitor.config.json -> webDir to copy your web assets
# into the native projects on \`npx cap sync\`. Set webDir to "www", "dist",
# or whatever your build outputs.`},
    },
    {
      id: 'platforms',
      label: 'Add native platforms',
      content: {`npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android`},
    },
    {
      id: 'assets',
      label: 'Regenerate splash screens and icons',
      content: {`npm install -D @capacitor/assets
npx @capacitor/assets generate --ios --android
# Replaces the old Cordova \`config.xml\` icon/splash declarations`},
    },
    {
      id: 'plugins',
      label: 'Replace Cordova plugins with Capacitor equivalents',
      content: <>Use the table above. After replacing each, run npx cap sync.</>,
    },
    {
      id: 'mushi',
      label: 'Swap the Mushi Cordova SDK for @mushi-mushi/capacitor',
      content: {`npm uninstall mushi-cordova-plugin
npm install @mushi-mushi/capacitor
npx cap sync

# In src/main.ts (or wherever you bootstrap your app):

await Mushi.configure({
  projectId: 'YOUR_PROJECT_ID',  // same as before
  apiKey:    'YOUR_PUBLIC_KEY',  // same as before
  triggerMode: 'shake',
})`},
    },
    {
      id: 'permissions',
      label: 'Audit native permissions (`Info.plist`, `AndroidManifest.xml`)',
      content: <>Cordova merged permissions from config.xml at build time. Capacitor expects you to edit the native files directly. The iOS and Android docs list the keys for camera, location, push, etc.</>,
    },
    {
      id: 'deep-links',
      label: 'Re-wire deep links and custom URL schemes',
      content: <>Move from cordova-plugin-customurlscheme to @capacitor/app's App.addListener('appUrlOpen', ...) and Capacitor's native scheme config.</>,
    },
    {
      id: 'remove-cordova',
      label: 'Remove Cordova',
      content: {`# Once everything works on both platforms:
npm uninstall cordova cordova-android cordova-ios
rm -rf platforms plugins config.xml`},
    },
    {
      id: 'verify',
      label: 'Smoke-test on a device, including a Mushi report',
      optional: false,
      content: <>Open the app, trigger the Mushi widget (shake or tap), submit a test report, and confirm it appears in Project → Reports on the Mushi admin console within ~5s. Tagged sdk:capacitor.</>,
    },
  ]}
/>

## Common gotchas

- **iOS scheme defaults changed.** Capacitor uses `capacitor://` by default;
  if your app stores anything under origin-bound web APIs (cookies, IndexedDB),
  set `server.iosScheme: "ionic"` in `capacitor.config.json` to keep
  `ionic://` and avoid wiping user data.
- **Splash hide timing.** Capacitor's `@capacitor/splash-screen` doesn't
  auto-hide — call `SplashScreen.hide()` once your app is mounted, or set
  `launchAutoHide: true` in config.
- **`whitelist` plugin gone.** Capacitor uses native ATS (iOS) and
  `usesCleartextTraffic` (Android) instead of Cordova's whitelist. Add your
  Mushi endpoint and any other API hosts to those if you allow non-HTTPS.

## Rollback

You branched in step 1, so:

```bash
git checkout main
# Native projects are gitignored if you followed Capacitor's recommendations,
# so deleting the migration branch leaves your Cordova app untouched.
```

If you committed and pushed before discovering a regression, revert the
merge commit; Cordova builds will start working again immediately.

## Related guides

- [Capacitor → React Native](/migrations/capacitor-to-react-native) — once you're on Capacitor, the next move (if you want it) is well-trodden.
- [`@mushi-mushi/capacitor` SDK reference](/sdks/capacitor)
- [Capacitor → bottom-dock notes](/sdks/capacitor-bottom-dock) — keep the Mushi widget above your tab bar.

## References

- [Capacitor: Cordova → Capacitor migration](https://capacitorjs.com/cordova)
- [Capacitor Plugins catalog](https://capacitorjs.com/docs/plugins)
- [Capawesome community plugins](https://capawesome.io/plugins/)
