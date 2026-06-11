# @mushi-mushi/react-native

React Native SDK for [Mushi Mushi](https://www.npmjs.com/package/mushi-mushi) — shake-to-report widget, offline queue, and the closed-loop lesson layer for iOS + Android.

> **One-command setup:** `npx mushi-mushi` auto-detects React Native / Expo and installs this package with the right env vars.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web)

## What this package adds on mobile

Every bug your users feel — a button that won't tap, a screen that freezes, a layout that folds on their device — gets captured, classified by AI, and fed into a lesson library that prevents the same class of mistake in the next PR review and the next AI agent run. That's the closed loop the main [`mushi-mushi`](https://www.npmjs.com/package/mushi-mushi) README describes. This package is the mobile entry point.

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

- Device info (platform, OS version, screen dimensions)
- Console logs (monkey-patched `console.*`)
- Network requests (fetch interceptor, headers redacted)
- Navigation events (React Navigation integration, optional)
- Offline queue via `@react-native-async-storage/async-storage` — reports survive force-close

## Peer dependencies

- `react` >= 18
- `react-native` >= 0.72
- `@react-navigation/native` >= 6 (optional — navigation capture)
- `@react-native-async-storage/async-storage` >= 1.19 (optional — offline queue)
- `expo-sensors` (optional — shake trigger only)

## Changelog highlights

- **v0.11.0** — Hermes compatibility fix: replaced `new Function()` dynamic imports with lazy `require()` for `@react-native-community/netinfo` and `expo-sensors`. Enables `trigger: 'button'` safely on all RN 0.84+ Hermes/AOT builds. Adds `MushiTrigger` headless component.
- **v0.8.x** — Shake-to-report listener, offline queue, navigation capture.

See the full [CHANGELOG](https://github.com/kensaurus/mushi-mushi/blob/master/packages/react-native/CHANGELOG.md).

## License

MIT


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (June 2026): 43 edge functions · 234 SQL migrations · 13 outbound plugins · 11 inbound adapters. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
