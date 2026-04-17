# @mushi-mushi/react-native

React Native SDK for Mushi Mushi — built-in bottom-sheet widget, floating bug button, offline queue.

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
| `'manual'` | No auto-UI — call `open()` programmatically |

### Hooks

```ts
import { useMushi, useMushiReport, useMushiWidget } from '@mushi-mushi/react-native'

const { submitReport } = useMushiReport()
const { open, close } = useMushiWidget()
```

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
