# @mushi-mushi/react-native

> **Your AI wrote it. Mushi tells you why it broke.**

The React Native and Expo SDK for [Mushi Mushi](https://www.npmjs.com/package/mushi-mushi). It adds a bug button and a report sheet to your iOS and Android app. When a user reports a problem, Mushi gets a screenshot, the screen, device details and recent console and network entries, explains the cause in plain English, and hands your editor a fix to start from.

## Quick start

```bash
npx mushi-mushi    # detects React Native / Expo, installs this package, writes env vars
# or: npm install @mushi-mushi/react-native
```

```tsx
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider projectId="proj_xxx" apiKey="mushi_xxx">
      <Navigation />
    </MushiProvider>
  )
}
```

That renders a floating bug button and a slide-up report sheet. The button stays out of the way until tapped. With `@react-native-async-storage/async-storage` installed, reports queue offline and send when the connection is back. Docs: [React Native SDK reference](https://kensaur.us/mushi-mushi/docs/sdks/react-native)

Other frameworks: [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)

## What this package adds on mobile

On a phone, the bugs people feel often never crash: a button that won't tap, a screen that freezes, a layout that folds on one device. This package lets the person report that moment from inside your app. The report arrives in the same list as your web reports, with the same plain-English diagnosis and fix prompt. How the rest works: [`mushi-mushi`](https://www.npmjs.com/package/mushi-mushi). Who it's for: [who it's for](https://kensaur.us/mushi-mushi/docs/who-its-for).

## Using Sentry too (optional)

Mushi does not need Sentry. If you already run **Sentry** in your React Native app, keep it; the two do different jobs:

```tsx
import * as Sentry from '@sentry/react-native'

Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN })

// Mushi handles user reports + screenshot context; Sentry handles thrown errors.
```

## Widget trigger modes

Control how users open the report form:

| Value | Behavior |
|---|---|
| `'button'` (default) | Floating action button. Safe on all Hermes builds |
| `'auto'` / `'edge-tab'` | Also show the floating button (names shared with the web SDK) |
| `'shake'` | Shake-to-report listener (needs the optional `expo-sensors` peer) |
| `'both'` | Floating button and shake |
| `'banner'` | A dismissible banner strip (`widget.banner.message`) instead of the button |
| `'manual'` / `'hidden'` | No automatic UI. Call `open()` yourself |
| `'attach'` | Hides the default UI. You render your own button and call `attachTo()` |

> **Shake and Hermes.** `expo-sensors` loads lazily through `require()`, so apps that ship `trigger: 'button'` never pay for the shake sensor. Both triggers work on Hermes since v0.11.0.

```tsx
<MushiProvider
  projectId="proj_xxx"
  apiKey="mushi_xxx"
  config={{
    widget: {
      trigger: 'both',
      buttonPosition: 'bottom-right',
      inset: { bottom: 96, right: 16 },  // clear your tab bar
    },
  }}
>
  <Navigation />
</MushiProvider>
```

## Hooks

```ts
import { useMushi, useMushiReport, useMushiWidget } from '@mushi-mushi/react-native'

const { submitReport } = useMushiReport()
const { open, close } = useMushiWidget()
const mushi = useMushi()  // full SDK instance: open(), close(), attachTo(), identify(), submitReport()
```

## Headless / bring your own button

```tsx
import { MushiTrigger } from '@mushi-mushi/react-native'

<MushiTrigger>
  <Pressable style={styles.btn}>
    <Text>Report a bug</Text>
  </Pressable>
</MushiTrigger>
```

`MushiTrigger` wraps any child with `cloneElement`, so the child's `onPress` chain is preserved.

## Standalone components

```tsx
import { MushiBottomSheet, MushiFloatingButton } from '@mushi-mushi/react-native'
```

- `MushiBottomSheet`: a conversational report modal with category → description → submit flow. Dark/light theme, drag-to-dismiss.
- `MushiFloatingButton`: a positioned FAB with spring animation. Configurable via `buttonPosition` and `inset`.

## Theming

The report sheet takes the host's look through `widget.theme`. Every token is optional; unset tokens use neutral defaults with an ink accent, and when only `accent` is set the text on it is picked for contrast.

```tsx
<MushiProvider
  config={{
    widget: {
      theme: { accent: '#C9A227', fontFamily: 'Georgia', radius: 8 },
      // also: bg, fg, muted, surface, border, accentFg, success, error
    },
  }}
>
```

"Your reports" shows the same status labels as the web widget ("Received", "Looking into it", "Fix in progress", "Fixed in v1.4"), from `@mushi-mushi/core/reporter-ui`. A thread that fails or does not answer within 12 s shows Retry, and opening a thread marks its updates read.

## What gets captured

- Device info (platform, OS version, screen dimensions) + a stable device `fingerprintHash`
- A per-launch `sessionId` so every report from the same run is grouped
- `sdkPackage` / `sdkVersion` / `appVersion` so the console can flag outdated installs
- Console logs (monkey-patched `console.*`)
- Network requests (fetch interceptor, headers redacted)
- Navigation events (React Navigation integration, optional)
- A 50-entry breadcrumb ring buffer → sent as `breadcrumbs` + a derived repro `timeline` (SDK lifecycle, screen changes via `setScreen`, and host crumbs via `addBreadcrumb`)
- Screenshot of the current screen (optional, see below)
- Offline queue via `@react-native-async-storage/async-storage`, so reports survive a force-close

## Screenshots

When `react-native-view-shot` is installed, the SDK captures the current screen **before** the report sheet overlays it, and shows the user a **thumbnail preview** they can remove before submitting. A configurable **privacy caption** (`widget.screenshotSensitiveHint`) appears under the preview. The default copy reminds reporters to drop balances or PII. Enabled by default; turn off capture with `capture: { screenshot: false }`.

```tsx
<MushiProvider
  config={{
    widget: {
      // true (default) | "Custom compliance copy" | false (hide caption only)
      screenshotSensitiveHint: true,
    },
    capture: { screenshot: true },
  }}
>
```

```bash
npx expo install react-native-view-shot   # v4+ on Expo SDK 55; v5+ for Fabric / New Architecture
```

> **Masking sensitive screens.** `captureScreen()` grabs whatever is on screen. The preview + Remove control is the reporter's consent gate, so finance apps can keep screenshots on with a custom caption instead of disabling capture entirely. For screens that must never be photographed, set `capture: { screenshot: false }` while they're focused, or use `expo-screen-capture` to mark the view secure. Full doc: [`docs/SDK_SCREENSHOT_PREVIEW.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_SCREENSHOT_PREVIEW.md).

> **Metro / Hermes hosts.** Optional peers (`react-native-view-shot`, `@react-native-community/netinfo`, `expo-sensors`) load with a literal `require()` inside `try/catch`, which Metro treats as optional. To skip loading entirely, pass them in: `<MushiProvider netInfo={NetInfo} viewShot={ViewShot} expoSensors={ExpoSensors}>`. Versions 0.21–0.23 shipped an esbuild `__require()` shim that crashed under Metro and needed a postinstall patch; drop that patch when you upgrade.

## Identifying the reporter

Call `identify()` / `setUser()` whenever auth state changes so reports show a human name instead of an anonymous token in the console:

```tsx
const mushi = useMushi()
mushi.identify(user.id, { email: user.email, name: user.displayName, provider: 'supabase' })
// or, web-SDK style:
mushi.setUser({ id: user.id, email: user.email, name: user.displayName, provider: 'supabase' })
```

Mushi stores only a SHA-256 hash of the email (the host app owns the raw PII) and shows the `name` as the reporter's display name.

## Peer dependencies

- `react` >= 18
- `react-native` >= 0.72
- `@react-navigation/native` >= 6 (optional: navigation capture)
- `@react-native-async-storage/async-storage` >= 1.19 (optional: offline queue)
- `react-native-view-shot` >= 3.8 (optional: screenshot capture; v5+ for New Architecture / Fabric)
- `@react-native-community/netinfo` >= 11 (optional: send queued reports when the connection returns)
- `expo-sensors` >= 13 (optional: shake trigger only)
- `expo-secure-store` >= 13 (optional: encrypts the offline queue and keeps the anonymous reporter token in secure storage)

## Changelog highlights

- **v0.17.0** — Report payload parity with the web SDK: nested `metadata.user` identity (fixes the anonymous-token reporter on the server), `setUser()` alias, per-launch `sessionId`, `sdkPackage`/`sdkVersion`/`appVersion`, device `fingerprintHash`, and a breadcrumb ring buffer → `breadcrumbs` + repro `timeline`. `capture.screenshot` toggle + `addBreadcrumb()`. Bottom sheet restyled to match the web widget.
- **v0.11.0** — Hermes compatibility fix: replaced `new Function()` dynamic imports with lazy `require()` for `@react-native-community/netinfo` and `expo-sensors`. Enables `trigger: 'button'` safely on all RN 0.84+ Hermes/AOT builds. Adds `MushiTrigger` headless component.
- **v0.8.x** — Shake-to-report listener, offline queue, navigation capture.

See the full [CHANGELOG](https://github.com/kensaurus/mushi-mushi/blob/master/packages/react-native/CHANGELOG.md).

Maintainers: report ingest contract and empty-state semantics are documented in
[`docs/report-ingest-contract.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/report-ingest-contract.md).

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (October 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
