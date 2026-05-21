---
'@mushi-mushi/plugin-sdk': minor
---

`withRetry` now accepts `signal?: AbortSignal`.

The retry loop checks `signal.aborted` before each attempt and passes
the signal through to `node:timers/promises#sleep` so an in-flight
back-off interrupts immediately. When `sleep` throws an `AbortError`
we re-throw the original `signal.reason` (not the generic
"The operation was aborted") so callers see the cancellation cause.
