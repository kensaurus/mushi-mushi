---
'@mushi-mushi/mcp': patch
---

Fix `dispatch_fix` failing MCP output validation after the dispatch already fired: the REST API returns `{ dispatchId, status }` but the tool's declared outputSchema promised `{ fixId, status }`, so strict clients (Claude Code, Cursor) reported an error for every successful dispatch — the "auto-fix doesn't work" experience. The handler now maps `dispatchId → fixId`, `get_fix_timeline` accepts the dispatch id immediately (server-side change), and dispatch is safely retryable via `idempotencyKey`.

Also: new `triage_next_steps` tool (the prioritised "what should I work on now" list — previously only an MCP prompt most clients never surface), blocked-fix-aware `triage_issue` recommendations (reads the new `autofix_blocked` stamp instead of re-recommending a doomed dispatch), `suggest_fix` explains when no Stage-2 analysis exists instead of returning all nulls, `transition_status` gains the `triaged` / `in_progress` workflow states, and `use_mushi` intent routing no longer names phantom tools.

Resilience: every API call now has a timeout (default 15s, `MUSHI_MCP_TIMEOUT_MS` override) with distinct `MUSHI_TIMEOUT` / `NETWORK_ERROR` / `REQUEST_ABORTED` errors instead of an indefinite hang; `submit_fix_result` derives a stable idempotency key so retries stop double-writing; the stdout purity guard now covers every console method on both entrypoints (no more JSON-RPC frame corruption from `console.table` et al.); unhandled rejections no longer kill the server mid-session; a missing API key prints a full diagnostic of every source checked instead of a one-liner; and network failures during project resolution are no longer misreported as configuration errors.
