---
"@mushi-mushi/core": patch
---

Harden `getSubtle()` to require a full SubtleCrypto surface (`digest`, `importKey`, `sign`) before using the Web Crypto fast path. Fixes Hermes partial `crypto.subtle` polyfills that threw `Cannot read property 'digest' of undefined` (YEN-YEN-MOBILE-3T).
