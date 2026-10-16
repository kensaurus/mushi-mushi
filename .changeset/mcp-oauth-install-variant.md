---
"@mushi-mushi/mcp": minor
---

`@mushi-mushi/mcp/clients` adds `buildOAuthInstall(id, { mcpOAuthUrl })`, a keyless install for Cursor, VS Code, VS Code Insiders, Claude Code, Windsurf and any MCP client. It writes only the hosted URL, with no key and no header, so the client runs its own OAuth sign-in on first use (a static `Authorization` header turns that sign-in off). The public landing page and `/connect` use it; the signed-in console keeps the keyed builders. Its VS Code links use the documented `vscode:mcp/install?{json}` form with the name inside the JSON (the keyed builders are unchanged).
