# Mushi Mushi launch kit (week of 2026-11-16)

Mushi Mushi already has a four-week plan in this folder:
[`../PLAN.md`](../PLAN.md), written 2026-11-11. It has the posts in
[`../posts/`](../posts/), the directory packets in
[`../submissions/`](../submissions/), the `src` tags in
[`../links.md`](../links.md) and the 2026-12-08 kill switch. This kit **slots
into that plan**. It doesn't replace it.

What changed on 2026-11-14:

- **Positioning.** [ADR 0058](../../../adr/0058-one-stop-platform-to-enhance-vibe-coded-apps.md)
  (2026-11-13) replaced the bug-only line. The category is now "One place to
  improve AI-built apps", with three pillars: fix what breaks, show where
  people get stuck, improve the code. `posts/08` (Show HN) and `posts/09`
  (Product Hunt) were rewritten to match.
- **Show HN.** It gets a dated, gated slot, a URL decision, a timing source
  and a reply guide ([`show-hn-replies.md`](./show-hn-replies.md)).
- **Two new community posts**, in this folder: r/cursor and r/indiehackers.

The older drafts (`../posts/01`–`07`, `10`, `11`) were written under ADR 0056.
They lead with bugs, which is still one pillar, so they don't contradict 0058.
Read each one before you paste it, and swap in the 0058 wording where a post
names the category.

**Angle:** users don't tell you what's wrong; they leave. In 60 days people
pressed the report button on nine apps 35 times, while automatic checks and the
owner's own testing turned up about 2,050 problems.

## Claims you may use

Re-run the scoreboard on the day you post:
`https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/public/scoreboard`.

| Claim                                                                        | Value at 2026-11-14 02:04 UTC | Source                                      |
| ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| Apps                                                                         | 9                             | public scoreboard                           |
| Reports from people (reporters)                                              | 35 (19)                       | public scoreboard                           |
| Reports from automatic checks and own testing                                | 2,049 ("about 2,050")         | public scoreboard                           |
| Fixes merged / of those from a person's report                               | 526 / 2                       | public scoreboard                           |
| AI reviews / "hold" verdicts                                                 | 1,803 / 596                   | public scoreboard                           |
| Free plan: one app, 100 diagnoses a month, no card                           |                               | https://kensaur.us/mushi-mushi/docs/pricing |
| Builder $29/mo (3 apps), Studio $79/mo (10 apps), self-host free             |                               | pricing page                                |
| Free check: home page plus three linked pages, public pages only, no sign-up |                               | `/docs/check` page description              |
| SDKs MIT, server AGPLv3, `packages/server/ee/` source-available              |                               | root `LICENSE`                              |

Never cite:

- GitHub stars (3 on 2026-11-14);
- npm downloads (inflated by 25 CLI publishes in 30 days, per the audit);
- MCP tool counts;
- any "users" number;
- a bare "Mushi". Always write "Mushi Mushi".
- No fundraising language anywhere (owner, 2026-10-02).

## Where its users are, with evidence

Reddit rules read from `about/rules.json` on 2026-11-14 (method in
`../glot-it/README.md`).

| Venue                | Size      | Rule on your own project                                                                                                                                       | Verdict                                                                                                                                               |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Show HN              | n/a       | "something you've made that other people can play with"; no sign-up barriers; "Don't post generated text or AI-edited text"                                    | **Gated slot** Thu 11-19 (`../posts/08`); the owner's account hit showlim on 10-29                                                                    |
| r/cursor             | 161,250   | self-promo OK if ≤10% of your Reddit activity, with context in a text post; "No slop: No AI generated content"; flair required                                 | **Post** (`01-reddit-cursor`) on Mon 11-23, after a week of comments                                                                                  |
| r/vibecoding         | 397,158   | "Vibe coding dev tools must be approved"; "No shilling": posts must explain how you built it                                                                   | Already in PLAN: approval request (`../posts/07b`), then the contribution post (`../posts/07`)                                                        |
| r/ClaudeAI           | 1,277,527 | showcase allowed if built with or for Claude by you, explained in detail, free to try and says so                                                              | Allowed, but lets-talk uses it in week 5. Two showcase posts from one account in a month is a lot; pick one, and lets-talk fits the rule more plainly |
| r/ClaudeCode         | 496,426   | "Simple project sharing belongs in the weekly showcase thread. Standalone Built with Claude Code posts must be detailed"                                       | A comment in the weekly showcase thread: the **Show HN fallback** (below)                                                                             |
| r/indiehackers       | 201,250   | "Users can self promote their product 1 time using the Self Promotion flair… for feedback and critique"                                                        | **Post** (`02-reddit-indiehackers`), the one allowed post                                                                                             |
| r/SideProject        | 902,102   | link posts formatted "[Project name] - [Short description]"                                                                                                    | The 10-29 Mushi Mushi post was filtered (new account). help-her-take-photo uses the sub in week 4. Don't repost Mushi Mushi                           |
| r/lovable            | 57,257    | "Rule 9 - .lovable.app links only… only the .lovable.app links are now allowed"; no advertising                                                                | **Comments only**, no links (PLAN: answer "my Lovable app broke" threads)                                                                             |
| r/boltnewbuilders    | 13,545    | "Promoting competitors is not [fine]"; no promo posts without real discussion                                                                                  | Comments only                                                                                                                                         |
| r/replit             | 37,560    | posts must relate to Replit; no AI-generated posts                                                                                                             | **Out** unless a Replit-built app is the story                                                                                                        |
| r/webdev             | 3,331,312 | project sharing only on Showoff Saturday; "We do not allow any commercial promotion"; "Think project, not product"                                             | A Showoff Saturday post about the open-source repo is possible; not drafted (commercial plans make it borderline)                                     |
| r/SaaS               | 845,594   | "Max 1 mention or 3 links… every 60 days", disclosure required; no AI text; bans "I'll review/audit… for you" posts                                            | **Out** for now. The free check reads as an "audit for you" offer                                                                                     |
| r/opensource         | 401,220   | linked repos "MUST have a LICENSE file that MUST be an OSI listed Open Source license"                                                                         | Risky: the repo is open core and GitHub reports NOASSERTION                                                                                           |
| r/selfhosted         | 869,879   | projects younger than 3 months only in the "New Project Megathread"; promoted apps "must be production ready and have docs"; AI-written apps need the AI flair | Possible later: a self-hosting post with the AI flair. Not drafted                                                                                    |
| r/buildinpublic      | 130,054   | no self-promotion without context; share progress and lessons                                                                                                  | Possible for the weekly held-PR post (`../posts/02`)                                                                                                  |
| Indie Hackers (site) | n/a       | new accounts: feed is karma-gated; product directory open (IH thread, 2026-09)                                                                                 | List in the product directory; feed post later                                                                                                        |
| Product Hunt         | n/a       | one-shot                                                                                                                                                       | **Held** (`../posts/09`) until outside installs exist                                                                                                 |

Not checked (Reddit returned 429): r/IMadeThis, r/startups, r/nocode,
r/AI_Agents.

## Files

| File                                                   | What                                                                                   | When                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `../posts/08-show-hn.HELD.paste.md` + `.notes.md`      | Show HN, rewritten for ADR 0058                                                        | Thu 2026-11-19, 00:30 UTC (09:30 JST), if the gates hold     |
| `show-hn-replies.md`                                   | day-of reply guide: Sentry, PostHog, Lovable, Cursor, privacy, pricing, AGPL, traction | the Show HN day                                              |
| `01-reddit-cursor.paste.md` + `.notes.md`              | r/cursor value post                                                                    | Mon 2026-11-23, 14:00 UTC, after a week of ordinary comments |
| `02-reddit-indiehackers.paste.md` + `.notes.md`        | r/indiehackers, the one self-promotion post                                            | Thu 2026-11-26 (glot.it week)                                |
| `../posts/09-product-hunt.HELD.paste.md` + `.notes.md` | Product Hunt, rewritten for ADR 0058                                                   | held                                                         |

**Show HN fallback:** if the account still can't post a Show HN on 11-19, add
a comment in r/ClaudeCode's weekly showcase thread that day instead, with what
you built, how Claude Code was used and one link to `/docs/check?src=reddit.claudecode`.
Write it yourself (three sentences is enough). Then try the Show HN again
in the next week that has no other launch.

## Media

| Use                                                                                  | File                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Lead image for X, Bluesky, LinkedIn and the r/cursor post (if the sub allows images) | **Make:** a sage card, 1280×670, the owner's pixel-art sage avatar in a 16-bit retro JRPG scene, RPG text box: "60 days · 35 bug reports from people · about 2,050 from my own checks · a second AI held 596 of 1,803 fixes · as of 2026-11-14". Recipe: memory `launch-visuals-sage-pixel` (fal `flux-pro/kontext`, the avatar as `image_url`, "no text" in the prompt; overlay the text yourself in Press Start 2P; paint over any letters the model invents). Re-make with that day's numbers if they moved | to make |
| Proof under the card                                                                 | `../../../launch/2026-11/log/media/ai-review-hold-pr864.png` (PR #864 "Hold: don't merge this as it is"; public)                                                                                                                                                                                                                                                                                                                                                                                               | exists  |
| Product Hunt gallery                                                                 | `../posts/img/` (held)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | exists  |
| Show HN                                                                              | none (HN shows no images)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | n/a     |

The October sage cards in `../../../launch/2026-11/log/media/card-*.png` show
the 2026-10-29 numbers. Don't reuse them as they are.

## Check it worked

Follow PLAN.md "How to read the results": landing views and Production Checks
by `src`, then `sdk_seen_live`. New tags from this kit (`reddit.cursor`,
`reddit.indiehackers`, `reddit.claudecode`) are in `../links.md`.
