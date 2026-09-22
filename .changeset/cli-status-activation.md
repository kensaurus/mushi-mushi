---
'@mushi-mushi/cli': minor
---

`mushi status` prints an `Activation:` line with the project's phase (ingest, dispatch or loop) and the date of its first report, read from `GET /v1/admin/activation`. Keys without the `mcp:read` scope get a hint to run `mushi login --upgrade-scope` instead of a failed status command.

This release also ships `mushi upgrade --check` (exit 0 when current, 1 when outdated, 2 when the registry is unreachable), which merged after 0.27.1 and has not been on npm until now. The package's root export now declares its (empty) types, so TypeScript no longer reports missing declarations for `@mushi-mushi/cli`.
