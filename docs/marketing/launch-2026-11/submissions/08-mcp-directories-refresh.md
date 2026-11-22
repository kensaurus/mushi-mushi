# Packet: MCP directory refresh (official registry, PulseMCP, mcp.so, Glama, allMCPservers, cursor.directory, claudemcp.org)

**Status:** one sitting, mostly checks.
**Owner time:** about 15 minutes.
**Tags:** `pulsemcp`, `mcp-so`, `glama`

Copy the description from master. Don't rewrite it here.
[ADR 0058](../../../adr/0058-one-stop-platform-to-enhance-vibe-coded-apps.md)
is frozen for 8 weeks from 2026-11-13.

- `packages/mcp/server.json` `description` (cap 100):
  > One place to improve AI-built apps: fix bugs, smooth user journeys and clean up the code.
- `MUSHI_TAGLINE_V2.oneLiner` (`packages/brand/src/index.js`):
  > One place to improve your AI-built app. Fix bugs, smooth user journeys and clean up the code, from your editor. Open source.

Where a form has one short field, use the `server.json` description. Where it
has room for a sentence, use the `oneLiner`.

## What each listing shows today

The "What it shows today" column quotes each listing as it was read. Some
quotes carry retired taglines. That is the listing's text, not ours to copy.

| Directory                 | Listing                                                | What it shows today                                                                                                                                                                                                                                    | Can we change it?                                                                                                                                                                                 | Action                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Official MCP registry** | `io.github.kensaurus/mushi-mushi`                      | **Current.** 0.31.2: "One place to improve AI-built apps: fix bugs, smooth user journeys and clean up the code." (read 2026-11-14 from `GET /v0/servers?search=io.github.kensaurus/mushi-mushi&version=latest`; npm `@mushi-mushi/mcp` is also 0.31.2) | yes: each `@mushi-mushi/mcp` release publishes `server.json` (`release.yml`); **Publish MCP Registry** is the manual fallback                                                                     | none                                                                                                                                                                                                                                             |
| **PulseMCP**              | https://www.pulsemcp.com/servers/kensaurus-mushi-mushi | "Bug translation for vibe coders: plain-English diagnosis and paste-ready fixes for code errors." (read 2026-11-11). Its provider link points to **mushimushi.dev**, not `kensaur.us` (lead, 2026-11-14)                                               | **no.** Listing changes are paused (lead, 2026-11-14). The /submit page said, on 2026-11-11: "we are not making changes to existing listings … we will pick it up automatically once we are back" | none now. When PulseMCP reopens, check that it re-syncs the registry description and that the provider link is `kensaur.us`. If it's still mushimushi.dev, ask PulseMCP to correct it                                                            |
| **mcp.so**                | https://mcp.so/servers/mushi-mushi                     | "Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key." (read 2026-11-11). Its config shows `npx -y @mushi-mushi/mcp@latest` and the raw `*.supabase.co` hosted URL            | **yes.** The owner submitted it, so the owner can edit it (lead, 2026-11-14)                                                                                                                      | **owner:** edit the listing. Paste the `oneLiner` above as the description, and set the hosted URL to `https://kensaur.us/mushi-mushi/hosted-mcp/`. Don't pay for anything                                                                       |
| **Glama**                 | https://glama.ai/mcp/servers/kensaurus/mushi-mushi     | "Mushi-Mushi by kensaurus". **Tool Count 1/5 at 89 tools** (lead, 2026-11-14). The description started "Bug-report triage and fix-dispatch MCP for vibe coders…" on 2026-11-13                                                                         | **yes, once claimed.** The listing is claimable (lead, 2026-11-14)                                                                                                                                | **owner:** claim the listing. Regenerate `glama.json` from the catalog first, then run **Admin → Dockerfile → Build & Release**, so it re-reads the repo. Check that the title reads "Mushi Mushi" and the description is the `server.json` text |
| **allMCPservers**         | (listing URL not recorded)                             | last checked against **v0.30.3** (lead, 2026-11-14); text not re-read                                                                                                                                                                                  | not checked                                                                                                                                                                                       | next sitting: open the listing, compare it with the `server.json` description, and look for an update path                                                                                                                                       |
| **cursor.directory**      | (see `04-cursor-directory.md`)                         | **hidden**, after a security flag, pending manual review (lead, 2026-11-14)                                                                                                                                                                            | waiting on their review                                                                                                                                                                           | none until the review ends. Don't resubmit while it's pending. Check again in a week                                                                                                                                                             |
| **claudemcp.org**         | (listing URL not recorded)                             | **already current** (lead, 2026-11-14)                                                                                                                                                                                                                 | n/a                                                                                                                                                                                               | none                                                                                                                                                                                                                                             |

Smithery is dropped from this packet. Its pages return 404, and it shut down
accounts on 2026-10-31.

## Owner step (about 15 minutes)

1. **mcp.so:** edit the description and the hosted URL (above).
2. **Glama:** claim the listing, then run Build & Release. Check the title and
   description.
3. **Registry:** nothing to do (current at 0.31.2).
4. **PulseMCP, cursor.directory:** nothing to do until they reopen or finish
   the review.
5. **allMCPservers:** read the listing once and note whether it can be updated.

## Success metric and kill switch

- **Metric:** every listing resolves, shows the ADR 0058 description and links
  to `kensaur.us` (yes or no). Research note §4 play 12 calls this hygiene, not
  a growth channel.
- **Kill switch:** one sitting only. Being listed since June produced 0
  outside activations.

## Checked 2026-11-13 (kept for history)

| Directory                          | State then                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Action                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Official MCP registry**          | 0.30.7, published 2026-11-11, with the ADR 0056 description of that week. It has since been superseded by 0.31.2 (above).                                                                                                                                                                                                                                                                                                                                                 | none                                  |
| **Glama**                          | The page opened with the old description; TDQS A, 3.7/5 across 86 tools, scored 2026-10-31. The stored `github-kensaurus` browser profile was **not signed in** to Glama. `glama.json` listed a stale 92 tools, while the catalog check counted 138 in the canonical catalog and 130 on the hosted server. Rebuild with `pnpm --filter @mushi-mushi/mcp build && node packages/mcp/scripts/generate-glama-json.mjs`, then `pnpm check:catalog-sync` (on the overseas PC). | owner step 2 above                    |
| **awesome-mcp-servers** (punkpeye) | **Already listed**, merged 2026-06-24 (https://github.com/punkpeye/awesome-mcp-servers/pull/8625), README line 1721: "Bug-report triage and fix dispatch: plain-English diagnoses of user-reported bugs …".                                                                                                                                                                                                                                                               | none. No second PR ("Stop doing" #7). |

**Smithery link in the code: done.** On 2026-11-13,
`packages/server/supabase/functions/_shared/mcp-server-card.ts` and
`scripts/cloudfront-mushi-hosted-mcp-router.js` linked `SMITHERY_SERVER_URL`,
a dead page. On 2026-11-14 neither file on master contains it. Whether the
deployed edge function and router match master was not checked.
