---
'@mushi-mushi/node': patch
---

`mushiHonoErrorHandler`'s fallback can now answer with `c.text()` or `c.json()`, as in Hono's docs and our README (`(err, c) => c.text('Server error', 500)`). The handler's context type lacked both methods, so that example failed to type-check.
