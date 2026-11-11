---
'@mushi-mushi/mcp': patch
---

Mark Claude Code in the client registry (`MCP_CLIENTS`) with `oauthDefault`: a surface that can run the OAuth sign-in leads with the keyless `buildOAuthInstall('claude-code', …)` command, and `build()` (the `--header "Authorization: Bearer …"` command) is the variant for CI or headless use. `McpClientDef.oauthDefault` is the new optional field; the Claude Code description now says there is no key to copy.
