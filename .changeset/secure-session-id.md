---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
---

- **Crypto-strong session ids**: the SDK now derives its session correlation id from the WebCrypto capability ladder (CSPRNG) the same way `newUuid()` does, instead of `Math.random()` — falling back to `Math.random` only on runtimes without WebCrypto. Resolves CodeQL `js/insecure-randomness`; a session id is a correlation identifier, not a secret, so behaviour is unchanged. `@mushi-mushi/web` is bumped because its `<script>`-tag global loader inlines `@mushi-mushi/core` and must be rebuilt to ship the fix.
