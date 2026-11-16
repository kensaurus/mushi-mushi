---
"@mushi-mushi/mcp": patch
---

The optional `@sentry/node` peer accepts `^10.57.0 || ^11.0.0` (developed against v11). Init sets `dataCollection` so a v11 SDK does not collect user info, cookies, request bodies, or queue payloads after `sendDefaultPii` was removed.
