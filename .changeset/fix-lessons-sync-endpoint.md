---
"@mushi-mushi/server": patch
---

feat(server): add /v1/sync/lessons API-key-authenticated endpoint

Adds GET /v1/sync/lessons authenticated with `apiKeyAuth` (project API key),
so `npx @mushi-mushi/cli sync-lessons` and the MCP server can pull lessons
without requiring an interactive Supabase JWT login. The admin /v1/admin/lessons
endpoint is unchanged — it continues to require JWT auth.
