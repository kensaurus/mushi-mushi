---
"@mushi-mushi/cli": patch
---

`mushi setup --ide claude` / `--ide cursor` no longer writes a hosted MCP entry that Claude Code cannot sign in to. For Mushi Cloud it writes `https://kensaur.us/mushi-mushi/hosted-mcp/` instead of the raw `…supabase.co/functions/v1/mcp` URL, where sign-in failed with "Dynamic Client Registration rejected (HTTP 404): {"error":"requested path is invalid"}". A self-hosted Claude Code entry names the function's OAuth metadata through Claude Code's `oauth.authServerMetadataUrl`.
`mushi doctor` flags an existing key-less Claude Code entry on a `supabase.co` URL and says how to fix it.
