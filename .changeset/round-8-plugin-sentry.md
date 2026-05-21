---
'@mushi-mushi/plugin-sentry': patch
---

Lock the Sentry User Feedback API path with explicit test coverage.

The User Feedback path (preferred when an org auth token + a real
`sentry_event_id` are both available) was previously only validated by
manual smoke checks. Round 8 adds 5 specs covering: 200 happy path,
409 idempotent re-delivery, 401 → 500 (so the dispatcher retries
upstream), `sentry_event_id` missing → fall back to Store, auth token
missing → fall back to Store. No runtime behaviour change.
