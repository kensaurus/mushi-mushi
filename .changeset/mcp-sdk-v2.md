---
'@mushi-mushi/mcp': minor
---

Move the MCP server onto the Model Context Protocol TypeScript SDK v2
(`@modelcontextprotocol/server` + `@modelcontextprotocol/core`).

The stdio binary now serves 2026-07-28 clients alongside the legacy era:
`server/discover`, the `_meta` envelope, `resultType` on every result, and
`ttlMs` / `cacheScope` on list results. Legacy clients (Cursor, Claude
Desktop, v1 SDK) negotiate `2025-03-26` exactly as before.

Behaviour change: calling a tool that is not registered — a write tool on an
`mcp:read` key, or a tool outside `MUSHI_FEATURES` — now returns JSON-RPC
`-32602 "Tool <name> not found"` instead of an `isError` tool result. Neither
form costs an API round-trip.
