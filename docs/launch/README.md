# Launch kit — Mushi Launch Week — drafted 2026-10-02

Nothing in this folder has been posted. Every post is a draft for the founder
to rewrite in their own words: HN removes posts that read as AI-written, and
every channel here expects the maker to speak as the maker.

| File | What it holds |
|---|---|
| [README.md](./README.md) | Angle, claims table, the five days, gates, UTM links, results |
| [show-hn.md](./show-hn.md) | Show HN title options and the first comment (Day 2) |
| [product-hunt.md](./product-hunt.md) | Product Hunt fields and the maker comment (the Tuesday after) |
| [x-bluesky.md](./x-bluesky.md) | One short thread per day for Bluesky, and X if a personal account posts it |
| [reddit.md](./reddit.md) | Two value threads (r/cursor, r/ClaudeAI) for the week after |

Earlier drafts and the comment-reply rules live in
[`docs/marketing/snippets.md`](../marketing/snippets.md); the runbook and
post-mortem template in [`docs/marketing/launch-week.md`](../marketing/launch-week.md).

## Owner decision: one post per release, or a five-day week

[`/launch-week`](https://kensaur.us/mushi-mushi/docs/launch-week) (public,
2026-09-21) says Mushi launches **one public post per release** and "will not
post the same text to two places". The request on 2026-10-02 was a **five-day
Launch Week**. The two disagree, and only the owner can pick:

- **A. Keep one post per release (this kit's default).** The five days are
  posts on channels we own (the blog, Bluesky, GitHub Discussions), one
  feature a day, with **one** external launch post: the Show HN on Day 2.
  Product Hunt is the next Tuesday, as release R2. `/launch-week` stays as is.
- **B. A full five-day external launch week.** Rewrite `/launch-week` first,
  in the same PR as the decision, so the public page and the posts never
  disagree. Then add one external channel per day to the table below.

Record the choice here with a date before Day 1.

## Owner: product numbers on /open

`/open` shows a "Product" section only when
[`apps/docs/data/open-product-metrics.ts`](../../apps/docs/data/open-product-metrics.ts)
holds data; while `OPEN_PRODUCT_METRICS` is `null`, the section is not
rendered and no placeholder appears. To publish:

1. Take the latest weekly row from
   [`docs/marketing/scorecard.md`](../marketing/scorecard.md).
2. Set `OPEN_PRODUCT_METRICS` to `{ asOf: '<that Monday, YYYY-MM-DD>', rows: [...] }`
   with rows such as signups, activated external projects and paying customers,
   values exactly as the scorecard has them (never rounded).
3. Commit with the next docs batch. Update it each week, or set it back to
   `null` rather than let it go stale.

## Angle

> When a user tells you your app is broken, you should not have to read code
> you did not write to find out why.

It works without the product name, it names the reader's afternoon, and every
day of the week is one piece of the answer.

## Claims table

Copy may use only rows marked **verified**. Re-check every row on the morning
it is posted.

| Claim | Source | Status (2026-10-02) |
|---|---|---|
| A diagnosis is visible without signing up | Landing card `RealDiagnosisCard` (real classifier output, demo project report `4618a607`) | verified |
| The `/connect` demo needs no signup and returns diagnosed reports | Read-only MCP `get_recent_reports` with the public demo key returned `classified` reports from `mushi-demo` | verified |
| The hosted MCP server exposes 76 tools | `check-catalog-sync`: "Hosted MCP … 76 tools" | verified |
| The MCP server needs no second LLM key | `get_fix_context` catalog entry: "no second LLM key needed" | verified |
| `npx mushi-mushi` detects the framework, installs the SDK, writes env vars | Landing FAQ and quickstart docs | docs only — film it once (R1 gate) |
| SDKs are MIT, server AGPLv3, self-host is one command | LICENSE files, landing FAQ, `/self-hosting` | verified |
| Free Cloud: 50 diagnoses a month, no card | VISION.md §2.2, `PRICING_TIERS` | verified |
| Plugins (Linear, Jira, Slack…) need Indie or above, or self-host | `pricing_plans.feature_flags.plugins` in production: free_cloud false, indie/pro/enterprise true | verified |
| Sentry's Seer is a paid add-on ($40 per active contributor per month), not in self-hosted Sentry | VISION.md §1.6, sentry.io/pricing checked 2026-09-21 | re-check before posting |
| A project's first real report always gets the full diagnosis | commit `6eea0b30` (fast-filter forwards it to classify-report) | in the 2026-10-02 batch — needs deploy |
| The fix agent reads every file on the base branch before writing, and does not open a PR that failed review | commit `9e297db5` | in the batch — needs deploy |
| Widget screenshots work again in Chrome | commit `742d6521` (data: URL capture, verified on one live site) | in the batch — needs deploy |
| Diagnoses run on Claude Sonnet 5.5 | branch `ux/model-sonnet55` (`18e5236f`); its model migration is **not applied** | not merged — gate |
| Reporters hear back: status, replies, "fixed in vX" | Plan 018 (`docs/execplans/reporter-loop-v2.md`, status PLANNED); schema and RN parts on branch `ux/reporter-loop` | not merged — gate |
| Numbers: 9 signups, 0 activated external projects (2026-09-20) | blog post `nine-signups-what-the-data-said` | verified, dated — use the scorecard row of the day instead if newer |

Never claim a star count, logos, testimonials, or user numbers that are not in
the scorecard.

## The five days

Day 1 is a Monday. The week starts only when every gate in
[`/launch-week`](https://kensaur.us/mushi-mushi/docs/launch-week#the-gate-before-r1)
is true, and each day's feature is merged **and deployed** before its post.
If a day's feature is not deployed, that day posts the next ready item, or
nothing.

| Day | Feature (one per day) | Gate | Where it is posted |
|---|---|---|---|
| Mon | **See a diagnosis before you sign up.** The real diagnosis on the landing page and the read-only `/connect` demo | Landing change deployed; `/connect` demo works in a private window | Blog post, Bluesky, Discussions (Announcements) |
| Tue | **Ask your editor what broke.** The MCP loop: `get_recent_reports` → `get_fix_context` in Cursor or Claude Code | Same as Mon | **Show HN** (12:00–17:00 UTC), then Bluesky |
| Wed | **A sharper diagnosis.** Stage 2, fixes and the judge on Claude Sonnet 5.5 | `ux/model-sonnet55` merged, deployed, model migration applied, one real diagnosis checked by hand | Blog, Bluesky |
| Thu | **Your users hear back.** Reporter loop v2: statuses a reporter understands, replies, "fixed in vX" | Plan 018 success criterion 3 met in production: one real reply round trip | Blog, Bluesky |
| Fri | **Guardrails.** First real report always fully diagnosed; the fix agent reads before it writes and stops on a failed review; Chrome screenshots fixed; the week's numbers | The batch deployed | Blog (with the week's numbers), Bluesky, `/open` refreshed |

The following Tuesday: Product Hunt ([product-hunt.md](./product-hunt.md)).
The two weeks after: one Reddit value thread per subreddit
([reddit.md](./reddit.md)).

## Links and measurement

Every link carries `utm_source=<channel>&utm_medium=post&utm_campaign=launch-week-2026-10`.

| Channel | Link |
|---|---|
| Show HN | `https://kensaur.us/mushi-mushi/docs/connect?utm_source=hn&utm_medium=post&utm_campaign=launch-week-2026-10` |
| Product Hunt | `https://kensaur.us/mushi-mushi/?utm_source=producthunt&utm_medium=post&utm_campaign=launch-week-2026-10` |
| Bluesky | `https://kensaur.us/mushi-mushi/?utm_source=bluesky&utm_medium=post&utm_campaign=launch-week-2026-10` |
| X | `https://kensaur.us/mushi-mushi/?utm_source=x&utm_medium=post&utm_campaign=launch-week-2026-10` |
| Reddit | `https://kensaur.us/mushi-mushi/?utm_source=reddit&utm_medium=post&utm_campaign=launch-week-2026-10` |

Success is **activated external projects** (a stranger's app sends its first
real report and its owner opens the diagnosis), not points or upvotes.

## Results (fill seven days after each post)

| Channel | Date | Visits | Signups | Activated | Notes |
|---|---|---|---|---|---|
| Blog / Bluesky (Mon) | | | | | |
| Show HN (Tue) | | | | | |
| Blog / Bluesky (Wed–Fri) | | | | | |
| Product Hunt | | | | | |
| Reddit r/cursor | | | | | |
| Reddit r/ClaudeAI | | | | | |

Next kit: the release after this batch; copy this folder's shape, do not
overwrite it.
