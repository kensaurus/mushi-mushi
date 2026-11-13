# Link tags (`src`) for the November 2026 launch

Every link we post or submit carries a `src` tag. Without one, a visit shows up
as "no source" and we cannot tell which post worked. Between 2026-10-28 and
2026-11-11, 317 of 321 landing views had no tag.

## The rule

- **Shape:** `<channel>.<asset>`, lowercase letters, digits, `.`, `-`, `_` and
  `:` only, 64 characters at most. Examples: `x.datastory`, `zenn.lovable-check`.
- **Why that shape.** Three places read the tag, and all three drop anything
  else silently:
  - the landing counter (`_shared/landing-visits.ts` `cleanVisitSrc`,
    `^[a-z0-9][a-z0-9_.:-]{0,63}$`);
  - the Production Check (`api/routes/production-check.ts` `cleanSrc`);
  - console signups (`apps/admin/src/lib/signupAttribution.ts`).
- **Point posts at docs pages, not straight at the console.** A docs page
  stores `?src=` as the visit's first touch. It passes it on to the sign-up
  link as `ft_src`, and the daily scorecard groups signups by that value.
- **A direct console link needs both tags:**
  `admin/signup?src=<tag>&ft_src=<tag>`. `src` alone only records the button
  that was clicked, not the channel.
- **No other parameters.** No `utm_*` and no personal data in the URL.
  `src` falls back to `utm_source` when `src` is missing, so do not send both.

## Base URLs

| Name | URL |
|---|---|
| Free Production Check | `https://kensaur.us/mushi-mushi/docs/check?src=<tag>` |
| Lovable / Bolt quickstart (script tag, no terminal) | `https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt?src=<tag>` |
| Lovable custom-MCP guide | `https://kensaur.us/mushi-mushi/docs/quickstart/lovable-mcp?src=<tag>` |
| Live numbers (`/proof`) | `https://kensaur.us/mushi-mushi/docs/proof?src=<tag>` |
| Sample diagnosis, no sign-up | `https://kensaur.us/mushi-mushi/docs/demo/diagnosis?src=<tag>` |
| Connect your editor (MCP) | `https://kensaur.us/mushi-mushi/docs/connect?src=<tag>` |
| Landing | `https://kensaur.us/mushi-mushi/?src=<tag>` |
| Repo | `https://github.com/kensaurus/mushi-mushi` (GitHub drops query strings from its own stats; use a docs link where it matters) |

All of these returned HTTP 200 on 2026-11-11 (`curl -L`).

## Tags in use

One row per asset. Add a row before you post anything new, and never reuse a tag
for a different asset.

| Tag | Channel | Asset | Where the link goes |
|---|---|---|---|
| `x.datastory` | X | data story thread | `/docs/check`, `/docs/proof` |
| `bsky.datastory` | Bluesky | data story thread | `/docs/check`, `/docs/proof` |
| `linkedin.datastory` | LinkedIn | data story post | `/docs/check`, `/docs/proof` |
| `devto.datastory` | dev.to (optional cross-post, canonical to the docs blog) | data story | `/docs/check` |
| `x.heldpr-<yyyymmdd>` | X | weekly held-PR post | `/docs/proof` |
| `bsky.heldpr-<yyyymmdd>` | Bluesky | weekly held-PR post | `/docs/proof` |
| `linkedin.heldpr-<yyyymmdd>` | LinkedIn | weekly held-PR post | `/docs/proof` |
| `zenn.lovable-check` | Zenn | JA how-to | `/docs/check`, `/docs/quickstart/lovable-bolt`, `/docs/ja` |
| `qiita.lovable-check` | Qiita | JA how-to | `/docs/check`, `/docs/quickstart/lovable-bolt`, `/docs/ja` |
| `ja-page` | Docs `/docs/ja` | The Japanese page's own links | `/docs/check` |
| `reddit.vibecoding` | Reddit r/vibecoding | contribution post (link only if asked, or in a comment) | `/docs/check` |
| `reddit.lovable` | Reddit r/lovable | answers in threads | `/docs/check` |
| `x.vibecoding-approval` | X Vibe Coding community | r/vibecoding tool-approval request | `/docs/check` |
| `hn.show` | Hacker News | Show HN (HELD) | landing |
| `claude.directory` | Claude plugin directory | listing homepage / docs link | `/docs/connect` |
| `claude.connectors` | Claude connectors directory | listing docs link | `/docs/quickstart/mcp` |
| `skills.sh` | skills.sh / `npx skills` | SKILL.md links | `/docs/check`, `/docs/quickstart/lovable-bolt` |
| `cursor.directory` | cursor.directory | MCP entry and rule | `/docs/connect` |
| `cursor.marketplace` | Cursor Marketplace | follow-up email | `/docs/connect` |
| `lovable.howto` | Lovable how-to (our docs) | custom MCP how-to | `/docs/quickstart/lovable-mcp` |
| `bolt.howto` | Bolt how-to (our docs) | custom MCP how-to | `/docs/quickstart/lovable-mcp` |
| `supabase.partner` | Supabase partner catalog | listing website field | landing |
| `pulsemcp` | PulseMCP | listing | `/docs/connect` |
| `mcp-so` | mcp.so | listing | `/docs/connect` |
| `glama` | Glama | listing | `/docs/connect` |
| `starter.lovable` | starter template README | README links | `/docs/check`, `/docs/proof` |
| `widget` | the widget footer mark | set by the SDK (`utm_source=widget`) | landing |
| `ph.launch` | Product Hunt | launch (HELD, `posts/09`) | landing |
| `x.fieldkenji` | X | Field Kenji post (`posts/10`) | `/docs/demo/diagnosis` |
| `devto.toolcatalog` | dev.to | tool-catalog article (outline, `posts/11`) | `/docs/connect`, `/docs/demo/diagnosis` |
| `github-readme` | GitHub README | the "Check your live app" button and the hero image (in use before this table listed it) | `/docs/check`, `/docs/demo/diagnosis` |

## How to read the results

- **Landing views by tag:** `GET /v1/admin/growth/daily?days=14`, `by_src[]`.
  From migration `20261111090000`, referrer spam is left out, and the payload
  carries `spam_views_excluded`.
- **Production Checks by tag:**
  `select src, count(*) from production_checks group by 1`.
- **Signups and `sdk_seen_live` by tag:** the same `by_src[]` rows, grouped by
  the signup's first touch.

A tag with views and no checks means the post was read but did not convince.
A tag with checks and no `sdk_seen_live` means the check did not lead to an
install.
