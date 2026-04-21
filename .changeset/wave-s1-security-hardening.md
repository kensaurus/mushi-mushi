---
'@mushi-mushi/core': minor
'@mushi-mushi/web': minor
'@mushi-mushi/react': minor
---

Wave S1 — security hot patches.

- `@mushi-mushi/core`: client-side PII scrubbing parity with server (emails, phone, credit cards, US SSN, bearer tokens, API keys, UK IBAN/sort codes, IPv4/IPv6); new `MushiOfflineConfig.encryptAtRest` option that wraps the offline queue in AES-GCM 256 via Web Crypto + IndexedDB (non-extractable key). Legacy plaintext rows remain readable during a one-time migration.
- New `MushiSDKInstance.captureEvent(input)` for programmatic bug reports outside a user-driven click (obeys rate-limit, PII scrub, and offline queue) and `identify(userId, traits?)` as an ergonomic alias for `setUser` with merged traits.
