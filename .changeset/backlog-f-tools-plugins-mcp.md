---
"@mushi-mushi/mcp": patch
---

- The deprecated `setup_check`, `ingest_setup_check` and `diagnose_connection` aliases now run `diagnose_setup` in their original scope (dispatch, ingest and full) unless you pass a `mode`, so `ingest_setup_check` no longer reports dispatch blockers.
- The deprecation notice on an alias call now comes after the tool's own output, so configs that parse the first content block as JSON keep working.
