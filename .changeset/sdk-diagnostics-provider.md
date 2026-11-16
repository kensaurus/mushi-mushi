---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react-native": minor
---

**`setDiagnosticsProvider()`** attaches your app's own diagnostics (load timings, recent errors, connection) at the moment the reporter presses Send. The function gets 300 ms, its strings are scrubbed for personal data, and the result is size-capped. A slow or throwing provider never blocks or drops the report. Its keys merge into the report's metadata, and triage now reads `screenLoading` / `timings` lines as evidence.

React Native also gets:
- **App version.** `reports.app_version` now comes from the new `appVersion` option, then `expo-application` (version and build) or `react-native-device-info`. It never falls back to the OS version, which made Expo apps report Android's `36`.
- **`loadMyReports()`.** It resolves `null` when the list could not be loaded, so the report sheet shows an error with Retry instead of "no reports". `listMyReports()` keeps returning `[]` on failure.
