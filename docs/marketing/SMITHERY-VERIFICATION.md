# Smithery verification checklist

Registry page: [smithery.ai/servers/kensaurus/mushi-mushi](https://smithery.ai/servers/kensaurus/mushi-mushi)

**Architecture & file index:** [HOSTED-MCP-SMITHERY-IMPLEMENTATION.md](./HOSTED-MCP-SMITHERY-IMPLEMENTATION.md)

## Automated checks

```bash
node scripts/smithery-verification-check.mjs
node scripts/verify-hosted-mcp.mjs
```

## DNS TXT (domain owner action)

Add a **second** TXT record on `kensaur.us` (keep existing records):

| Field | Value |
|-------|--------|
| Host | `@` or `kensaur.us` |
| Type | TXT |
| Value | `smithery-verification=dfb77b92dd51ab706f377b2e05d24ea0952c8346cd167800078abdd9b157aecd` |

Re-check token on **Settings → Verification → TXT record** if Smithery rotates it.

Verify:

```bash
nslookup -type=TXT kensaur.us 8.8.8.8
```

## Backlink

Served at:

- `https://kensaur.us/mushi-mushi/hosted-mcp/smithery-backlink` (CloudFront)
- Connect page + README badge after deploy

Set **Custom backlink URL** (optional) to the hosted-mcp path above.

## Quality score

Republish after server-card changes:

```bash
npx @smithery/cli mcp publish "https://kensaur.us/mushi-mushi/hosted-mcp/" \
  -n kensaurus/mushi-mushi --config-schema docs/marketing/smithery-config-schema.json
```

## Paid developer plan

Requires upgrading the Smithery org plan in billing — not automatable from this repo.
