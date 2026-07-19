# Instabug (Luciq) → Mushi

Source: https://kensaur.us/mushi-mushi/docs/migrations/instabug-to-mushi

---
title: 'Instabug (Luciq) → Mushi'
---

# Instabug (Luciq) → Mushi

 

  This is a low-risk swap because both products solve the same shape of
  problem (in-app bug capture) and use very similar config. Most apps land
  the cutover in an afternoon, including a beta validation pass.

## Why switch

- **Pricing.** Mushi SDKs are MIT, the server is AGPLv3 open source — self-host free, cloud free up to 50 diagnoses/month; Luciq is per-seat enterprise.
- **AI triage.** Mushi ships a built-in two-stage classifier
  (fast-filter + classify-report) that turns raw user reports into
  triaged tickets without manual review. Luciq's "Agentic AI" is a recent
  add-on.
- **Self-host.** Mushi can self-host on Supabase / your own Postgres;
  Luciq is SaaS-only.
- **No vendor rebrand whiplash.** You own the bug-capture surface.

## API mapping

| Instabug / Luciq | Mushi |
|------------------|-------|
| `Instabug.start(token, [...invocationEvents])` | `Mushi.init({ projectId, apiKey, ... })` |
| `Luciq.init({ token })` | `Mushi.init({ projectId, apiKey })` |
| `Instabug.show()` / `Luciq.show()` | `Mushi.openWidget()` |
| `Instabug.identifyUser(email, name)` | `Mushi.setUser({ id, email, name })` |
| `Instabug.setUserAttribute(k, v)` | `Mushi.setMetadata({ [k]: v })` |
| `Instabug.addCustomLog(log)` | Captured automatically; or `Mushi.captureLog(log)` |
| `invocationEvents: [InvocationEvent.shake]` | `widget: { trigger: 'shake' }` |
| `invocationEvents: [InvocationEvent.floatingButton]` | `widget: { trigger: 'button' }` |
| `setReproStepsConfig(...)` | Captured automatically (console + network + navigation) |
| Crash reporting | **Stays where it is.** Mushi composes with Sentry/Crashlytics; we don't replace them. |

## Before / After

### Web

```ts
// BEFORE — Instabug Web

Instabug.start('YOUR_TOKEN', { invocationEvents: ['shake', 'floatingButton'] })
Instabug.identifyUser('user@example.com', 'Jane Doe')
```

```ts
// AFTER — Mushi

Mushi.init({
  projectId: 'YOUR_PROJECT_ID',
  apiKey:    'YOUR_PUBLIC_KEY',
  widget:    { trigger: 'both' },   // shake + button
})
Mushi.setUser({ id: 'user-42', email: 'user@example.com', name: 'Jane Doe' })
```

### React Native

```ts
// BEFORE — Luciq React Native

Luciq.init({
  token: 'YOUR_TOKEN',
  invocationEvents: [Luciq.invocationEvent.shake],
  debugLogsLevel: LogLevel.Verbose,
})
Luciq.identifyUser('user@example.com', 'Jane Doe', 'user-42')
```

```tsx
// AFTER — Mushi React Native

  return (
    
      
    
  )
}

// Inside any screen:

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
    { id: 'install', label: 'Install the right Mushi SDK', content: {`# Web (any framework)
npm install @mushi-mushi/web

# React
npm install @mushi-mushi/react

# React Native
npm install @mushi-mushi/react-native

# Capacitor
npm install @mushi-mushi/capacitor && npx cap sync`} },
    { id: 'init-mushi', label: 'Mount Mushi alongside Instabug/Luciq (do NOT remove yet)', content: <>Run both SDKs in parallel for at least 2-3 days. Reports will land in both products. Use this window to compare what Mushi captures vs Luciq and surface any gaps.</> },
    { id: 'identify-user', label: 'Wire setUser / setMetadata for parity', content: <>Anywhere you called identifyUser or setUserAttribute, mirror with Mushi.setUser(...) / Mushi.setMetadata(...).</> },
    { id: 'verify-capture', label: 'Verify console + network + screenshot capture', content: <>Trigger the Mushi widget on a real device or browser, submit a test report, and confirm console logs, network requests, and (web only) the screenshot are attached. Mushi captures these by default — no extra config.</> },
    { id: 'parallel-test', label: 'Run dual-SDK in beta for ≥ 3 days', content: <>This is the riskiest step to skip. Compare incident counts, attached metadata richness, and reporter-resolution time between the two surfaces. Make the call to switch only when Mushi reports look at least as useful.</> },
    { id: 'update-docs', label: 'Update internal docs / runbooks', content: <>Anywhere your team's runbooks reference "open Luciq dashboard" or "check Instabug for repro steps", swap to the Mushi admin console URL.</> },
    { id: 'remove-luciq', label: 'Remove Instabug / Luciq SDK', content: {`npm uninstall instabug-reactnative luciq-reactnative-sdk instabug
# (Whichever ones you had)
# For React Native, also: cd ios && pod deintegrate && pod install`} },
    { id: 'rotate-token', label: 'Revoke the Instabug/Luciq token in their dashboard', content: <>Don't leave an unused production token live; revoke it once dual-ship is over.</> },
  ]}
/>

## Feature parity at a glance

| Capability | Instabug / Luciq | Mushi |
|------------|------------------|-------|
| Shake to report | ✅ | ✅ (`widget.trigger: 'shake'`) |
| Floating button | ✅ | ✅ (`widget.trigger: 'button'`) |
| Screenshot on report (web) | ✅ | ✅ (`capture.screenshot: 'on-report'`) |
| Console + network capture | ✅ | ✅ (default on) |
| Repro steps timeline | ✅ | ✅ (auto from console + network + navigation) |
| Crash reporting | ✅ | ❌ — keep Sentry / Crashlytics for crashes |
| Surveys / NPS | ✅ | ❌ — out of scope |
| In-app chat | ✅ (Luciq Chats) | ❌ — out of scope |
| Self-hosted option | ❌ | ✅ |
| AI triage built-in | Add-on | ✅ (default) |
| Open source | ❌ | ✅ |

If you actively use Luciq's surveys or in-app chat, you'd keep those
surfaces on Luciq even after migrating bug capture to Mushi — they're
unrelated products in the same SDK.

## Rollback

If Mushi doesn't fit, the rollback is just removing the Mushi package
and re-adding Instabug/Luciq. Your Luciq backend doesn't lose data.
Because we recommend ≥ 3 days of dual-ship before removing Luciq, you
have a clean snapshot to compare against.

## References

- [Mushi Mushi web SDK](/sdks/web)
- [Mushi Mushi React Native SDK](/sdks/react-native)
- [Mushi Mushi admin console](/admin)
- [Luciq (Instabug) docs](https://docs.luciq.cloud/)
