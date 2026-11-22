---
"@mushi-mushi/react-native": minor
---

- **The console's colour and corner reach React Native apps.** The SDK now reads your project's widget settings once at start and applies the colour (with readable text on it) and the bottom corner you chose in the console, without a new app build. What you set in code still wins (ADR 0068), and `runtimeConfig: false` turns this off. The console's trigger and minimum-length defaults are not applied, so an app that never asked for shake-to-report won't get it.
