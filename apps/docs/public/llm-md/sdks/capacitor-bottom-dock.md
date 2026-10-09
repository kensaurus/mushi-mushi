# Capacitor bottom dock

Source: https://kensaur.us/mushi-mushi/docs/sdks/capacitor-bottom-dock

---
title: Capacitor bottom dock
description: Keep the Mushi bug-report button clear of tab bars and bottom docks in Capacitor apps with triggerInsetPreset, explicit insets, or widget.anchor.
---

# Capacitor bottom dock

Use `triggerInsetPreset` for common mobile chrome:

```ts
import { Mushi, triggerInsetPresets } from '@mushi-mushi/capacitor'

await Mushi.configure({
  projectId: '...',
  apiKey: 'mushi_...',
  triggerMode: 'both',
  triggerInsetPreset: 'tabBarSafe',
})
```

Explicit insets win over presets:

```ts
await Mushi.configure({
  projectId: '...',
  apiKey: 'mushi_...',
  triggerInset: {
    bottom: triggerInsetPresets.dockSafe.bottom + 12,
    trailing: 20,
    end: 20,
  },
})
```

For Ionic or React Native Web shells that render the web widget inside the WebView, use the browser SDK `widget.anchor` with your app's CSS tokens.
