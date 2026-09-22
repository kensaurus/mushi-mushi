---
'@mushi-mushi/mcp': patch
'@mushi-mushi/core': patch
---

The stdio MCP server shows up in usage, and stops polling with a key that cannot read.

- **Tool calls are attributed.** Every API request now carries `X-Mushi-Client: mcp-stdio/<version>`, and requests made inside a tool call carry the tool name and a random per-call id. The API records one `mcp_tool_invocations` row per call and counts `get_report_detail`, `get_fix_context`, `suggest_fix` and `dispatch_fix` as report opened, fix pulled and fix dispatched, as it already did for the hosted server. No arguments or report content are sent.
- **The inventory poll stops on 401/403.** A key without `mcp:read` used to be retried every minute forever with no explanation. The server now logs once that inventory change notifications are off and why.
- **`HABIT_EVENTS` includes `fix_dispatched`,** and taxonomy events emitted from both the console and MCP list both surfaces.
