---
'@mushi-mushi/mcp': patch
---

`McpBuildInput` takes an optional `pinSpec` so a host can write the published `@mushi-mushi/mcp` version into stdio configs instead of the version it was built with. Only an exact `@mushi-mushi/mcp@<semver>` is used; anything else falls back to `MCP_PIN_SPEC`.
