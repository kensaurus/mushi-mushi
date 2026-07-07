---
'@mushi-mushi/cli': patch
---

Harden `mushi init` env-file writes against a check-then-read (TOCTOU) race — the file is now read directly with a fallback to empty on miss, instead of `existsSync()`-then-`readFileSync()`.

Ships alongside server-side security fixes to the hosted API edge function (deployed separately): the MCP OAuth consent transaction is now bound to the first authenticated viewer so a signed-in user cannot read, approve, or deny another user's pending authorization (IDOR/DoS); per-IP rate limiting now derives the client IP from the rightmost `X-Forwarded-For` hop (spoof-resistant) and fails **closed** on an unexpected rate-limit RPC error; and the public A2A `refresh_token` grant is now per-IP throttled.
