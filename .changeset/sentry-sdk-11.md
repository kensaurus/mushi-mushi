---
"@mushi-mushi/mcp": patch
---

The optional `@sentry/node` peer now accepts `^10.57.0 || ^11.0.0`. With SDK 11, which removed `sendDefaultPii`, init passes an explicit `dataCollection` that turns off user info, cookies, headers, bodies, query params, AI/MCP payloads, queue arguments and stack-frame variables.
