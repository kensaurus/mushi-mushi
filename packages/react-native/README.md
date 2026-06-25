# @mushi-mushi/react-native

> **Your AI wrote it. Mushi tells you why it broke.**

React Native SDK for [Mushi Mushi](https://www.npmjs.com/package/mushi-mushi) — shake-to-report widget, offline queue, and a plain-English diagnosis in your editor, for iOS + Android.

> **One-command setup:** `npx mushi-mushi` auto-detects React Native / Expo and installs this package with the right env vars.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)

## What this package adds on mobile

Every bug your users feel — a button that won't tap, a screen that freezes, a layout that folds on their device — gets captured, classified by AI, and fed into a lesson library that prevents the same class of mistake in the next PR review and the next AI agent run. That's the closed loop the main [`mushi-mushi`](https://www.npmjs.com/package/mushi-mushi) README describes. This package is the mobile entry point.

## Error monitoring (optional)

Mushi captures user-reported bugs through its own ingest pipeline. If you also run **Sentry** in your React Native app, wire both for full coverage:

```tsx
import * as Sentry from '@sentry/react-native'

Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN })

// Mushi handles shake-to-report + screenshot context; Sentry handles thrown errors.
```

See [`@mushi-mushi/web` Sentry bridge](https://github.com/kensaurus/mushi-mushi/tree/master/packages/web#sentry-companion) for the dual-capture pattern on web.

## Quick start

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

That renders a floating 🐛 button and a slide-up bottom-sheet report form. The button stays out of the way until tapped. Report data — screenshot, route, device context, last 5 seconds of console and network — flows to your admin console and is classified within seconds.

## Widget trigger modes

Control how users open the report form:

| Value | Behavior |
|---|---|
| `'button'` (default) | Floating action button — safe on all Hermes builds |
| `'shake'` | Shake-to-report listener (requires optional `expo-sensors` peer) |
| `'both'` | Floating button + shake |
| `'manual'` / `'hidden'` / `'none'` | No auto UI — call `open()` programmatically |
| `'attach'` | Hides default UI; host renders its own button and calls `attachTo()` |

> **Note on shake + Hermes:** `expo-sensors` is loaded lazily via `require()` so apps that ship `trigger: 'button'` never pay the shake-sensor cost. Both triggers are fully Hermes-compatible as of v0.11.0.

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
const mushi = useMushi()  // full SDK instance: show(), hide(), setTrigger(), attachTo()
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

`MushiTrigger` wraps any child with `cloneElement` — the child's `onPress` chain is preserved.

## Standalone components

```tsx
import { MushiBottomSheet, MushiFloatingButton } from '@mushi-mushi/react-native'
```

- `MushiBottomSheet` — Conversational report modal with category → description → submit flow. Dark/light theme, drag-to-dismiss.
- `MushiFloatingButton` — Positioned FAB with spring animation. Configurable via `buttonPosition` and `inset`.

## What gets captured

- Device info (platform, OS version, screen dimensions) + a stable device `fingerprintHash`
- A per-launch `sessionId` so every report from the same run is grouped
- `sdkPackage` / `sdkVersion` / `appVersion` so the console can flag outdated installs
- Console logs (monkey-patched `console.*`)
- Network requests (fetch interceptor, headers redacted)
- Navigation events (React Navigation integration, optional)
- A 50-entry breadcrumb ring buffer → sent as `breadcrumbs` + a derived repro `timeline` (SDK lifecycle, screen changes via `setScreen`, and host crumbs via `addBreadcrumb`)
- Screenshot of the current screen (optional — see below)
- Offline queue via `@react-native-async-storage/async-storage` — reports survive force-close

## Screenshots

When `react-native-view-shot` is installed, the SDK captures the current screen **before** the report sheet overlays it, and shows the user a **thumbnail preview** they can remove before submitting. A configurable **privacy caption** (`widget.screenshotSensitiveHint`) appears under the preview — default copy reminds reporters to drop balances or PII. Enabled by default; turn off capture with `capture: { screenshot: false }`.

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

> **Masking sensitive screens.** `captureScreen()` grabs whatever is on screen. The preview + Remove control is the reporter's consent gate — finance apps can keep screenshots on with a custom caption instead of disabling capture entirely. For screens that must never be photographed, set `capture: { screenshot: false }` while they're focused, or use `expo-screen-capture` to mark the view secure. Full doc: [`docs/SDK_SCREENSHOT_PREVIEW.md`](../../docs/SDK_SCREENSHOT_PREVIEW.md).

> **Metro / Hermes hosts.** The published dist uses esbuild `__require()` for optional peers. Host apps may need a postinstall patch (see yen-yen `scripts/patch-mushi.mjs`) so Metro resolves `react-native-view-shot` and `@react-native-community/netinfo`.

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
- `@react-navigation/native` >= 6 (optional — navigation capture)
- `@react-native-async-storage/async-storage` >= 1.19 (optional — offline queue)
- `react-native-view-shot` >= 3.8 (optional — screenshot capture; v5+ for New Architecture / Fabric)
- `expo-sensors` (optional — shake trigger only)

## Changelog highlights

- **v0.17.0** — Report payload parity with the web SDK: nested `metadata.user` identity (fixes the anonymous-token reporter on the server), `setUser()` alias, per-launch `sessionId`, `sdkPackage`/`sdkVersion`/`appVersion`, device `fingerprintHash`, and a breadcrumb ring buffer → `breadcrumbs` + repro `timeline`. `capture.screenshot` toggle + `addBreadcrumb()`. Bottom sheet restyled to match the web widget.
- **v0.11.0** — Hermes compatibility fix: replaced `new Function()` dynamic imports with lazy `require()` for `@react-native-community/netinfo` and `expo-sensors`. Enables `trigger: 'button'` safely on all RN 0.84+ Hermes/AOT builds. Adds `MushiTrigger` headless component.
- **v0.8.x** — Shake-to-report listener, offline queue, navigation capture.

See the full [CHANGELOG](https://github.com/kensaurus/mushi-mushi/blob/master/packages/react-native/CHANGELOG.md).

Maintainers: report ingest contract and empty-state semantics are documented in
[`docs/report-ingest-contract.md`](../../docs/report-ingest-contract.md).

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 51 edge functions · 298 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
