---
'@mushi-mushi/mcp': minor
---

Tool parameters, outputs and install footprint.

- **One parameter spelling.** Every tool parameter is camelCase now (`projectId`, `reportId`, `includeRaw`, `diffText`, `runId`, …). Tools used to mix `reportId` with `project_id` in one schema. The old snake_case spelling still works on every tool, on stdio and on the hosted server, and each renamed parameter says so in its description.
- **Enums where the values are fixed.** `list_gate_findings` takes the real gate ids (`dead_handler`, `mock_leak`, …) and finding severities (`info`, `warn`, `error`); the old description listed values that matched nothing. `list_skills` category, `search_codebase` mode (now also an input) and every agent the dispatch route accepts on `dispatch_fix` are enums too.
- **Typed report outputs.** `get_report_detail` returns the documented report fields under a typed output schema, with `includeRaw: true` for every column. `triage_issue` has a typed output schema, reads the newest fix attempt, and suggests `get_fix_timeline` with a fix id. Reporter identifiers (end-user id, reporter token, session id, display name) are never returned, and `get_report_evidence` no longer returns the session id.
- **Output fixes.** `merge_fix` declares the `justMerged` and `sha` fields the merge route returns, so strict clients no longer reject a merge that went through. `get_usage` returns structured content and honours `projectId`.
- **Sentry is optional.** `@sentry/node` is an optional peer dependency, about half of the previous install size. Set `MUSHI_MCP_SENTRY_DSN` and install `@sentry/node` to report the server's own errors; without the DSN it is never loaded.
- **Unexpanded variables are caught.** If your MCP client passes `${MUSHI_API_KEY}` through literally, the server no longer sends it to the API as a key: it falls back to your `mushi login` config or starts in setup mode, and says which variable syntax your client expands.
- **Registry listing.** The MCP registry entry no longer requires an `Authorization` header for the hosted server, so clients can sign in with OAuth.
