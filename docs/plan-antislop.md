# Anti-Slop Burndown — GTM / directory listings (mushi-mushi)

_Executed Jun 2026. Repo + mcp.so live; Smithery republish pending signed-in release._

## Scope

- Surfaces audited: [x] Prose  [ ] Visual  [x] Code  [x] Structure
- In scope: `docs/marketing/*`, `packages/mcp/server.json`, `.mcp.json`, mcp.so + Smithery listing fields, root + MCP README badges
- Out of scope: landing page body on kensaur.us, full tool tables in `packages/mcp/README.md`

## Slop score (after execution)

| Surface | Findings | Closed | Remaining |
| --- | --- | --- | --- |
| Prose | 8 | 8 | 0 in GTM scope |
| Visual | 0 | — | n/a (directory forms) |
| Code | 2 | 2 | 0 |
| Structure | 3 | 2 | S3 Smithery bad release row |

## Findings (original)

### Prose & copy — all addressed

| # | Location | Status |
| --- | --- | --- |
| P1 | GTM one-liner | ✅ North-star sentence in STOREFRONTS + GTM |
| P2 | mcp.so Description | ✅ Live on listing |
| P3 | smithery-external-publish | ✅ Single on-brand description |
| P4 | Dead subdomain URLs | ✅ `canonical-urls.md` + grep cleanup |
| P5 | STOREFRONTS §7 keyword stuffing | ✅ One-liner aligned |
| P6 | mcp-so-listing bullet grid | ✅ Trimmed overview markdown |
| P7 | GTM mermaid wrong host | ✅ kensaur.us paths |
| P8 | `.mcp.json` comment | ✅ Fixed earlier |

### Code — all addressed

| # | Item | Status |
| --- | --- | --- |
| C1 | `agent.json` stale API host | ✅ Supabase URLs |
| C2 | `server.json` remotes + description | ✅ Supabase MCP URL + de-slopped description |

### Structure

| # | Item | Status |
| --- | --- | --- |
| S1 | Duplicate canonical tables | ✅ `canonical-urls.md` |
| S2 | mcp.so empty Overview | ✅ Content textarea (index 3) — not TipTap |
| S3 | Smithery wrong upstream | ✅ Republished; overview + homepage updated; capability scan pending OAuth Connect on release |

## Phased burndown — results

- **Phase 1 — Copy + URL pass** ✅ README badges, awesome-list PR text, GTM, server.json, agent.json, mcp-server-card links
- **Phase 2 — mcp.so Overview** ✅ Automated via unnamed Content textarea
- **Phase 3 — Smithery republish** ⚠️ Requires signed-in **Releases → Publish** with upstream from `smithery-external-publish.json`

## Manual follow-up (Smithery)

1. Open [smithery.ai/servers/kensaurus/mushi-mushi/releases](https://smithery.ai/servers/kensaurus/mushi-mushi/releases)
2. **Publish** → MCP Server URL:
   `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs`
3. Optional: **Connect** with a `mcp:read` test key for live capability scan
4. Update Overview description on Smithery settings to match one-liner (still shows old "Bug comprehension" copy)

## Verify

- [x] [mcp.so/server/mushi-mushi](https://mcp.so/server/mushi-mushi) — Overview + Supabase Server Config
- [ ] Smithery release row shows Supabase URL and passes scan
- [ ] Official registry after next `@mushi-mushi/mcp` release picks up `server.json` description

Re-run `plan-antislop` after Smithery is green.
