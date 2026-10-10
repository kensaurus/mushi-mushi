---
"@mushi-mushi/core": patch
---

Destroying and re-initialising the session tracker on the same page no longer sends two `session_end` events for each page hide.
Session ids keep the full entropy of their random suffix; about half used to lose their last digit.
New `MushiInitConfig` type: a `MushiConfig` whose `projectId` / `apiKey` may come from env vars.
New `MushiRuntimeWidgetConfig` type: the runtime config's widget block allows `triggerText: null`, which older edge functions send.
The `screenshotProvider` docs now say the provider must resolve to a `data:image/` URL, and the session payload docs say `user_id_hash` is a hash of the host user id.
A queued report rejected with HTTP 401 or 403 (revoked or mis-scoped key) is dropped on the first rejection instead of being retried on later flushes.
