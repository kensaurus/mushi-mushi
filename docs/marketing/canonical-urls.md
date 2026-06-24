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
| Hosted HTTP MCP (direct Supabase) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp` | ✅ |
| Smithery upstream (CloudFront proxy) | `https://kensaur.us/mushi-mushi/hosted-mcp/` | ✅ |
| Origin RFC 9728 PRM (Smithery probe) | `https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp` | ✅ |
| Hosted MCP (lean features) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs` | ✅ |
| MCP server card (Smithery scan fallback) | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/.well-known/mcp/server-card.json` | ✅ |

## Aliases — do not use in listings until verified

| Alias | Status (Jun 2026) |
| --- | --- |
| `docs.mushimushi.dev` | 503 — use `kensaur.us/mushi-mushi/docs/*` |
| `api.mushimushi.dev` | 503 — use Supabase project URL above |
| `mushimushi.dev` | Not the deployed product home |
| `app.mushimushi.dev` | Not verified — use `kensaur.us/mushi-mushi/admin` |

Matches `DEFAULT_MUSHI_API_ENDPOINT` in `apps/admin/src/lib/cliSetupCommands.ts` and
`MUSHI_WEBSITE_URL` in `packages/mcp/src/branding.ts`.
