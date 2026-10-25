---
'@mushi-mushi/mcp': patch
---

The optional `@sentry/node` peer is v11. Init sets `dataCollection` so the SDK does not collect user info, cookies, or request bodies after `sendDefaultPii` was removed.
