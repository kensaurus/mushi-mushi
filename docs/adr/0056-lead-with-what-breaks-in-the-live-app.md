# 0056. Lead with what breaks in the live app, in plain words; the free check is the front door

Status: Superseded by [0058](0058-one-stop-platform-to-enhance-vibe-coded-apps.md) (the one job, the tagline and north star, the category line) on 2026-11-13; the rest stands            Date: 2026-11-11

Supersedes: [0004](0004-lead-with-the-bug-mediator-category.md) (the category
line), and the "one job" sentence and the hero's action pair of
[0052](0052-public-surface-leads-with-one-job.md), and its two amendments
where they conflict. Everything else in 0052 stands: the operator cockpit
stays off the public path, the sample stays labelled "Sample", the pages for
integrations, voice and CI cost stay in the docs.

Related: [`VISION.md`](../../VISION.md) §1, `packages/brand/src/index.js`
(`MUSHI_TAGLINE_V2`), `scripts/check-positioning-consistency.mjs`,
`apps/docs/lib/landing-copy.ts`, `apps/docs/lib/landing-cinematic.test.ts`,
`packages/server/supabase/functions/_shared/production-check.ts`,
`packages/server/supabase/functions/_shared/activation.ts`.

## Who decided

The owner, 2026-11-11, after a research pass on the public site, the console
and the funnel: "positioning decide for me plesae. retire and decide for me
then. remove the few people then. plesae proceed with the full gtm for me
please. since the current method and avenes are not working anyway." The
agent made the call below on that instruction. The owner can reverse it with
a superseding ADR.

## Context

Measured 2026-11-11 (queries in the GTM research note of that day):

- Outside activations ever: 0. The two "activated" rows were the CLI wizard's
  own test report (`cli://wizard`, fixed in the same batch) and an owner test
  on localhost.
- One genuine outside signup since 2026-10-27; it stopped after the wizard
  test. Landing views: about 68 real in 15 days (220 more were referrer spam
  from aocr.org). Show HN was blocked for the new account; the Reddit post
  was removed; 21 cold emails produced no measured visit.
- The one job of 0052 starts from "a user said your app is broken". On the
  owner's own nine apps in 60 days, people filed 34 reports; Mushi Mushi's own
  checks found 2,031. Users mostly do not report. They leave.
- A non-technical walk of the landing (2026-11-11) found the headline clear
  but the first screen a terminal command, jargon ("bug mediator", MCP, CI)
  before any definition, and the 3-step explanation about 1,400 px down.
- What a brand-new free project gets with no keys of its own (read from the
  code, 2026-11-11): the report widget and a plain-English diagnosis (Mushi
  Mushi pays for the model), the one-time Production Check, and the
  known-holes scan once GitHub is connected. The hourly site watch and site
  audit need the user's Firecrawl key; code audits and the first-user test
  need the user's own local agent (`mushi work`).
- In 2026 PostHog, Sentry, Replit and Lovable all fix crashes with AI inside
  their own tools. "Explain a crash" alone is not a reason to try a new tool.

## Decision

1. **The one job becomes: find out what is broken in your live app, and get
   it fixed, in plain words.** Two ways in, both free: your users tap a
   button to tell you, and Mushi Mushi checks your live site for you. Every
   bug gets a plain-English explanation and a fix your AI (Lovable, Cursor,
   Claude Code) can apply. Public copy only promises, as free and keyless,
   what the list above delivers. The deeper checks (hourly watch, code audit,
   first-user test) are described as "connect when you want", with what each
   one needs.
2. **The tagline stays:** "Your AI wrote it. Mushi Mushi tells you why it
   broke." It passed the 5-second test. The north-star sentence stays.
3. **The category line changes** from "The bug mediator for AI-built apps" to
   "Bug fixing for AI-built apps" (the promise line already says plain English). "Mediator" names how it
   works inside (one queue between users, monitoring, tracker, chat and
   agents). It stays in `docs/operators/` and the integrations pages, never in
   a hero. A solo builder has no team to mediate between.
4. **The buyer is unchanged, and named in plain words:** a person who built an
   app with AI (Lovable, Bolt, Cursor, Claude Code) and has real users. A
   no-code founder is the same buyer, so the Lovable/Bolt path is listed
   first wherever the install paths are listed.
5. **The landing's front door is the free Production Check.** The primary
   action is "Check your live app free" (a URL box, no sign-up). The install
   box is the second action. The sample diagnosis stays one scroll down. This
   is allowed only after the check:
   - reports "we could not reach your site" as a failed check, never as an
     empty pass;
   - leads with breakage a visitor would see (broken links and images, pages
     that 404, placeholder titles such as "Lovable App" or "Vite + React",
     errors on load), before security headers.
6. **Retired.** The "10 paid users by 2026-11-30" target: it contradicted
   free-first, and nothing is activated yet. The north star stays activated
   external projects per week; the leading indicator is an outside app's SDK
   seen live on a deployed origin (`sdk_seen_live`). The concierge play
   (founder-led onboarding of the few hand-raisers) is dropped. No account or
   user data is removed because of that.

## Rejected

- **A new tagline.** It is the one line visitors understand; the problem was
  everything under it.
- **Leading with "the bugs your users never report" as the free promise.**
  True on the owner's setup, but most of those checks need keys or a local
  agent a new user does not have. It is said only next to what it needs.
- **Leading with a security scan.** The free URL-scanner space is crowded and
  security-first (2026), and it is not the job a vibe coder hires Mushi Mushi
  for.
- **Keeping "bug mediator" as the hero category.** Non-technical visitors
  read it as jargon; it describes a team job.

## Consequences

- `MUSHI_TAGLINE_V2.category`, `VISION.md` §1.5, the `AGENTS.md` positioning
  block, the README first screen, the npm descriptions and `server.json`
  (100-character cap) change together, held by
  `scripts/check-positioning-consistency.mjs`.
- `apps/docs/lib/landing-cinematic.test.ts` changes its locked hero pair, tab
  order (Lovable/Bolt first) and section order in the same change as the copy,
  because this decision changed them. The test still holds one primary action
  and one secondary link.
- The Production Check gets a failed state and breakage rules before the
  landing points at it.
