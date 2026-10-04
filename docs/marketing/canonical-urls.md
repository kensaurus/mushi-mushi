# Canonical public URLs (listings + GTM)

**Use these verbatim** in directory submissions, `server.json`, `.mcp.json`, and marketing copy.
Do not point cold discovery at subdomains that are not verified live.

| Role | URL | Verified |
| --- | --- | --- |
| Product home | `https://kensaur.us/mushi-mushi` | ✅ |
| Connect (one-click MCP) | `https://kensaur.us/mushi-mushi/docs/connect` | ✅ |
| MCP quickstart | `https://kensaur.us/mushi-mushi/docs/quickstart/mcp` | ✅ |
| Admin console | `https://kensaur.us/mushi-mushi/admin` | ✅ |
| GitHub repo | `https://github.com/kensaurus/mushi-mushi` | ✅ |
| Cloud API (`MUSHI_API_ENDPOINT`) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` | ✅ |
| Hosted HTTP MCP (direct Supabase; API-key header only) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp` | ✅ |
| Hosted MCP for OAuth login (Claude Code, Cursor, any client without a key header) | `https://kensaur.us/mushi-mushi/hosted-mcp/` | ✅ |
| Origin RFC 9728 PRM (Smithery probe) | `https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp` | ✅ |
| Hosted MCP (lean features) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs` | ✅ |
| MCP server card (Smithery scan fallback) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/.well-known/mcp/server-card.json` | ✅ |

**OAuth needs the kensaur.us URL.** MCP clients that log in look for OAuth
metadata at the root of the server's host (RFC 9728 / RFC 8414 path insertion,
e.g. `/.well-known/oauth-protected-resource/functions/v1/mcp`). On
`supabase.co` that root belongs to Supabase's gateway, so Claude Code's login
failed with "HTTP 404" (2026-10-04). The CloudFront host serves those paths. Use
the direct Supabase URL only with an `Authorization` / `X-Mushi-Api-Key` header.

## Aliases — do not use in listings until verified

| Alias | Status (Jun 2026) |
| --- | --- |
| `docs.mushimushi.dev` | 503 — use `kensaur.us/mushi-mushi/docs/*` |
| `api.mushimushi.dev` | 503 — use Supabase project URL above |
| `mushimushi.dev` | Not the deployed product home |
| `app.mushimushi.dev` | Not verified — use `kensaur.us/mushi-mushi/admin` |

**Single source of truth:** `MUSHI_CANONICAL_URLS` in `@mushi-mushi/brand`
(`packages/brand/src/index.js`). Scripts and packages should import from there
instead of hardcoding. Also matches `DEFAULT_MUSHI_API_ENDPOINT` in
`apps/admin/src/lib/cliSetupCommands.ts` and `MUSHI_WEBSITE_URL` in
`packages/mcp/src/branding.ts`.
