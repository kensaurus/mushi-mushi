---
'@mushi-mushi/node': minor
---

`AbortSignal` propagation.

`MushiNodeClient` now accepts `signal?: AbortSignal` on the constructor
(process-wide cancel — wire it to your shutdown hook so in-flight
captures abort cleanly during graceful shutdown) and on
`captureReport` / `captureException` (per-call cancel — wire it to your
request signal so a cancelled request doesn't hold up the timeout).

Multiple signals compose via a new `composeSignals` utility. Uses
`AbortSignal.any` on Node ≥ 20 with a custom shim for Node 18.
