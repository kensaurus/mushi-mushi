---
"@mushi-mushi/core": minor
---

Add a `destination` option to `createLogger` (`'stdout'` default, or `'stderr'`).

stdio MCP servers use stdout as the JSON-RPC protocol pipe, so any non-protocol
bytes written there corrupt the connection. Logging to `'stderr'` keeps stdout
clean for the transport while preserving structured log output. Existing callers
are unaffected — the default remains `'stdout'`.
