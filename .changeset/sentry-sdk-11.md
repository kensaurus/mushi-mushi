---
'@mushi-mushi/mcp': patch
---

The optional `@sentry/node` peer accepts `^10.57.0 || ^11.8.0` (the package is developed against v11). Init sets `dataCollection` so the SDK does not collect user info, cookies, or request bodies after `sendDefaultPii` was removed.
