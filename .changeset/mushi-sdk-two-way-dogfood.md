---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react": minor
"@mushi-mushi/vue": minor
"@mushi-mushi/svelte": minor
"@mushi-mushi/angular": minor
"@mushi-mushi/react-native": minor
"@mushi-mushi/capacitor": minor
---

Ship SDK dogfood hardening and a two-way reporter channel.

- Ignore Mushi's own config/report/notification requests in network capture and proactive API cascade detection.
- Add `Mushi.diagnose()` for endpoint, CSP, widget, capture, runtime-config, and SDK-version health checks.
- Send `sdkPackage` and `sdkVersion` with reports, expose `/v1/sdk/latest-version`, and surface outdated SDK state in the widget.
- Add `widget.anchor`, deployment presets, privacy screenshot masks/blocks, screenshot removal, `setScreen()`, and normalized repro timelines.
- Add reporter history/reply APIs so the widget can show report status, developer replies, and reporter responses.
- Add Capacitor bottom-dock trigger inset presets.
