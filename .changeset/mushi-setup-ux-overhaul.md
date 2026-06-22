---
"@mushi-mushi/cli": minor
"@mushi-mushi/mcp": patch
---

**Setup UX overhaul — dual-scope keys, self-healing doctor, MCP first-call tracking**

### @mushi-mushi/cli (0.21.0)

New features:
- `mushi login --upgrade-scope` — re-authenticate to mint a dual-scope (`report:write + mcp:read`) key. Upgrades pre-Jun-2026 ingest-only keys so MCP and admin CLI work.
- `mushi setup --verify` (on by default) — probes `/v1/admin/mcp/account-overview` after writing `.cursor/mcp.json` and emits `✓ MCP key valid` or a targeted scope-upgrade hint.
- `mushi doctor` now shows `⚠` (advisory) instead of `✗` for "SDK installed" when live heartbeats confirm the SDK is active elsewhere (false-positive from backend/non-app dirs suppressed).
- `mushi doctor --mcp` — `[mcp] account-overview reachable` now shows a targeted `mushi login --upgrade-scope` hint on `INSUFFICIENT_SCOPE` instead of a generic HTTP 403 message.
- `mushi doctor --full` — `--server` check is now gracefully skipped for `report:write`-only keys with a clear upgrade path, instead of failing.

Bug fixes:
- `apiCall` now correctly unwraps nested `{ error: { code, message } }` response bodies so `die()` can display targeted `INSUFFICIENT_SCOPE` hints (was showing generic `HTTP_403`).
- `mushi doctor` heartbeat name mismatch fixed (`[ingest] Last SDK heartbeat` vs `[ingest] SDK heartbeat`) — SDK false-positive downgrade now fires correctly.

### @mushi-mushi/mcp (0.16.2)

Bug fixes:
- `mcp_first_tool_call` funnel signal now correctly intercepts tool calls via `server.server._requestHandlers` instead of a broken `callTool` monkey-patch (which never existed on `McpServer`).
- Funnel signal uses `globalThis.fetch` directly (not the injected `doFetch`) so test stubs don't capture the fire-and-forget ping as unexpected API calls.
