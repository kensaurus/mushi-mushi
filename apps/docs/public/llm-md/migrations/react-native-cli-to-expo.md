# React Native CLI ↔ Expo

Source: https://kensaur.us/mushi-mushi/docs/migrations/react-native-cli-to-expo

---
title: 'React Native CLI ↔ Expo'
---

# React Native CLI ↔ Expo

 

Both directions covered. Pick one based on what you need:

- **CLI → Expo** if you want EAS Build, OTA updates, and the Expo SDK
  package family.
- **Expo → CLI (`expo prebuild`)** if you need a native module Expo Go
  doesn't allow, or you want to fully own the `ios/` and `android/` folders.

  As of 2026, **most projects don't need to choose**. You can run a bare
  React Native CLI app and selectively `npx install-expo-modules@latest` to
  pull in just the Expo SDK packages you want. That hybrid setup is what
  the [Capacitor → RN guide](/migrations/capacitor-to-react-native#52-selectively-pulling-in-expo-sdk-packages-without-expo-cli)
  recommends for cost-conscious teams.

## Direction A: React Native CLI → Expo (managed-with-dev-client)

### Why

- Cloud builds via **EAS Build** ($19–$99/mo) — no Mac mini, no Fastlane,
  no GitHub Actions YAML.
- **OTA updates** via EAS Update without store review.
- **Expo SDK** packages co-maintained per release; they always work
  together against the same SDK.

### Migration checklist

Anything that ships its own iOS/Android code needs an Expo config plugin OR you stay on a "bare" Expo workflow with a dev client.</> },
    { id: 'install-expo', label: 'Install Expo packages alongside RN', content: {`npx install-expo-modules@latest
npm install expo expo-dev-client`} },
    { id: 'config', label: 'Create app.json / app.config.ts', content: <>Move metadata (name, slug, icon, splash, plugins) from native projects into Expo config. Each native customization either becomes an Expo config plugin or stays in the (still-checked-in) native projects.</> },
    { id: 'dev-client', label: 'Build a dev client', content: {`npx expo prebuild --clean   # regenerates ios/ + android/
npx expo run:ios            # local dev build
# Or via EAS:
npx eas-cli build --profile development --platform all`} },
    { id: 'mushi', label: 'Mushi: no changes needed', content: <>Your existing &lt;MushiProvider projectId apiKey /&gt; works as-is on Expo. The only change is that expo-sensors (used for shake-to-report) is now installed automatically via the Expo SDK rather than via npx install-expo-modules.</> },
    { id: 'eas-build', label: 'Move CI to EAS Build (optional)', content: <>If you want EAS to handle store submissions: npx eas-cli build:configure, then npx eas-cli build --platform all. Replaces your Fastlane setup.</> },
  ]}
/>

## Direction B: Expo → bare React Native CLI (`expo prebuild`)

### Why

- A native dependency you can't wrap as an Expo config plugin.
- Want to fully own native projects (e.g., specific Xcode build settings
  Expo doesn't expose).
- Want to switch off EAS Build and own your CI on GitHub Actions + Fastlane
  (see [Cap → RN § 5](/migrations/capacitor-to-react-native#5-path-b-react-native-cli--github-actions--fastlane-the-chosen-path) for the full recipe).

### Migration checklist

Prebuild rewrites ios/ and android/. Commit first so you can diff.</> },
    { id: 'prebuild', label: 'Run expo prebuild', content: {`npx expo prebuild --clean
# Generates ios/ and android/ from your app.json + Expo config plugins`} },
    { id: 'commit-native', label: 'Commit the generated native projects', content: <>You now own them. Future prebuild runs would overwrite — most teams stop running it after the eject.</> },
    { id: 'remove-expo-cli', label: 'Optionally remove Expo CLI references', content: <>You can keep using Expo SDK packages (recommended) — just stop using npx expo commands and use react-native CLI instead. Update package.json scripts accordingly.</> },
    { id: 'mushi', label: 'Mushi: no changes needed', content: <>Same provider, same API key. Shake-to-report keeps working because expo-sensors stays installed.</> },
    { id: 'ci', label: 'Wire your own CI', content: <>If you were on EAS Build, follow the GitHub Actions + Fastlane recipe from the Cap → RN guide.</> },
  ]}
/>

## Hybrid (the third option, often the right one)

You can run a fully bare React Native CLI app AND consume select Expo SDK
packages without the Expo CLI:

```bash
npx install-expo-modules@latest
npm install expo-haptics expo-secure-store expo-image-picker expo-sensors
cd ios && bundle exec pod install
```

That's it. You get the Expo packages co-maintained as a unit, your CI stays
on Fastlane + GitHub Actions, and Mushi runs the same way it does
everywhere. This is the [recommended setup for glot.it](/migrations/capacitor-to-react-native).

## Verification

After either direction, smoke-test:

1. App boots, opens, shows the Mushi widget on tap or shake.
2. A test report appears in the Mushi admin console within ~5s.
3. Native modules (camera, secure storage, etc.) work on a real device.

## References

- [Expo: Install Expo modules in an existing React Native project](https://docs.expo.dev/bare/installing-expo-modules/)
- [Expo: prebuild](https://docs.expo.dev/workflow/prebuild/)
- [Capacitor → React Native § 5.2](/migrations/capacitor-to-react-native#52-selectively-pulling-in-expo-sdk-packages-without-expo-cli) — the hybrid recipe in detail
