---
'@mushi-mushi/cli': patch
'@mushi-mushi/mcp': patch
---

CLI and MCP correctness fixes.

## `@mushi-mushi/cli`
- **Fix `fix.status` event name**: the `fix poll` loop was emitting `poll.status`
  instead of the documented `fix.status`. Fixes `--json` consumers and
  automations that subscribe to fix lifecycle events.
- **Fix ESM-safe `unlinkSync`**: `migrateLegacyConfig` was using a
  `require('fs').unlinkSync` inside an ESM module. Switched to a named import.

## `@mushi-mushi/mcp`
- **Fix scope fallback on typo**: if `MUSHI_SCOPES` is set but contains only
  unrecognised values (e.g. a typo like `mcp:writes`), the MCP server now falls
  back to `ALL_SCOPES` instead of registering zero tools and silently deregistering
  the entire tool surface. Only an explicitly empty `MUSHI_SCOPES=""` opts in to
  zero tools.
