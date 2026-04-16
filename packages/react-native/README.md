# @mushi/react-native

React Native SDK for Mushi Mushi. Shake-to-report, bottom sheet widget, offline queue.

## Usage

```tsx
import { MushiProvider } from '@mushi/react-native'

export default function App() {
  return (
    <MushiProvider projectId="proj_xxx" apiKey="mushi_xxx">
      <Navigation />
    </MushiProvider>
  )
}
```

### Hooks

```ts
import { useMushi, useMushiReport } from '@mushi/react-native'

const { submitReport } = useMushiReport()
```

### Captures

- Device info (platform, OS, screen dimensions)
- Console logs (monkey-patched)
- Network requests (fetch/XMLHttpRequest interceptor)
- Navigation events (React Navigation integration, optional)
- Offline queue via AsyncStorage

## Peer Dependencies

- `react` >= 18
- `react-native` >= 0.72
- `@react-navigation/native` >= 6 (optional)
- `@react-native-async-storage/async-storage` >= 1.19 (optional)

## License

MIT
