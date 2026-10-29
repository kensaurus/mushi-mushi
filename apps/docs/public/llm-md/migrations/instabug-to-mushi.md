# Instabug (Luciq) → Mushi Mushi

Source: https://kensaur.us/mushi-mushi/docs/migrations/instabug-to-mushi

---
title: 'Instabug (Luciq) → Mushi Mushi'
description: Replace Instabug (now Luciq) with Mushi Mushi for in-app bug reporting in React Native. Config mapping, shake-to-report, a beta validation pass and a checklist.
---

# Instabug (Luciq) → Mushi Mushi

 

  Instabug now ships as Luciq. Both it and Mushi Mushi do in-app bug
  capture, so the config maps closely. Luciq's SDKs are mobile (iOS,
  Android, React Native, Flutter, KMP); this page covers React Native. For
  native iOS / Android, see the [iOS](/sdks/ios) and [Android](/sdks/android)
  SDK pages.

## Why switch

- **Open source and price.** Mushi SDKs are MIT and the server is AGPLv3.
  Self-hosting is free; the cloud is free for one app and 100 diagnoses a
  month. Compare with your Luciq contract.
- **AI triage.** Mushi ships a built-in two-stage classifier
  (fast-filter + classify-report) that turns raw user reports into
  triaged tickets without manual review.
- **Self-host.** Mushi can run on your own Supabase / Postgres.

## API mapping

The calls on the right are on the instance from `useMushi()`
(`@mushi-mushi/react-native`).

| Instabug / Luciq (React Native) | Mushi Mushi |
|------------------|-------|
| `Luciq.init({ token, invocationEvents })` (older Instabug SDKs: `Instabug.init` / `Instabug.start`) | `` at the app root |
| `Luciq.show()` | `mushi.open()` |
| `Luciq.identifyUser(email, name, id)` | `mushi.setUser({ id, email, name })` |
| `Luciq.setUserAttribute(k, v)` | `mushi.setMetadata(k, v)` |
| Custom logs | Console, network and navigation are captured automatically; add your own with `mushi.addBreadcrumb({ category: 'custom', level: 'info', message })` |
| `invocationEvents: [InvocationEvent.shake]` | `config.widget.trigger: 'shake'` (needs `expo-sensors`) |
| `invocationEvents: [InvocationEvent.floatingButton]` | `config.widget.trigger: 'button'` (the default) |
| `invocationEvents: [shake, floatingButton]` | `config.widget.trigger: 'both'` |
| Repro steps | Captured automatically (console + network + navigation) |
| Crash reporting | **Stays where it is.** Mushi works next to Sentry / Crashlytics; it doesn't replace them. |

## Before / After (React Native)

```ts
// BEFORE: Luciq React Native
import Luciq, { InvocationEvent } from '@luciq/react-native'
Luciq.init({
  token: 'YOUR_TOKEN',
  invocationEvents: [InvocationEvent.shake],
})
Luciq.identifyUser('user@example.com', 'Jane Doe', 'user-42')
```

```tsx
// AFTER: Mushi Mushi React Native
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId="YOUR_PROJECT_ID"
      apiKey="YOUR_PUBLIC_KEY"
      config={{ widget: { trigger: 'shake' } }}
    >
      <RootNavigator />
    </MushiProvider>
  )
}

// Inside any screen:
import { useEffect } from 'react'
import { useMushi } from '@mushi-mushi/react-native'
function ProfileScreen() {
  const mushi = useMushi()
  useEffect(() => {
    mushi.setUser({ id: 'user-42', email: 'user@example.com', name: 'Jane Doe' })
  }, [mushi])
  // ...
}
```

## Migration checklist

Sign in to the Mushi admin console, create a project, mint an API key. Copy projectId + apiKey.</> },
    { id: 'install', label: 'Install the Mushi React Native SDK', content: {`npm install @mushi-mushi/react-native

# Optional peers: shake-to-report and screenshots
npx expo install expo-sensors react-native-view-shot
# (bare React Native: npm install expo-sensors react-native-view-shot)`} },
    { id: 'init-mushi', label: 'Mount Mushi alongside Instabug/Luciq (do NOT remove yet)', content: <>Run both SDKs in parallel for at least 2-3 days. Reports will land in both products. Use this window to compare what Mushi captures vs Luciq and surface any gaps.</> },
    { id: 'identify-user', label: 'Wire setUser / setMetadata for parity', content: <>Anywhere you called identifyUser or setUserAttribute, mirror with mushi.setUser(...) / mushi.setMetadata(key, value) on the instance from useMushi().</> },
    { id: 'verify-capture', label: 'Verify console + network + screenshot capture', content: <>Trigger the Mushi widget on a real device, submit a test report, and confirm console logs, network requests, and the screenshot are attached. Console and network capture are on by default; the screenshot needs react-native-view-shot.</> },
    { id: 'parallel-test', label: 'Run dual-SDK in beta for ≥ 3 days', content: <>This is the riskiest step to skip. Compare incident counts, attached metadata richness, and reporter-resolution time between the two surfaces. Make the call to switch only when Mushi reports look at least as useful.</> },
    { id: 'update-docs', label: 'Update internal docs / runbooks', content: <>Anywhere your team's runbooks reference "open Luciq dashboard" or "check Instabug for repro steps", swap to the Mushi admin console URL.</> },
    { id: 'remove-luciq', label: 'Remove Instabug / Luciq SDK', content: {`npm uninstall instabug-reactnative @luciq/react-native
# (whichever one you had)
cd ios && pod install`} },
    { id: 'rotate-token', label: 'Revoke the Instabug/Luciq token in their dashboard', content: <>Don't leave an unused production token live; revoke it once dual-ship is over.</> },

/>

## Feature parity at a glance

| Capability | Instabug / Luciq | Mushi |
|------------|------------------|-------|
| Shake to report | ✅ | ✅ (`widget.trigger: 'shake'`, needs `expo-sensors`) |
| Floating button | ✅ | ✅ (`widget.trigger: 'button'`) |
| Screenshot on report | ✅ | ✅ (`capture.screenshot: true`, needs `react-native-view-shot`) |
| Console + network capture | ✅ | ✅ (default on) |
| Repro steps timeline | ✅ | ✅ (auto from console + network + navigation) |
| Crash reporting | ✅ | ❌ (keep Sentry / Crashlytics for crashes) |
| Surveys / NPS | ✅ | ❌ (out of scope) |

Mushi can also be self-hosted, its SDKs and server are open source, and it
runs AI triage on every report by default.

If you use Luciq's surveys, keep them on Luciq after moving bug capture
to Mushi.

## Rollback

If Mushi doesn't fit, remove the Mushi package and re-add the Luciq SDK.
Because this guide has you dual-ship for at least 3 days before removing
Luciq, you have both sets of reports to compare.

## References

- [Mushi Mushi React Native SDK](/sdks/react-native)
- [Mushi Mushi admin console](/admin)
- [Luciq (Instabug) docs](https://docs.luciq.ai/)
- [Luciq React Native setup](https://docs.luciq.ai/react-native)
