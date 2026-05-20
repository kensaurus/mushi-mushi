---
"@mushi-mushi/cli": patch
"mushi-mushi": patch
---

fix(cli): accept UUID project IDs and read config from env vars

- `PROJECT_ID_PATTERN` now accepts both UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
  and the `proj_xxx` prefix format. All existing projects use UUID format from
  `gen_random_uuid()`. The `proj_xxx` format was never actually used by the backend.
- `loadConfig()` now overlays `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, and
  `MUSHI_API_ENDPOINT` env vars over the `~/.mushirc` file so CI pipelines and
  `npx @mushi-mushi/cli sync-lessons` work without an interactive `mushi init` first.
- Error messages, placeholders and the non-interactive example now show the UUID format.
- `sync-lessons` command now calls `/v1/sync/lessons` (API-key-authenticated) instead of
  `/v1/admin/lessons` (JWT-authenticated) so it works with the project API key.
