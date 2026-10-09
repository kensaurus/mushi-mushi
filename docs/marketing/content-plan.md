# content-plan.md — four journey posts, one per release

Rewritten 2026-09-21. The June plan listed eight feature posts; one was
written. The pattern that actually lands for a project with no audience is
PostHog's: honest founder-journey posts with real numbers, one per release,
and "depth-first: if a post works, write the next one about the same thing".
These four replace the eight. The two feature posts that were worth keeping
are in the backlog at the bottom.

Every post is hand-written, first person, sober. No mascot, no emoji, no
"we". The numbers come from [`scorecard.md`](./scorecard.md) or the
post-mortem for that release, never from memory. If a number is not measured,
the post says so.

Every post has the same shape:

1. **The numbers, first.** Flat, sourced, no adjectives.
2. **What I found when I looked.** Two or three concrete things.
3. **What it means.** One paragraph.
4. **What changed / what happens next.** Concrete, dated.
5. **One question to the reader.** Not a CTA; a question you actually want
   answered, pointing at Discussions.

Location: `apps/docs/content/blog/<slug>.mdx` + `blog/_meta.ts` + a card in
`blog/index.mdx`. Mirror: `docs/marketing/posts/<nn>-<slug>.md` with
`canonical_url` set to the docs URL. Publish the mirror with
`node scripts/marketing/post-devto.mjs <slug> --publish`. One Bluesky item
per post with a real `scheduled_for`.

---

## Post 1 — "I shipped a bug tool for 5 months and got 9 signups. Here's what the data said."

- **Publish:** day 7, before the Show HN. **Status: written** (2026-09-21,
  `blog/nine-signups-what-the-data-said.mdx`, mirror `posts/02-nine-signups.md`).
- **Numbers used:** signups by month, external projects and their report count,
  reports, sessions, stars, 14-day views/uniques, external issues/PRs, package
  and registry counts.
- **Findings:** the June launch runbook never ran; GitHub OAuth was off in
  production the whole time; the deployed console never had its own SDK key so
  dogfooding was silently off.
- **What changed:** north star = activated external projects/week; measured
  with our own SDK; first run rebuilt to a diagnosis in under a minute.

## Post 2 — "Show HN, by the numbers: what N visitors did on a no-signup demo"

- **Publish:** day 21, the Friday after R1.
- **Numbers:** `gh api repos/kensaurus/mushi-mushi/traffic/referrers`, HN
  points / comments / peak rank, `landing_view` → `connect_demo_click` →
  `signup_completed` → `first_report_received` from `product_events`, signups
  by `signup_source`, activated external projects that week.
- **Findings:** where people dropped between the demo and the install; which
  comment thread drove the most signups; the one thing that did not work.
- **Also posted as:** the r/webdev and r/reactjs threads (numbers inline, link
  in a comment).

## Post 3 — "Nobody wanted a Sentry alternative. Here's what solo builders asked for instead."

- **Publish:** around day 50, after at least ten real conversations (the HN
  DMs, Discussions threads, support email).
- **Numbers:** how many conversations, what each person was using before, how
  many installed, how many sent a report. Quotes only with permission.
- **Findings:** the questions people actually asked versus the comparison we
  expected to have. If the answer is that they did want a Sentry alternative,
  the title changes; the post is written from the conversations, not the
  other way round.
- **Also posted as:** the R3 normal HN submission and dev.to.

## Post 4 — "The first stranger's bug: what Mushi's diagnosis got right and wrong on a repo I'd never seen"

- **Publish:** around day 80, when the first external project has a real
  report and its owner agrees to the write-up.
- **Numbers:** time from report to diagnosis, what the diagnosis said, what the
  fix actually was, how many files it pointed at correctly.
- **Fallback if no stranger's bug exists by then:** "90 days in the open:
  activated projects, not stars", built from twelve scorecard rows.

---

## Backlog (kept from the June plan)

- **"60 seconds from 'this is broken' to a draft PR"** — written
  (`posts/01-auto-fix-loop.md`, docs mirror `blog/auto-fix-loop.mdx`). Re-run
  on dev.to only after R1 with the canonical URL fixed; not a launch post.
- **"Sentry + Mushi: the 2-tool stack"** — the alongside story with the
  `sentryEventId` correlation and one real merged fix Sentry missed. Write
  after there is one real example from an external project; until then the
  [Sentry vs Mushi](https://kensaur.us/mushi-mushi/docs/compare/sentry-vs-mushi)
  compare page covers it.

Retired: the dark-only admin design post, the LLM-as-Judge post, the
shake-to-report internals post, the AGPLv3 post (already exists as
`blog/agplv3-relicense.mdx`), the pg_cron post, and "Bug of the week". Any of
them can come back once there is an audience to read them; none of them
moves the activation number today.

---

## The 90-second video

Still needed, and it gates R1 (the "npx mushi-mushi on a fresh app in under
five minutes" recording doubles as the source). Record once, in one take,
screen only; the Cursor session must be filmed live, not staged. Export
portrait and landscape. It lives in the README, the landing hero slots, the
Show HN comment and the Product Hunt gallery. If budget exists, pay an editor
for the 20–30 s cut; never buy anything else.

## Pacing

One post per release. Zero in a week is fine. Two in a week is a sign the
numbers are being written around rather than reported.
