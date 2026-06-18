---
"@mushi-mushi/react-native": minor
---

Report payload + identity parity with the web SDK, and a web-parity bottom sheet.

- **Reporter identity (fixes anonymous-token reporter):** `submitReport` now emits nested `metadata.user = { id, email, name, provider }` — the shape the server's `resolveEndUser()` reads — while keeping the flat `userId/userEmail/userName` keys for back-compat. Adds a `setUser()` alias next to `identify()`.
- **Sentry-level payload:** every report now carries a per-launch `sessionId`, `sdkPackage`/`sdkVersion`/`appVersion`, a device `fingerprintHash`, and a 50-entry breadcrumb ring buffer that is also sent as a derived repro `timeline` (so the admin "Repro timeline" renders instead of nudging "Upgrade the SDK"). New `addBreadcrumb()` method; `setScreen()` auto-adds a navigation breadcrumb.
- **Screenshots:** new `capture.screenshot` config flag (default on) gating the optional `react-native-view-shot` capture; documented masking guidance for sensitive screens.
- **Design parity:** `MushiBottomSheet` restyled to mirror the web widget — neon-lime (`#0FFF50`) branded header and accent, dark-ink text on accent surfaces, and clearer "Your reports" / "Community" tabs.
