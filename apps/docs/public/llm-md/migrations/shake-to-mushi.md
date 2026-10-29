# Shake → Mushi Mushi

Source: https://kensaur.us/mushi-mushi/docs/migrations/shake-to-mushi

---
title: 'Shake → Mushi Mushi'
description: Replace the Shake bug-reporting SDK with Mushi Mushi and keep shake-to-report on mobile. Config mapping, identity, and a cut-over checklist.
---

# Shake → Mushi Mushi

 

Shake (shakebugs.com) is a hosted bug-reporting service built around
shake-to-report. This guide swaps it for Mushi Mushi and keeps the same
trigger on mobile.

  Shake-to-report is available in the Mushi React Native and Capacitor
  SDKs. The Mushi web SDK has no shake trigger: on the web, users open the
  widget from its launcher (a floating button on desktop, an edge tab on
  phones), or you open it from your own button.

## Why switch

- **Open-source server.** Mushi's SDKs are MIT and its server and admin
  console are AGPLv3, so you can run all of it yourself. (Shake's SDKs are
  MIT on npm; its backend is a hosted service.)
- **Self-host.** Mushi runs on your own Supabase / Postgres.
- **AI triage.** Mushi's two-stage classifier and judge loop ship in the box.
- **Pricing.** Self-hosting is free. The cloud is free for one app and 100
  diagnoses a month; paid plans are priced by number of apps (see
  [pricing](/pricing)).

## API mapping

Mushi calls are on the SDK instance: `useMushi()` in React Native, or
`const mushi = Mushi.init({...})` on the web.

| Shake | Mushi Mushi |
|-------|-------|
| `Shake.start(apiKey)` | `` (RN) / `Mushi.init({ projectId, apiKey })` (web) |
| `Shake.show()` | `mushi.open()` |
| `Shake.registerUser(id)` + `Shake.updateUserMetadata({ email, name })` | `mushi.setUser({ id, email, name })` |
| `Shake.setMetadata(key, value)` | `mushi.setMetadata(key, value)` |
| `Shake.setInvokeShakeOnShakeDeviceEvent(true)` | RN: `config.widget.trigger: 'shake'` (needs `expo-sensors`) |
| `Shake.setShowFloatingReportButton(true)` | RN: `config.widget.trigger: 'button'` (or `'both'` with shake); web: the default launcher (a floating button on desktop, an edge tab on phones) |
| `Shake.addPrivateView(viewRef)` | Web: add `data-mushi-redact` to the element, or list selectors in `privacy.redactSelectors`. RN: the reporter sees the screenshot and can remove it before sending. |

## Before / After

### React Native

```ts
// BEFORE: Shake
import Shake from '@shakebugs/react-native-shake'
Shake.start('YOUR_API_KEY')
Shake.setInvokeShakeOnShakeDeviceEvent(true)
Shake.setMetadata('tier', 'pro')
```

```tsx
// AFTER: Mushi Mushi
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId="YOUR_PROJECT_ID"
      apiKey="YOUR_PUBLIC_KEY"
      config={{
        widget:  { trigger: 'shake' },
        capture: { console: true, network: true },
      }}
    >
      <RootNavigator />
    </MushiProvider>
  )
}

// Inside any screen:
import { useEffect } from 'react'
import { useMushi } from '@mushi-mushi/react-native'
function AccountScreen() {
  const mushi = useMushi()
  useEffect(() => {
    mushi.setMetadata('tier', 'pro')
  }, [mushi])
  // ...
}
```

### Web

```ts
// BEFORE: Shake web SDK
import Shake from '@shakebugs/browser'
Shake.start('YOUR_API_KEY')
Shake.registerUser('user-42')
```

```ts
// AFTER: Mushi Mushi web
import { Mushi } from '@mushi-mushi/web'
const mushi = Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey:    'YOUR_PUBLIC_KEY',
})
mushi.setUser({ id: 'user-42', email: 'jane@example.com', name: 'Jane Doe' })
```

## Migration checklist

Sign in to the Mushi admin console; copy projectId + apiKey.</> },
    { id: 'install', label: 'Install the right Mushi SDK', content: {`# Web:    npm install @mushi-mushi/web
# React:  npm install @mushi-mushi/react
# RN:     npm install @mushi-mushi/react-native
#         plus expo-sensors (shake) and react-native-view-shot (screenshots)
# Capacitor: npm install @mushi-mushi/capacitor && npx cap sync`} },
    { id: 'mount-mushi', label: 'Mount Mushi alongside Shake (do NOT remove Shake yet)', content: <>On mobile both will trigger on shake. To avoid two report screens at once, turn off Shake's shake invocation (Shake.setInvokeShakeOnShakeDeviceEvent(false)) during the dual-ship window.</> },
    { id: 'wire-user', label: 'Replicate Shake.registerUser / setMetadata calls in Mushi', content: <>Anywhere you set user identity or ticket metadata in Shake, do the same with mushi.setUser / mushi.setMetadata(key, value).</> },
    { id: 'verify-capture', label: 'Verify Mushi captures the same context Shake did', content: <>Submit a test report. Check that console logs, network requests, and the screenshot are attached. Console and network capture are on by default; on React Native the screenshot needs react-native-view-shot.</> },
    { id: 'compare', label: 'Run dual-SDK in beta for ≥ 2 days', content: <>Compare the next ~10 reports between Shake and Mushi. If Mushi reports are at least as useful, proceed to remove Shake.</> },
    { id: 'remove-shake', label: 'Uninstall the Shake SDK', content: {`npm uninstall @shakebugs/react-native-shake @shakebugs/browser
# For React Native: cd ios && pod install`} },
    { id: 'rotate-key', label: 'Revoke your Shake API key', content: <>In the Shake dashboard, rotate the production key so the now-removed SDK can't accidentally re-attach.</> },

/>

## Feature parity

| Capability | Shake | Mushi |
|------------|-------|-------|
| Shake-to-report | ✅ | ✅ on React Native and Capacitor (not web) |
| Floating button | ✅ | ✅ |
| Screenshot on report | ✅ | ✅ (with markup on web) |
| Console + network capture | ✅ | ✅ (default on) |
| Activity history / repro steps | ✅ | ✅ (auto from captured streams) |
| Crash reporting | ✅ | ❌ (keep Sentry / Crashlytics) |
| Self-host | ❌ (none found) | ✅ |
| Open-source server | ❌ (SDKs are MIT) | ✅ |
| MCP server for IDE agents | not checked | ✅ |

## References

- [Mushi web SDK](/sdks/web) / [React Native SDK](/sdks/react-native)
- [Shake React Native: invoke](https://docs.shakebugs.com/docs/react/user-feedback/invoke/)
- [Shake web SDK on npm](https://www.npmjs.com/package/@shakebugs/browser)
