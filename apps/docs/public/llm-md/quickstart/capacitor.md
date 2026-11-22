# Bug report widget for Capacitor and Ionic

Source: https://kensaur.us/mushi-mushi/docs/quickstart/capacitor

---
title: Bug report widget for Capacitor and Ionic
description: "Free, open-source bug report widget for Capacitor and Ionic apps: install @mushi-mushi/capacitor for shake-to-report and screenshots on iOS, Android and web."
---

# Bug report widget for Capacitor and Ionic

This quickstart ships the same Mushi Mushi bug-report widget on iOS, Android,
and web from one Capacitor shell.

The Capacitor plugin delegates to the native iOS / Android SDKs at runtime
and falls back to `@mushi-mushi/core` on the web.

## Get your project ID and API key

The SDK needs two values from a Mushi Mushi project.

- **Fastest:** run `npx mushi-mushi` in your app's folder. It signs you in
  through the browser, creates or picks a project, installs the SDK and writes
  both values to `.env.local`.
- **By hand:** [create a free account](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-capacitor)
  (no card) and create a project. The panel that opens shows the **project ID**
  and an **API key** that starts with `mushi_`. Copy the key now: it is shown
  once. You can mint another under **Set up → Test it → Generate API key**.
- **Self-hosting?** Your own console gives you the same two values. See
  [Self-hosting](/self-hosting).

They replace `YOUR_PROJECT_ID` and `YOUR_PUBLIC_API_KEY` in step 2.

## 1. Install

```bash
pnpm add @mushi-mushi/capacitor
npx cap sync
```

## 2. Configure

```ts filename="src/mushi.ts"
import { Mushi } from '@mushi-mushi/capacitor'

await Mushi.configure({
  projectId: 'YOUR_PROJECT_ID',
  apiKey:    'YOUR_PUBLIC_API_KEY',
  triggerMode: 'shake',          // 'shake' | 'button' | 'both' | 'none'
  captureScreenshot: true,
})
```

## 3. Submit a report

```ts
await Mushi.report({
  description: 'Date picker is in UTC, not local',
  category:    'bug',
})
```

  **Coming from Cordova?** Migrate in place to Capacitor first. The
  [Cordova → Capacitor migration guide](/migrations/cordova-to-capacitor)
  walks through the plugin map and the Mushi Mushi widget swap.

  Considering React Native? See the
  [Capacitor → React Native migration guide](/migrations/capacitor-to-react-native)
  for the full porting plan, plugin map, and CI/CD recipe.

See [`@mushi-mushi/capacitor`](/sdks/capacitor) for the full API surface
(listeners, `setUser`, `setMetadata`, `triggerInset`, `useNativeWidget`).
