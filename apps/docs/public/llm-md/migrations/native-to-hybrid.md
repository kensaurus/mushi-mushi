# Native iOS / Android → Hybrid

Source: https://kensaur.us/mushi-mushi/docs/migrations/native-to-hybrid

---
title: 'Native iOS / Android → Hybrid'
description: Should you wrap a native iOS or Android app in Capacitor or React Native? When it pays off, how to do it, and where the Mushi Mushi SDKs fit either way.
---

# Native iOS / Android → Hybrid

 

When (and how) to wrap an existing pure-native iOS / Android app with
**Capacitor** or **React Native**, keeping the platform Mushi Mushi SDKs in
place.

This is a strategic guide more than a tactical one. Many apps that get
this far don't need to migrate, so read "Should you migrate?" first.

## Should you migrate?

Migrate if **two or more** of these are true:

- ☐ You're shipping the same feature twice in Swift and Kotlin and the
  parity work is eating > 30 % of your engineering time.
- ☐ You have an existing web app whose UI you'd like to share with mobile.
- ☐ Your app's core surface is forms / lists / chat / dashboards (high JS
  affinity); not games, AR, video editors, or audio DSP.
- ☐ You're losing native engineers and can hire React engineers more
  easily.

DON'T migrate if:

- Your app's value is performance-bound native (camera, GL, audio, VPN).
- Your team is happy and ships steadily on native.
- You can't afford a 6–12 month parallel-track migration.

If you proceed, the realistic outcome is **hybrid**: most of your screens
in JS, a handful of performance-critical surfaces left in Swift / Kotlin,
bridged to JS via TurboModules (RN) or Capacitor plugins.

## Pick a target shell

| | Capacitor | React Native |
|---|-----------|--------------|
| **Reuse web codebase** | Yes (it IS the web app, in a WebView) | Mostly — RN uses React but not DOM components |
| **Native fidelity** | WebView ceiling | ~Native, with effort |
| **Migration size** | Smaller (you can wrap a static export) | Larger (every screen is rewritten) |
| **Team profile** | Web devs only | React devs + some native fluency |
| **Mushi support** | [`@mushi-mushi/capacitor`](/sdks/capacitor) + [`@mushi-mushi/web`](/sdks/web) for the WebView | [`@mushi-mushi/react-native`](/sdks/react-native) |

Pick **Capacitor** if you already have a strong web product and just need
a native shell. Pick **React Native** if you want to ship native UX from
JS and you don't have a meaningful web app.

## Migration checklist

List every screen, native module, and platform integration. Mark each as: port to JS, keep native + bridge, or delete. Anything performance-critical (camera, AR, audio) usually stays native.</> },
    { id: 'spike', label: 'Run a 2-week spike on the most complex screen', content: <>Don't commit to a 12-month migration based on the easy screens. Pick the worst one (most native code, most edge cases) and port it first. If it takes &gt; 2 weeks, recalibrate the timeline upward.</> },
    { id: 'shell', label: 'Pick the shell: Capacitor or React Native', content: <>Use the table above. The earlier you commit, the better; switching mid-migration costs 2-3x.</> },
    { id: 'design-system', label: 'Port the design system', content: <>Tokens (colors, type scale, spacing) come over first. Components follow. Aim for visual parity within ± 2 px before porting any screens.</> },
    { id: 'pilot', label: 'Pilot one user-facing flow end-to-end', content: <>Pick a low-risk flow (e.g., Settings). Ship it as a hybrid screen embedded in the existing native app — your shell can host both worlds during the migration.</> },
    { id: 'mushi', label: 'Wire Mushi: keep the native SDK AND add the JS one', content: <>If you're wrapping the native app with Capacitor, you can keep your native iOS / Android Mushi SDKs and add @mushi-mushi/capacitor (or @mushi-mushi/web for WebView-only surfaces). Both report to the same project; filter Reports by SDK to tell them apart.</> },
    { id: 'screen-rollout', label: 'Roll out screen-by-screen behind a feature flag', content: <>Each screen flips from native to hybrid behind a flag. Monitor crash + complaint rate per flag, roll back individual screens when needed.</> },
    { id: 'sunset', label: 'Sunset native screens once their hybrid versions are stable', content: <>Delete the Swift / Kotlin code only after the hybrid version has been at 100 % rollout for ≥ 30 days.</> },

/>

## Mushi Mushi during the migration

You'll have **two** Mushi SDKs running side by side for the migration window:

- The existing native [**iOS**](/sdks/ios) (`MushiMushi`, Swift) and / or
  [**Android**](/sdks/android) (`dev.mushimushi:mushi-android`, Kotlin)
  SDKs, mounted in the native shell. Both are 0.4.0 previews: they are not
  on CocoaPods trunk, SwiftPM tags or Maven Central yet, so they are built
  from source as their SDK pages describe.
- The **shell-specific JS SDK** —
  [`@mushi-mushi/capacitor`](/sdks/capacitor) (for Capacitor shells) or
  [`@mushi-mushi/react-native`](/sdks/react-native) (for RN shells).

Both **must use the same `projectId`**. Reports from each land in the same
inbox, and each report records which SDK sent it, so you can filter
Reports by SDK.

```swift
// Native iOS — stays as-is during the migration
import MushiMushi

Mushi.shared.configure(with: MushiConfig(
    projectId: "YOUR_PROJECT_ID",
    apiKey: "YOUR_PUBLIC_KEY",
    endpoint: "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api"
))
```

```ts
// JS shell — added on top
import { Mushi } from '@mushi-mushi/capacitor'
await Mushi.configure({ projectId: 'YOUR_PROJECT_ID', apiKey: 'YOUR_PUBLIC_KEY' })
```

When the migration completes and you remove the native shell entirely, you
also remove the native Mushi SDK; the JS one carries on alone.

## Verification

- Both SDKs land reports under the same project.
- Filtering Reports by SDK shows reports from both surfaces during the
  migration window.
- The crash rate on the hybrid surfaces moves toward the native surface's
  rate over the first weeks. Set your own threshold before you start.

## References

- [Capacitor docs](https://capacitorjs.com/)
- [React Native docs](https://reactnative.dev/)
- [Mushi iOS SDK](/sdks/ios) and [Mushi Android SDK](/sdks/android) reference
- [`@mushi-mushi/capacitor`](/sdks/capacitor) and [`@mushi-mushi/react-native`](/sdks/react-native) reference
