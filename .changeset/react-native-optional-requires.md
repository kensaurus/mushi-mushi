---
"@mushi-mushi/react-native": patch
---

Fix: optional native modules no longer crash Metro apps. Versions 0.21–0.23 loaded `@react-native-community/netinfo`, `react-native-view-shot` and `expo-sensors` through an esbuild `__require()` shim that Metro can not resolve. The app crashed even though the SDK caught errors, so dogfood apps needed a postinstall patch. The built files now hold literal `require("<module>")` calls inside `try/catch`, and the build fails if any shim call is left. You can also pass the modules in: `<MushiProvider netInfo={NetInfo} viewShot={ViewShot} expoSensors={ExpoSensors}>`, which skips loading entirely. Drop any `__require` → `require` patch when you upgrade.
