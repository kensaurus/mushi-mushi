---
'@mushi-mushi/core': patch
'@mushi-mushi/web': patch
---

Product analytics no longer travel with the reporter token.

- **Own analytics id.** `Mushi.track()` events are keyed on a random per-project id the tracker creates, stored only once analytics consent is granted. They used to reuse the reporter token, a credential for the end user's report threads. Visitors get a new analytics id once; nothing else changes.
- **Refused batches are not replayed forever.** A batch the server rejects with a 4xx (bad shape, wrong key, too large) is dropped. Network errors, 429 and 5xx are still kept and resent on the next page.
- **`page_view`.** `analytics.autoPageviews` now emits `page_view`, the taxonomy name (it emitted `pageview`).
- **`error.status`.** Failed API calls now include the HTTP status in `MushiApiResponse.error.status` when the server answered.
- `initSessionTracker`'s `reporterTokenHash` option is renamed `reporterToken` (it always carried the raw token); the old name still works.
