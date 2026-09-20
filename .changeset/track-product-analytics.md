---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
---

Add product analytics: `Mushi.track(event, properties)`, `setConsent()`, `getAnonymousId()` and the `analytics` config block (consent mode, per-person sampling, DNT/GPC, PII key filter). Events batch to the new `POST /v1/sdk/events` route and back the console's Users & Funnels page. `@mushi-mushi/react` gains `useMushiTrack()`. The shared vocabulary lives in `@mushi-mushi/core` (`MUSHI_EVENTS`, `sanitizeEventProperties`).
