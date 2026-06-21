---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
---

Add `capture.screenshotProvider` and surface the identified host-app user in the widget.

- **`capture.screenshotProvider`** — an optional `() => Promise<string | null>` that lets a host (e.g. a Capacitor/WebView app) supply a real pixel-accurate screen grab from a native plugin instead of the built-in DOM-snapshot capturer. The built-in capturer is used as a fallback when the provider throws.
- **"Reporting as &lt;name&gt;"** — when the host calls `Mushi.identify()` / `Mushi.identifyWithToken()`, the report details step now shows who the report will be attributed to. Cleared when `identifyWithToken(null)` is called.
