# React Native quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/react-native

---
title: React Native quickstart
---

# React Native quickstart

Add a shake-to-report button to your iOS or Android app — same API key powers
the widget and your editor tools.

  {QUICKSTART_ONE_KEY_CALLOUT}

Works for **bare React Native CLI** apps and **Expo** apps (managed-with-dev-client
or bare). Peer dependency is React Native **≥ 0.72**; this quickstart targets
**0.82+** with the New Architecture as the recommended baseline.

## 1. Install

```bash
# React Native CLI
npm install @mushi-mushi/react-native @react-native-async-storage/async-storage
cd ios && bundle exec pod install && cd ..

# Expo
npx expo install @mushi-mushi/react-native @react-native-async-storage/async-storage
```

To enable **shake-to-report**, also install `expo-sensors`. On a bare RN CLI
project, wire up Expo modules first (one-time):

```bash
# Bare RN CLI only — Expo apps already have this
npx install-expo-modules@latest
npm install expo-sensors
cd ios && bundle exec pod install && cd ..

# Expo
npx expo install expo-sensors
```

## 2. Mount the provider

```tsx filename="App.tsx"

  return (
    
      
    
  )
}
```

`` mounts the floating bug button automatically (unless you
set `trigger: 'manual'`), opens the bottom-sheet report form on tap or
shake, and attaches the last 100 console logs and last 50 network requests
to every report.

## 3. Verify

Run your app on a simulator or a device, tap the bug button, type a
description, and submit. The report should appear in the Mushi admin console
within a couple of seconds, tagged `sdk:react-native@`.

If nothing arrives:

- Confirm `apiKey` is the **public** ingest key (`mushi_pk_...`) — not the
  Supabase service-role key.
- Confirm `` is at the **root** of the component tree, above
  any `NavigationContainer`.
- iOS release builds must use HTTPS for the Mushi endpoint (the default).

  Pure-native shells should use the [iOS](/quickstart/ios) or
  [Android](/quickstart/android) SDKs directly. Capacitor / Ionic apps have
  their own [plugin](/quickstart/capacitor); a step-by-step
  [Capacitor → React Native migration guide](/migrations/capacitor-to-react-native)
  covers porting an existing Capacitor app.
