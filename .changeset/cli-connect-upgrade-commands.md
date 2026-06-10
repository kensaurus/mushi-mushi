---
"@mushi-mushi/cli": minor
---

feat(cli): one-shot `mushi connect` + `mushi upgrade` commands

- `mushi connect --api-key … --project-id … --endpoint …` saves credentials, merges `.env.local` env vars, wires `.cursor/mcp.json`, and (with `--wait`) polls the ingest-setup endpoint until the SDK heartbeat lands. The key can also come from the `MUSHI_API_KEY` env var (keeps it out of shell history), and `--wait` fails fast with a clear message when the backend rejects the credentials instead of polling out the timeout.
- `mushi upgrade` bumps installed `@mushi-mushi/*` packages to the latest stable npm release with `--dry-run` and `--json` support; flags legacy `@mushi-mushi/react` installs and suggests the web SDK migration.
- `mushi doctor` now verifies SDK ingest health (API key → heartbeat → first report) via the new `/v1/sync/ingest-setup` endpoint.
- MCP wiring snippets now reference `@mushi-mushi/mcp@latest` (the old `mushi-mcp` alias is gone).
