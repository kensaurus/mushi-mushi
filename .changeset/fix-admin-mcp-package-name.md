---
"@mushi-mushi/admin": patch
---

fix(admin): correct MCP package name and API endpoint in setup snippet

- `buildCursorJson` now generates `@mushi-mushi/mcp` (correct npm scope) instead of
  the non-existent `mushi-mcp@latest` package name.
- `MUSHI_API_ENDPOINT` in the generated snippet now points to the actual Supabase
  edge function URL instead of the placeholder `api.mushimushi.dev` which doesn't exist.
