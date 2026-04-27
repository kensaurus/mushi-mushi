# @mushi-mushi/react-native

React Native SDK for Mushi Mushi — built-in bottom-sheet widget, floating bug button, offline queue.

> **One-command setup:** `npx mushi-mushi` auto-detects React Native / Expo and installs this package.
>
> **Other frameworks:** [`@mushi-mushi/react`](https://npmjs.com/package/@mushi-mushi/react) · [`@mushi-mushi/vue`](https://npmjs.com/package/@mushi-mushi/vue) · [`@mushi-mushi/svelte`](https://npmjs.com/package/@mushi-mushi/svelte) · [`@mushi-mushi/angular`](https://npmjs.com/package/@mushi-mushi/angular) · [`@mushi-mushi/capacitor`](https://npmjs.com/package/@mushi-mushi/capacitor) (Ionic) · [`@mushi-mushi/web`](https://npmjs.com/package/@mushi-mushi/web) (vanilla JS)

## Usage

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

The provider renders a floating 🐛 button and a slide-up bottom sheet by default. Control behavior via `widget.trigger`:

| Value | Behavior |
|-------|----------|
| `'button'` (default) | Shows floating action button |
| `'shake'` | Installs a shake-to-report listener (no visible UI) |
| `'both'` | Floating button + shake listener |
| `'manual'` / `'hidden'` / `'none'` | No auto-UI — call `open()` programmatically |
| `'attach'` | Hides the default UI; the host renders its own button and calls `attachTo()` |

Shake detection requires the optional `expo-sensors` peer dependency. Install
it once with `expo install expo-sensors` (or `npm install expo-sensors`); the
listener is wired lazily so apps that ship `'button'` only never pay the cost.

`widget.inset` (and the `MushiFloatingButton` `inset` prop) accepts
`{ top?, right?, bottom?, left? }` in points so the trigger can clear tab
bars and host CTAs.

```tsx
<MushiProvider
  projectId="proj_xxx"
  apiKey="mushi_xxx"
  config={{
    widget: { trigger: 'both', inset: { bottom: 96, right: 16 } },
  }}
>
  <Navigation />
</MushiProvider>
```

### Hooks

```ts
import { useMushi, useMushiReport, useMushiWidget } from '@mushi-mushi/react-native'

const { submitReport } = useMushiReport()
const { open, close } = useMushiWidget()
```

The provider's `useMushi()` instance also exposes the cross-platform trigger
controls — `show()`, `hide()`, `attachTo(elementRefOrId)`, and
`setTrigger(mode)` — so a host app can toggle the launcher per screen.

### Standalone Components

Use the widget components directly if you need custom integration:

```tsx
import { MushiBottomSheet, MushiFloatingButton } from '@mushi-mushi/react-native'
```

- `MushiBottomSheet` — Conversational bug report modal (category → description → submit). Supports dark/light theme, drag-to-dismiss.
- `MushiFloatingButton` — Positioned FAB with spring animation. Configurable via `buttonPosition`.

### Captures

- Device info (platform, OS, screen dimensions)
- Console logs (monkey-patched)
- Network requests (fetch interceptor)
- Navigation events (React Navigation, optional)
- Offline queue via AsyncStorage

## Peer Dependencies

- `react` >= 18
- `react-native` >= 0.72
- `@react-navigation/native` >= 6 (optional)
- `@react-native-async-storage/async-storage` >= 1.19 (optional)

## License

MIT
