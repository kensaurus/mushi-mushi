---
"@mushi-mushi/cli": minor
"@mushi-mushi/mcp": patch
"mushi-mushi": patch
---

fix(cli): robust sync endpoints, new commands, shell-safe setup wizard

**CLI v0.7.0 additions:**
- New commands: `whoami`, `ping`, `reports resolve/reopen/dismiss/search`, `lessons list/show`
- All commands use `/v1/sync/*` API-key-authenticated endpoints — no Supabase JWT required
- Robust `apiCall()`: safe JSON parsing, 15 s timeout, typed `ApiResult<T>`, clear exit codes (0/1/2/3)
- Config loading now respects `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, `MUSHI_API_ENDPOINT` env vars over `~/.mushirc`

**Server `/v1/sync/*` endpoints (apiKeyAuth):**
- `GET /v1/sync/whoami` — verify key + return project name and report summary
- `GET /v1/sync/stats` — accurate DB-level counts (no 1 000-row cap) for status/severity/fixes/lessons
- `GET /v1/sync/reports` + `GET /v1/sync/reports/:id` + `PATCH /v1/sync/reports/:id` — list, show, triage/resolve/reopen/dismiss
- `GET /v1/sync/lessons/:id` — fetch a lesson by ID
- `POST /v1/sync/codebase/upload` — ingest source file into the vector index

**Bug fixes:**
- `@mushi-mushi/mcp` setup guidance now uses the correct package name (`@mushi-mushi/mcp`, not `mushi-mcp`)
- `/v1/sync/stats` uses DB-level HEAD count queries instead of client-side row counting, eliminating silent 1 000-row cap
- Setup wizard SDK banner respects the user's selected framework tab when detection confidence < 50%
- frameworkDetect uses shell-safe `your-app` placeholder (no angle brackets) and `your-app` fallback (no spaces)
