---
"@mushi-mushi/core": patch
---

**Fix: SHA-256/HMAC-SHA-256 no longer crashes on Hermes (React Native)**

`sha256Hex` and `hmacSha256Hex` in the reporter API client now use a new
`digest.ts` module that falls back to `@noble/hashes` when `globalThis.crypto`
is unavailable (Hermes on Android, some React Native edge cases). The Web Crypto
fast path is preserved for browsers, Deno, and Node.js.

This fixes `YEN-YEN-MOBILE-3R`: `ReferenceError: Property 'crypto' doesn't
exist` that crashed `listMyReports()` on Android Hermes (`react-native@0.83.6`,
Hermes 0.14.1) whenever the Mushi reporter sheet opened.

Fixes [YEN-YEN-MOBILE-3R](https://sakuramoto.sentry.io/issues/7564510353/).
