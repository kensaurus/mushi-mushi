---
"@mushi-mushi/mcp": minor
---

Support org-scoped account keys and harden stdio logging.

- **Account mode**: an org-scoped API key (no `MUSHI_PROJECT_ID` required) now
  lets the server resolve project IDs per tool call and exposes an enriched
  `get_account_overview` (accessible projects with report counts + MCP key
  stats). `list_projects` reflects account-mode capabilities. Project-scoped
  keys keep their single-project restriction.
- **stdio fix**: all logger and `console.*` output is routed to stderr so stdout
  carries only JSON-RPC. This stops the Cursor/Claude stdio transport from being
  corrupted by non-protocol bytes (the cause of intermittent red-badge
  "transport error" connections).
