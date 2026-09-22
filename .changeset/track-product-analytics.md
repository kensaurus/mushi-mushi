---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
'@mushi-mushi/react-native': minor
'@mushi-mushi/node': minor
---

Add product analytics: `Mushi.track(event, properties)`, `setConsent()`, `getAnonymousId()` and the `analytics` config block (consent mode, per-person sampling, DNT/GPC, PII key filter). Events batch to the new `POST /v1/sdk/events` route and back the console's Users & Funnels page. `@mushi-mushi/react` gains `useMushiTrack()`; `@mushi-mushi/react-native` gains `useMushi().track()` / `setConsent()` (batched, AsyncStorage spill, flush on app background) and `@mushi-mushi/node` gains `client.track(event, { distinctId, properties })` (one `POST /v1/sdk/events` per call, `surface: 'server'`). The shared vocabulary lives in `@mushi-mushi/core` (`MUSHI_EVENTS`, `sanitizeEventProperties`).

The web widget's `brandFooter` becomes the "Bug reports by Mushi" mark: a new-tab link to the Mushi site carrying `utm_source=widget&utm_medium=powered-by&ref=<hashed project id>` that emits `loop_impression` (once per page) and `loop_click` through the tracker. It is on by default only for Free Cloud projects via the runtime config; an explicit `widget.brandFooter: false` in `Mushi.init` always wins over the remote value.
