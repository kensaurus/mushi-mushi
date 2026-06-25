---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
---

Generate the SDK session id with the WebCrypto capability ladder (the same one
`newUuid()` uses) instead of `Math.random()`. Resolves CodeQL
`js/insecure-randomness` flagged on the session id flowing into report
payloads. A session id is a correlation identifier, not a secret, so behaviour
is unchanged — but it now prefers a CSPRNG and only falls back to `Math.random`
on runtimes without one. `@mushi-mushi/web` is bumped because its `<script>`-tag
global loader inlines `@mushi-mushi/core`, so it must be rebuilt to ship the fix.
