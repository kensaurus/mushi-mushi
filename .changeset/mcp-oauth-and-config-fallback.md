---
'@mushi-mushi/mcp': minor
---

The stdio MCP server now works with zero env configuration, and the hosted endpoint supports real OAuth login.

- When `MUSHI_API_KEY` / `MUSHI_PROJECT_ID` are unset (or expand to empty strings via `${VAR:-}` defaults), the server falls back to the CLI config at `~/.config/mushi/config.json` — so `mushi login` alone is enough to power the MCP server. It logs its resolved endpoint on startup and warns loudly when self-hosted signals point at Mushi Cloud.
- The hosted HTTP endpoint (`…/functions/v1/mcp`) now speaks the standard MCP OAuth flow (authorization code + PKCE + dynamic client registration): `claude mcp add --transport http mushi <url>` then `claude mcp login mushi` opens the console consent page and mints a revocable project API key (label `mcp-oauth`) — no keys to copy. Static `Authorization` headers still work for headless orchestrators.
