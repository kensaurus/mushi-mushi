---
"@mushi-mushi/cli": minor
---

Add MCP-aware setup and diagnostics to the CLI.

- `mushi doctor --mcp` inspects `.cursor/mcp.json` for a Mushi server entry,
  validates the configured API key, and probes the account-overview endpoint so
  a misconfigured MCP connection is caught locally instead of surfacing as a red
  badge in Cursor.
- `mushi setup --all-projects` resolves every accessible project (names fetched
  from the API) and writes one MCP server entry per project, for operators who
  triage more than one project from the same client.

Both additions are backward-compatible — existing `mushi setup` / `mushi doctor`
invocations behave exactly as before.
