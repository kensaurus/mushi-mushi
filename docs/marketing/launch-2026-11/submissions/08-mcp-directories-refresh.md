# Packet: MCP directory refresh (official registry, PulseMCP, mcp.so, Glama, Smithery)

**Status:** one sitting, mostly checks.
**Owner time:** about 10 minutes.
**Tags:** `pulsemcp`, `mcp-so`, `glama`

The new description must come from the working tree, not be rewritten here:

- `packages/mcp/server.json` `description`, 84 characters (cap 100):
  > Bug fixing for AI-built apps: plain-English diagnosis + a ready fix, in your editor.
- `MUSHI_TAGLINE_V2.oneLiner` (`packages/brand/src/index.js`):
  > Your users tap a button to report a bug, and Mushi Mushi checks your live site too. Plain-English diagnosis + a ready fix, in your editor. Open source.

Both are owned by the positioning lane. Copy them only after that lane's change
is on master.

## What each listing shows today

Read through Firecrawl on 2026-11-11.

| Directory | Listing | What it shows | Can we change it? | Action |
|---|---|---|---|---|
| **Official MCP registry** | `io.github.kensaurus/mushi-mushi` 0.30.4 (published 2026-11-06) | the description from `server.json` at publish time | yes: the next `@mushi-mushi/mcp` release publishes it (`release.yml`), or dispatch **Publish MCP Registry** | ships with the next mcp release; nothing extra to do |
| **PulseMCP** | https://www.pulsemcp.com/servers/kensaurus-mushi-mushi | "Bug translation for vibe coders: plain-English diagnosis and paste-ready fixes for code errors." (a retired tagline); about 302 visitors a week | **no.** /submit says "We are not accepting new MCP server or client submissions right now, and we are not making changes to existing listings … publish it to the Official MCP Registry … we will pick it up automatically once we are back" (page "Last updated: September 3, 2026") | none; it re-syncs from the registry when PulseMCP reopens |
| **mcp.so** | https://mcp.so/servers/mushi-mushi | "Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key." Its config shows `npx -y @mushi-mushi/mcp@latest` and the raw `*.supabase.co` hosted URL with Bearer headers | **no edit path found** `[unverified]`. /submit takes "Repository URL*" and "Name"; free listings "go live after review", and a $39 fee publishes without review | **owner decision:** leave it, or resubmit the repo for free and ask in the Name field to replace the old entry. Do not pay. The old config still works (the stdio server and an API key) |
| **Glama** | https://glama.ai/mcp/servers/kensaurus/mushi-mushi | "Mushi-Mushi by kensaurus", 86 tools; the description starts "Bug-report triage and fix-dispatch MCP for vibe coders…" | **partly.** The Glama FAQ says "registry updates continue to replace its name, description, and URL by default", and `glama.json` sets the display name and description. The published schema lists only `maintainers` `[unverified which applies]` | after the positioning lane's `glama.json` lands on master, open Glama **Admin → Dockerfile → Build & Release** (see `GTM-DISTRIBUTION.md`) so it re-reads the repo. Check that the title reads "Mushi Mushi" |
| **Smithery** | `smithery.ai/server/kensaurus/mushi-mushi` and `/servers/...` | **HTTP 404** ("Not found · Smithery") | n/a | **removed** from `GTM-DISTRIBUTION.md` (this lane). Smithery joined Arcade on 2026-08-05 (https://www.arcade.dev/blog/smithery-joins-arcade/). On 2026-10-31 it shut down its "connection management services": "Server URLs on run.tools and server.smithery.ai; Smithery API, Connect, and Toolbox; Smithery accounts and API keys; The Smithery CLI and SDKs". It stays only as a public registry with a curated set (https://www.smithery.ai/future). Do not republish. |

## Owner step (10 minutes)

1. **After the positioning batch merges:**
   - confirm the registry record shows the new description;
   - if it doesn't, run `gh workflow run "Publish MCP Registry" --ref master`, then
     `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.kensaurus/mushi-mushi&version=latest"`.
2. **Glama:** Build & Release. Check the title and description.
3. **mcp.so:** choose to leave it, or resubmit it free.
4. **PulseMCP:** nothing to do.

## Success metric and kill switch

- **Metric:** every listing resolves and links to `kensaur.us` (yes or no).
  Research note §4 play 12 calls this hygiene, not a growth channel.
- **Kill switch:** one sitting only. Being listed since June produced 0
  outside activations.

## Checked 2026-11-13

| Directory | State | Action |
|---|---|---|
| **Official MCP registry** | **Current.** `GET /v0/servers/io.github.kensaurus%2Fmushi-mushi/versions/latest` returns 0.30.7, `isLatest: true`, published 2026-11-11, the new description ("Bug fixing for AI-built apps: …"), `websiteUrl` `/docs/quickstart/mcp` (200) and the remote `https://kensaur.us/mushi-mushi/hosted-mcp/`. npm `@mushi-mushi/mcp@latest` is also 0.30.7. `release.yml` publishes it on each release; `publish-mcp-registry.yml` is the manual fallback. | none |
| **Glama** | The page still opens with the old description ("Bug-report triage and fix-dispatch MCP for vibe coders…"); TDQS A, 3.7/5 across 86 tools, scored 2026-10-31. The stored `github-kensaurus` browser profile is **not signed in** to Glama, so Build & Release was not run. | owner step 2 above, unchanged. Before it, regenerate `glama.json`: its `tools[]` lists a stale **92**, while the pre-commit catalog check counts **138** in the canonical catalog and **130** on the hosted server (the "130 tools" in its description and the docs is the hosted count). Rebuild with `pnpm --filter @mushi-mushi/mcp build && node packages/mcp/scripts/generate-glama-json.mjs`, then `pnpm check:catalog-sync` (on the overseas PC). |
| **Smithery** | `smithery.ai/servers/kensaurus/mushi-mushi` is "Not found"; the registry API still returns a stale record ("55+ MCP tools", `deploymentUrl` on `run.tools`, which stopped working on 2026-10-31). No account to edit it with. | none on Smithery. **Follow-up for the edge lane:** `packages/server/supabase/functions/_shared/mcp-server-card.ts` and `scripts/cloudfront-mushi-hosted-mcp-router.js` still link `SMITHERY_SERVER_URL`, a dead page. Drop the link in the next edge deploy. |
| **awesome-mcp-servers** (punkpeye) | **Already listed**, merged 2026-06-24 (https://github.com/punkpeye/awesome-mcp-servers/pull/8625), README line 1721: "Bug-report triage and fix dispatch: plain-English diagnoses of user-reported bugs …". | none. No second PR ("Stop doing" #7). |
