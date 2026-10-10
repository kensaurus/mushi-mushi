---
"@mushi-mushi/capacitor": patch
---

iOS: the offline queue flushes one report at a time in order, stops at the first failure and clears only what was delivered. A failed report keeps its place, is no longer re-queued as a duplicate, and is not lost when a later one succeeds. Overlapping flushes no longer run at once, and `flushQueue()` resolves with the real delivered count instead of always `0`.
Android: `setMetadata(key, null)` removes the key instead of storing a JSON null placeholder. Report context `timestamp` is an ISO-8601 string like iOS and the JS SDKs. The native report sheet sizes its padding and corners in dp, so it looks the same on every screen density. Version overrides resolve through `findProperty`, so a value set only in `gradle.properties` no longer fails the build.
