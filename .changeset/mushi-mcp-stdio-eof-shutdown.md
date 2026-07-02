---
"@mushi-mushi/mcp": patch
---

Fix the stdio server never exiting once its client closes stdin. The
inventory-poll `setInterval` (added for `notifications/resources/updated`
push support) was never `.unref()`'d and there was no `stdin`/`SIGTERM`/
`SIGINT` handler, so the Node.js event loop stayed alive forever after EOF.
Real MCP clients (Cursor, Claude Desktop) never hit this because they kill
the child process directly on shutdown instead of waiting for it to exit on
its own — but external Docker introspection harnesses that pipe requests
over stdio, close the pipe, and wait for a natural exit (e.g. Glama's build
test) do, and the server would hang until the harness timed out and reported
a failure. Added an explicit graceful-shutdown path plus a CI smoke-test
regression guard (`packages/mcp/scripts/smoke-stdio.mjs`) that spawns the
built binary, closes stdin, and asserts it exits within 8s.
