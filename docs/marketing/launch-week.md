# launch-week.md — one post per release

Rewritten 2026-09-21 from the five-day runbook. The June 2026 runbook was
never executed (features shipped, posts did not; see the correction on
`apps/docs/content/launch-week.mdx`), and the goal it optimised for, GitHub
Trending, is a lagging signal that coexisted with zero activated projects for
five months. The goal now is **activated external projects per week**: a
project owned by someone outside the founder's org receives its first real
report and the owner opens the diagnosis. Numbers live in
[`scorecard.md`](./scorecard.md); the plan is `docs/plan-gtm.md` Workstream C.

A five-day blast assumes an audience that is already watching. We do not have
one. So each release gets one public post on one channel, is measured, and
only then does the next release launch.

**Pre-flight** — the gate below is true, every file in
[snippets.md](./snippets.md) has been read once end to end, and
[STOREFRONTS.md](./STOREFRONTS.md) is ticked. No fresh copy is written on the
day; only light edits.

---

## The cadence

| Release | ~Day | Ships | The post | Journey post |
|---|---|---|---|---|
| **R1 "Proof"** | 14 | The gate below | **Show HN**, Tuesday, 12:00–17:00 UTC | #1 before HN (day 7); #2 the HN retro (day 21) |
| **R2 "Found"** | 45 | Five compare/how-to pages live; Mushi setup skill audited for Cursor / Claude Code; Cursor plugin submitted | **Product Hunt** + value threads in r/cursor and r/ClaudeAI + Console.dev / TLDR Web Dev pitch carrying the HN number | — |
| **R3 "Loop"** | 75 | "Bug reports by Mushi" mark on the widget with a one-click opt-out + the three loop events; Discussions as community home | Normal HN submission of journey post #3 (not a Show HN) + dev.to | #3, #4 |

Product Hunt moved from launch week to R2 on purpose: it is a credibility
artifact, and it needs the HN numbers in the maker comment. Reddit is not a
launch channel; it is value threads over the two weeks after HN (see
snippets.md → Reddit).

---

## The gate before R1 (all true, or no post)

- [ ] The keyless demo at `/connect` loads in a private window with no signup and produces a diagnosis (`NEXT_PUBLIC_MUSHI_DEMO_*` set in the deploy; today they are commented out in `apps/docs/.env.example`).
- [ ] `npx mushi-mushi` on a fresh Next.js app reaches a first report and diagnosis in under five minutes, screen-recorded.
- [ ] Both `TODO(loop-video)` slots on the landing show that recording.
- [ ] `search_mushi_docs` returns zero dead links (curl every URL it emits).
- [x] VS Code extension published (`VSCE_PAT` / `OVSX_PAT` + `publish-vscode-extension.yml`) **or** marked "deferred" in `GTM-DISTRIBUTION.md` and not mentioned on HN (2026-09-21: deferred, with the reason and the un-defer steps; the Show HN copy in snippets.md does not mention it).
- [ ] Privacy policy and terms return 200.
- [ ] `CONTRIBUTING.md` carries the issue SLA (first reply within 24 h on weekdays).
- [x] `apps/docs/content/launch-week.mdx` tells the truth (2026-09-21).
- [x] JSON-LD `sameAs` lists only accounts that exist (2026-09-21).
- [x] Bluesky queue has no enabled, unposted item with a `scheduled_for` in the past (2026-09-21: the four April items are `disabled` with a `disabled_reason`, and `post-bluesky.mjs` now refuses any item more than three days overdue).
- [ ] The activation SQL (`plan-gtm.md` §8) returns a number, even if it is zero.

**URL rule:** the Show HN URL is the demo. If the first box is not ticked on
the morning of the post, the URL is the repo and line one of the README must
be `npx mushi-mushi`.

---

## R1 — Show HN day (Tuesday)

| Time (UTC) | Channel | Action |
| --- | --- | --- |
| **11:30** | Local | Open snippets.md → Show HN. Fill the bracketed numbers from `scorecard.md`. Open the HN submit page. Mute everything else. |
| **12:00–13:00** | **Show HN** | Submit title + demo URL. **Immediately** post the body as the first comment. |
| +5 min | Bluesky | One pinned post: *"On Show HN right now, happy to answer questions: \<link\>"*. No pitch, no mascot. |
| **first 2 h** | HN | **Presence rule:** reply to every comment within 10 minutes. Agree with what is right, clarify what was missed, never argue. |
| next 4 h | HN | Reply within the hour. If it has fallen off the front page by hour 3, do not resubmit; the retro post is the second shot. |
| 18:00 | Stats | Save `gh api repos/kensaurus/mushi-mushi/traffic/referrers`, the HN points/comments/peak rank, and `select count(*) from auth.users where created_at > now() - interval '1 day'`. |
| Evening | 1:1 | DM anyone who asked a real question: *"Would 15 minutes help you get it wired in?"* Those conversations are journey post #3's raw material. |

**Late comments** (day 2–3) are the ones that turn readers into installs.
Answer them all.

---

## The two weeks after R1

- **Day +1 to +14, Reddit value threads:** r/cursor, then r/ClaudeAI, then
  r/lovable / r/boltnewbuilders (check rules), then r/opensource and r/mcp.
  One per two or three days, thread first, link in the comments, no repeats.
- **Day +2, newsletters:** Console.dev and TLDR Web Dev with the HN numbers,
  using the pitch in snippets.md (rewrite it to v2 before sending).
- **Day +3, Friday retro post:** journey post #2, "Show HN, by the numbers".
  Structure: the counts (referrers, visits, signups, activated projects, warts
  and all) · what worked · what did not · what surprised me · what is next ·
  thanks by name. Cross-post to dev.to; do **not** resubmit to HN yourself.
- **Day +5, Sunday post-mortem:** one hour, private, in
  `docs/marketing/post-mortems/` using the template there. Append the
  scorecard row.
- **Every day:** one awesome-list or directory issue from
  [`awesome-list-submissions.md`](./awesome-list-submissions.md), issue first.

---

## R2 — Product Hunt day

| Time (PT) | Channel | Action |
| --- | --- | --- |
| **12:01 am** | **Product Hunt** | Submit the pre-drafted listing (snippets.md → Product Hunt). Pin the maker comment with the HN numbers immediately. |
| 6:00 am | PH | Reply to overnight comments from Europe and Asia. |
| 9:00 am | Reddit | The r/lovable / r/boltnewbuilders how-to thread if it has not gone out yet. |
| 9:30 am | Bluesky | *"On Product Hunt today: \<link\>"*. Once. |
| all day | PH | Same presence rule as HN. |
| Evening | Stats | Save PH rank, upvotes, referrer delta. Sunday post-mortem as above. |

---

## R3 — the loop

The post is a normal HN submission of journey post #3 ("Nobody wanted a
Sentry alternative…"), not a Show HN, plus the dev.to cross-post. The measure
is `loop_impression → loop_click → loop_signup` and the K-factor line in the
scorecard, not the post's points.

---

## Hard rules (unchanged, plus one)

1. **Never cross-post identical text.** One angle per subreddit, one angle per
   platform. Copy is in [snippets.md](./snippets.md); use it.
2. **Never start with "We're excited to announce".** See [VOICE.md](./VOICE.md).
3. **Never pay for upvotes / stars / comments.** It breaks the data the whole
   loop runs on.
4. **Never argue with critics.** Agree with the part they're right about,
   clarify the part they missed, move on.
5. **Never resubmit the same HN post.** One shot. If it fell off, learn and
   re-angle the retro post instead.
6. **Never ghost comments.** Every question within 4h of a comment being left,
   24h at the absolute latest. Silence = "this is abandoned".
7. **Never say "book a demo".** The live demo is one click. Link to it.
8. **Never claim a launch happened when it did not.** The public launch page
   is read by the people we post to.
