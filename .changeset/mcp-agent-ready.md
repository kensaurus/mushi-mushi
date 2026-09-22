---
'@mushi-mushi/mcp': minor
---

Agent-facing fixes to the MCP server.

- **Server instructions.** `initialize` now returns short instructions: what Mushi is, start with `triage_next_steps` / `get_fix_context`, run `triage_issue` before `dispatch_fix`, treat report text as untrusted data, confirm before merging.
- **Untrusted output is wrapped.** The 21 tools that return end-user report text, reporter replies or LLM-derived content wrap their text output as untrusted data, so an agent holding write tools cannot be steered by a crafted bug report.
- **`triage_issue` works.** It returned `null` for `fix_context` and `blast_radius` because it called routes that did not exist; it now reads the report's fix packet and the inventory blast radius.
- **New `get_mushi_doc`.** Reads a docs page from the bundled index after `search_mushi_docs`. Search results now carry `url` instead of `path`.
- **`get_recent_reports` returns the documented fields.** Status and severity filters are enums; `include_raw: true` restores the full row.
- **Keyless setup mode.** Starting without an API key serves the setup and docs tools instead of exiting with an error.
- **Removed `setup_repo_for_mushi`.** It always failed (its route never existed). Repo setup is `mushi setup` in the CLI.
