---
'@mushi-mushi/core': patch
---

Offline-queue and circuit-breaker resilience fixes: `flush()` is now re-entrancy-safe (timer + visibility + manual flushes coalesce into one pass — no more double-submitted reports), HTTP 429 opens the circuit breaker and honors `Retry-After` instead of resetting the breaker and dropping the report, every retry path now counts toward `MAX_DELIVERY_ATTEMPTS` (unclassified errors no longer retry forever), `CIRCUIT_OPEN` fast-fails no longer burn delivery attempts, and IndexedDB→localStorage fallback no longer orphans queued rows (unified read/write path + upsert-by-id in the localStorage backend). Also restores auth headers on network-error retries.
