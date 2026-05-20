---
"@mushi-mushi/web": patch
---

Add dev-only marketing recorder bridge (`exposeMarketingRecorder`) to `@mushi-mushi/web`.

Exposes `window.__mushiRecorder` when the SDK is initialised with `debug: true`,
giving Playwright scripts DOM-independent access to the shadow-DOM widget steps
(trigger, category, intent, description, submit) for GIF/screenshot recording.
The bridge is tree-shaken in production builds where `debug` is false.
