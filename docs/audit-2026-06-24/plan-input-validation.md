# Input-Validation & Trust-Boundary Audit — mushi-mushi

_Implemented 2026-06-24. See git history for file-level changes._

## Summary

Phases 1–4 shipped:

- **Mass assignment:** Experiments PATCH allowlists (Zod strict schemas)
- **SSRF:** `assertSafeOutboundUrl` on map-from-live, story-mapper, plugin dispatch, A2A push URLs; Firecrawl fail-closed in production when allowlist empty
- **Webhooks:** Empty secret rejected in `@mushi-mushi/node` rewards handler and OpenAI fine-tuning route; plugin registration requires webhook secret when URL set
- **SDK ingest:** Span 8KB cap (413), screenshot data URL server cap aligned with client
- **XSS:** Intelligence HTML sanitized + tightened CSP
- **Uploads:** Codebase path normalization rejects `..` and absolute paths
- **MCP/CLI:** Explicit no-arg input schema constant; CLI `requireUuid` on destructive fix commands

## Verification

```bash
pnpm --filter @mushi-mushi/node test   # rewards empty-secret guard
pnpm --filter @mushi-mushi/cli test    # requireUuid + structured errors
# Manual: SSRF probes against map-from-live with http://169.254.169.254/ → 400 UNSAFE_URL
```
