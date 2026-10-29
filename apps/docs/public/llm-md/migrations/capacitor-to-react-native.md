# Migration: Capacitor → React Native

Source: https://kensaur.us/mushi-mushi/docs/migrations/capacitor-to-react-native

---
title: 'Migration: Capacitor → React Native'
description: Port an Ionic or Capacitor app to React Native. A full plan with a Mushi Mushi API map and CI/CD recipes for Expo EAS or React Native CLI with Fastlane.
---

# Capacitor → React Native

 

A porting plan for Ionic / Capacitor apps that want to move to React
Native, with **two** end-to-end CI/CD options: Expo + EAS Build (the
easy, paid path) and React Native CLI + GitHub Actions + Fastlane (the
cost-sensitive path). Mushi Mushi bug reporting keeps working throughout.

  The full plan (ready-to-paste GitHub Actions YAML for Android and iOS,
  the Fastlane match recipe, the Capacitor → RN plugin map, the Mushi SDK
  API mapping, the 6-week timeline, and the go/no-go checklist) lives in
  the repo at
  [`docs/migrations/capacitor-to-react-native.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/migrations/capacitor-to-react-native.md).
  This page is the public summary; the linked file is the contract.

## TL;DR

| Path | Cost / month | Speed to first build | Maintenance | Recommended for |
|------|--------------|----------------------|-------------|-----------------|
| **A: Expo + EAS Build** | EAS Starter $19 or Production $199, plus usage | Hours | Lowest | Teams that want zero CI ops |
| **B: React Native CLI + GitHub Actions + Fastlane** | $0 + GH Actions minutes (or $0 on a self-hosted Mac mini) | 2–3 days | Medium | Cost-sensitive, GitHub-Actions-native teams |

The repo plan was written for Expo SDK 55 and React Native 0.83. Current
releases are Expo SDK 58 and React Native 0.88 (npm, 2026-10-29); check
each tool's upgrade notes before you start. Both paths use the New
Architecture (Fabric / Bridgeless). EAS prices from
[expo.dev/pricing](https://expo.dev/pricing), 2026-10-29.

## Web strategy

You have three options for the **web** experience after porting the native app:

1. **Keep Next.js, port only mobile.** Suits SEO-sensitive marketing sites.
2. **RN Web for the app shell + Next.js for marketing.** One app, two surfaces.
3. **Full RN Web.** Single codebase, with SEO trade-offs.

Option 1 is usually the simplest. You can run `@mushi-mushi/web` on the
marketing site and `@mushi-mushi/react-native` in the new app against the
same project ID and API key at the same time.

## Mushi Mushi during the migration

The single most important property: **you do not change anything on the
Mushi side.** Same project, same API key, same admin console. Reports from
the Capacitor build and the React Native build land in the same inbox.

### API mapping at a glance

| Capacitor (`Mushi.*`) | React Native | Notes |
|-----------------------|--------------|-------|
| `Mushi.configure({ projectId, apiKey })` | `` | Provider replaces the imperative call |
| `Mushi.report({ description, category })` | `useMushiReport().submitReport(...)` hook | Returns `{ submitReport }`, which takes `{ description, category }` |
| `Mushi.showWidget()` | `useMushiWidget().open()` | Same effect |
| `Mushi.setUser({ user: { id, email } })` | `useMushi().setUser({ id, email })` | RN takes the user object directly |
| `Mushi.setMetadata({ key, value })` | `useMushi().setMetadata(key, value)` | Two arguments |
| `Mushi.flushQueue()` | _Automatic_ | The provider flushes its offline queue on mount and when the network comes back; there is no manual flush |
| `triggerMode: 'shake'` | `config.widget.trigger: 'shake'` | Same vocabulary; needs the `expo-sensors` peer |
| `captureScreenshot: boolean` | `config.capture.screenshot: boolean` | Needs the `react-native-view-shot` peer |

### Before / after

```ts
// BEFORE — Capacitor
import { Mushi } from '@mushi-mushi/capacitor'

await Mushi.configure({
  projectId: 'YOUR_PROJECT_ID',
  apiKey:    process.env.PUBLIC_MUSHI_KEY,
  triggerMode: 'shake',
  captureScreenshot: true,
})
```

```tsx
// AFTER — React Native
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId="YOUR_PROJECT_ID"
      apiKey={process.env.EXPO_PUBLIC_MUSHI_KEY!}
      config={{
        widget:  { trigger: 'shake' },   // npx expo install expo-sensors
        capture: { screenshot: true },   // npx expo install react-native-view-shot
      }}
    >
      <RootNavigator />
    </MushiProvider>
  )
}
```

### Get the snippet from the admin console

The **Install SDK** card in the admin console (Onboarding, Projects → your
project, Settings → SDK & connection) has **React Native**, **Expo**, and
**Capacitor** tabs alongside React / Vue / Svelte / Vanilla. The snippets
are populated with your real project ID and (right after a key mint) your
real API key.

The mobile trigger settings additionally persist to the project's runtime
SDK config, so future builds pick them up without a redeploy.

### Or use the CLI

```bash
cd your-rn-app
npx mushi-mushi init
```

The CLI auto-detects `react-native`, `expo`, and `@capacitor/core` and
writes the matching boilerplate. Capacitor users get `Mushi.configure(...)`
(`Mushi.init(...)` is an alias for it).

## What's covered in the full guide

The full plan in
[`docs/migrations/capacitor-to-react-native.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/migrations/capacitor-to-react-native.md)
includes:

1. Decision matrix: should you migrate at all?
2. The web question: RN Web vs keep Next.js
3. Pre-migration audit checklist (plugins, components, web-only APIs)
4. Path A: Expo + EAS Build (one-page recipe, written for SDK 55)
5. Path B (the chosen path): RN CLI + GitHub Actions + Fastlane
   - Project bootstrap with the New Architecture
   - Selectively pulling in Expo SDK packages without the Expo CLI
   - Fastlane `match` for code signing
   - Full Android `.github/workflows/android-release.yml`
   - Full iOS `.github/workflows/ios-release.yml`
   - Self-hosted Mac mini break-even table
   - Required GitHub secrets in one place
6. Capacitor → React Native plugin map (every `@capacitor/*` plugin → its RN equivalent)
7. Mushi Mushi during the migration (full API mapping, dual-shipping plan)
8. Recommended timeline (6 weeks, 1 engineer)
9. Risks + mitigations
10. Final go/no-go checklist
11. Curated references

## Related reading

- [`@mushi-mushi/react-native` SDK reference](/sdks/react-native)
- [`@mushi-mushi/capacitor` SDK reference](/sdks/capacitor)
- [React Native quickstart](/quickstart/react-native)
- [Capacitor quickstart](/quickstart/capacitor)
- [Capacitor bottom-dock notes](/sdks/capacitor-bottom-dock): tuning the trigger position above bottom tab bars
