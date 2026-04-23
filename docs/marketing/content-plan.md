# content-plan.md — the compounding content engine

One post per week for 8 weeks, cross-posted to dev.to + personal blog +
Hashnode + LinkedIn. Each post is a natural fit for a HN re-submit 2–3 weeks
later. This is the AFFiNE 6k → 33k star pattern in miniature.

Pick the order by **which one you most want to write**. Enthusiasm reads.

Every post follows the same shape:

1. **One-sentence hook** using the Sentry contrast.
2. **The problem** — concrete, not abstract.
3. **What we built** — with real code or real numbers.
4. **What we got wrong** — honesty is the moat.
5. **Try it** — link to live demo + repo + npm, and the star CTA.

Every post title gets the *"weirdly-specific over vague-clever"* test. Clever
titles under-perform by roughly 40% on dev.to (source: dev.to growth report).

---

## Post 1 — "We built the auto-fix PR loop in a weekend — here's the JSON-RPC wire format"

- **Angle:** technical meat. MCP / agents / Cursor / Claude Code audiences will
  eat this.
- **Publish:** dev.to + personal blog. Submit to HN in the maker-share slot.
- **Core show:** the actual JSON-RPC request/response for `dispatch_fix`,
  screenshots of a PR opening in 40 seconds, Langfuse trace of what the agent
  thought, the `validateResult` gating logic that catches hallucinated fixes.
- **Outline:**
  1. Hook: "Sentry sees what your code threw. Mushi sees what your users felt
     — and optionally opens the fix PR."
  2. Why I wanted this loop (the weekend where I had 3 user bugs and triaged
     none because context-switching is expensive).
  3. The four MCP tool calls: `list_reports`, `classify_report`,
     `dispatch_fix`, `summarize_intelligence`. Paste the actual `tools/list`
     response JSON.
  4. Sandbox abstraction: why e2b / modal / cloudflare interchangeable
     (never runs `pnpm install` in prod).
  5. `validateResult` gating: the LLM-as-Judge that catches "I fixed the wrong
     file" before the PR opens.
  6. What broke (the `tools/call` streaming bug, the retry budget).
  7. Code you can paste into your own Cursor config today.
  8. CTA + star.
- **Headline alternates:** *"MCP JSON-RPC + a sandboxed agent = a fix PR from
  a user bug report, in 40 seconds"*, *"I gave my coding agent a mailbox
  full of real users' bugs — here's the wire format"*.

## Post 2 — "Sentry + Mushi Mushi: the 2-tool stack for user-felt bugs"

- **Angle:** companion, not replacement. Guaranteed hate-reads from Sentry
  power users = engagement. Target dev.to first, then r/programming.
- **Publish:** dev.to on Tuesday (mid-week for max compounding).
- **Core show:** side-by-side table of "Sentry sees X / Mushi sees Y", the
  bidirectional correlation `sentryEventId` field, one real merged PR that
  Sentry missed and Mushi caught.
- **Outline:**
  1. Hook: "Sentry sees what your code threw. Mushi sees what your users felt."
  2. The 6-row gap table (dead button, 12s load, confusing checkout, Android-only
     layout break, dead-end empty state, rage-click on a disabled button).
  3. How the two tools stream-link (the `sentryEventId` breadcrumb).
  4. The workflow: alert from Sentry → breadcrumb link → Mushi shows the user
     who hit it, the shake-report they left, and the classified category.
  5. A real shipped example (redacted).
  6. What I'd still use Sentry for alone.
  7. CTA + star.
- **Headline alternates:** *"Your Sentry dashboard has a blind spot. I
  measured it."*, *"The bug that Sentry will never see (and why that's fine)"*.

## Post 3 — "Designing a dark-only admin for PDCA: every page is Decide / Act / Verify"

- **Angle:** design-led, pairs well with the `PageHero` screenshots already in
  the README. Appeals to the UI-tool crowd (Raycast, Linear, Arc, Cron). Good
  on dev.to + designer-inclusive X followers.
- **Publish:** dev.to + uxdesign.cc cross-post.
- **Core show:** the before/after of collapsing 7 admin pages into a consistent
  Decide/Act/Verify row, the rationale for dark-only (admin is a war room, not
  a landing page), the per-page mental-model boxes.
- **Outline:**
  1. Hook: "Admin dashboards fail because they don't tell you what to do next."
  2. PDCA as a navigational primitive (Plan → Do → Check → Act).
  3. Every page = Decide (what to look at) / Act (one primary action) /
     Verify (did it work).
  4. Why dark-only: match the mental state (focus) and reduce micro-decisions
     (no light-mode toggle cost).
  5. `PageHero` component: screenshots + the 40-line React.
  6. What I'd redo.
  7. CTA + star.

## Post 4 — "LLM-as-Judge in production: scoring your own classifier weekly"

- **Angle:** deeply technical. Will trend on r/MachineLearning and HN if timed
  mid-morning Tuesday. Langfuse / Anthropic crowd will boost.
- **Publish:** dev.to + personal blog + HN direct-submit.
- **Core show:** the real Judge prompt, a week of scores in a line chart, a
  case where the Judge caught a prompt-drift regression, the auto-promote
  threshold.
- **Outline:**
  1. Hook: "If your LLM classifier isn't grading itself, you're flying blind."
  2. Classifier pipeline recap (Haiku → Sonnet + vision + RAG).
  3. The Judge prompt (paste in full — this is the gold).
  4. Weekly schedule via pg_cron + Supabase Edge Function.
  5. Score distribution chart — real data, real 4.1 → 4.3 improvement after
     the last prompt change.
  6. Auto-promote: when the candidate prompt beats the baseline on two
     consecutive weeks, it gets promoted.
  7. The regression we caught (the one where the classifier started
     mis-categorising every iOS report after a Haiku version bump).
  8. CTA + star.

## Post 5 — "The 60-second bug report: shake-to-report, screenshot, console, network, offline queue"

- **Angle:** mobile-dev gold. Reddit r/reactnative, r/iOSProgramming, Expo
  Discord. Visual — record a phone shake.
- **Publish:** dev.to + Expo community.
- **Core show:** the phone-shake detection math, the Shadow DOM bottom sheet,
  offline queue with retry + jitter, full context object JSON.
- **Outline:**
  1. Hook: "A user shakes their phone. 60 seconds later, there's a fix PR on
     your repo. Here's every link in the chain."
  2. Shake detection (accelerometer thresholds, debouncing).
  3. Bottom-sheet widget (~14 KB gzipped, Shadow DOM so no CSS leak).
  4. Auto-capture: screenshot (html2canvas on web, native on RN), console ring
     buffer (last 50), network ring buffer (last 20), current route, user intent.
  5. Offline queue: AsyncStorage on RN, IndexedDB on web, retry with jitter.
  6. Server-side: 200ms fast-filter, 1.8s deep-classify (p50).
  7. Example: paste the full report JSON for a single shake-to-report.
  8. CTA + star.

## Post 6 — "Why I BSL'd the server and MIT'd the SDKs"

- **Angle:** license philosophy. **Always** triggers HN discussion and brings
  a different (older, more senior) crowd.
- **Publish:** dev.to + HN direct-submit. Do this one **after** you have real
  user traction, because the license debate benefits from "here's a real tool
  it applies to".
- **Core show:** the actual decision tree, the 2029 Apache-2.0 conversion
  date, who this is designed to exclude (managed-OSS providers), who it's
  designed to include (everyone else).
- **Outline:**
  1. Hook: "I didn't want a license lawyer to be the first thing between you
     and a widget in your app. I also didn't want AWS to take my server
     next quarter."
  2. The MIT surface: everything a user installs.
  3. The BSL 1.1 surface: the server + agents + verify.
  4. The 4-year Apache-2.0 sunset (April 15, 2029).
  5. Who can compete against me under BSL today: anyone. Under BSL *with* the
     "competing service" clause: managed-hosted-Mushi-as-a-service is blocked.
  6. What I got wrong (the initial draft had a 10-year conversion — too long).
  7. CTA + star.

## Post 7 — "A tiny cron job that keeps the whole pipeline honest"

- **Angle:** the `pg_cron` self-healing story. Short, sharp, Postgres-inclusive
  crowd. Supabase community will boost.
- **Publish:** dev.to + Supabase community forum + Postgres subreddit.
- **Core show:** the actual SQL for pg_cron scheduling the nightly re-classify
  of low-confidence reports, the metrics before/after, the "forgot the
  completion check" war story.
- **Outline:**
  1. Hook: "The quiet bit of infrastructure that makes the whole pipeline
     self-correcting."
  2. What low-confidence reports are (classifier said <0.7 on severity).
  3. The cron: every 6h, re-classify any report whose `confidence < 0.7` and
     `updated_at < now() - interval '24 hours'`.
  4. The SQL (paste in full).
  5. The bug I introduced (no completion check — the job kept re-scheduling
     itself forever, ran 12× per day for three days).
  6. The fix (idempotency key + a `completed_at` guard).
  7. The before/after confidence histogram.
  8. CTA + star.

## Post 8 — "Bug of the week" — running series, start mid-cycle

- **Angle:** micro-content. Not a long post — a Bluesky / X thread + a
  pinned dev.to list post that aggregates them.
- **Publish:** Bluesky / X weekly, dev.to aggregator refreshed monthly.
- **Core show:** one weirdly-specific real bug Mushi-chan caught, plus a
  one-line quip. Builds the brand voice without needing a new long post.
- **Format (reuse weekly):**

```
Bug of the week — <one-line description>

<screenshot or redacted admin screenshot>

What Sentry saw: <nothing / 200 OK / 404>
What Mushi-chan heard: "<the actual user sentence>"
Classified: <Severity / Category / Confidence>
Dispatched: <PR link>

🐛
```

  - Low effort, high compound. Builds Mushi-chan's reputation as a bug-having
    friend, not a vendor.
  - After 8–10 weeks, the aggregator dev.to post is a goldmine of social
    proof and unintentionally the best marketing you'll produce.

---

## YouTube short — 90-second demo

Already scripted in [snippets.md](./snippets.md). Record **once**, in one of
the first two weeks after launch. Upload to:

- YouTube Shorts
- Bluesky native video
- X / Twitter native video
- LinkedIn native (native uploads out-perform links by ~5×)
- dev.to embedded in the launch-week retro post

**Recording tips:**

- Phone for the shake-to-report scene (more realistic than simulator).
- Screen record for the admin flow (OBS or the macOS built-in — 1080p).
- Voice-over in one take, lightly edited. Mushi-chan sounds like a person
  talking to a person, not a narrator.
- Background music only if you really want it. Lo-fi beats = AI cliché;
  avoid. A single well-placed silence beats music.
- Export twice: portrait (Shorts / TikTok / Reels) and landscape (LinkedIn /
  Twitter / the dev.to embed).

The 90-second video does the heavy lifting for months — it lives in every
README, every pinned tweet, every LinkedIn post, every Product Hunt
re-submit. Treat it like a core asset.

---

## Pacing

Shipping *one* post a week is the goal. Shipping zero is fine for a specific
week if you're heads-down on a feature. Shipping three to catch up is a trap
— readers prefer consistency to volume.

Research (dev.to creator report, Pragmatic Engineer): posts at weeks 2–4
after launch get the most stars-per-view. The audience is warm from the
launch spike and the algorithm surfaces you to adjacent readers.

If you can only ship two posts in the 8-week window, make them **Post 1
(auto-fix loop)** and **Post 2 (Sentry companion)**. Those do the most
category-defining work.
