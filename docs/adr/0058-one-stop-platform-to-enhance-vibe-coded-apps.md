# 0058. One place to improve AI-built apps; bug fixing is one pillar, not the category

Status: Accepted 2026-11-13 (owner). Date: 2026-11-13

Supersedes: [0056](0056-lead-with-what-breaks-in-the-live-app.md) decision 1
(the one job), decision 2 (the tagline and north star stay), decision 3 (the
category line), and its rejection of a new tagline. It also replaces what was
left of the one job in [0052](0052-public-surface-leads-with-one-job.md).
The rest of 0056 stands; see "What survives from 0056" below.

Related: [`VISION.md`](../../VISION.md) §1 and §2.1, `AGENTS.md` (positioning
block), `packages/brand/src/index.js` (`MUSHI_TAGLINE_V2`),
`scripts/check-positioning-consistency.mjs`,
`scripts/check-tagline-consistency.mjs`,
`scripts/normalize-package-metadata.mjs`, `apps/docs/lib/landing-copy.ts`,
`packages/server/supabase/functions/api/routes/journeys.ts`,
`packages/server/supabase/functions/_shared/journey-map.ts`.

## Who decided

The owner, 2026-11-13, in their own words: "i told you to reposition mushi
mushi as a one stop platform to enhance vibe coded repos and apps - not only
bug fixing please." And, on the new Journey optimizer: "journey optimizer is
good - because we want to enhance our vibe coded apps and sites".

0056 was an agent's call on the owner's delegation (2026-11-11). This is the
human reversal that `docs/adr/INDEX.md` and `VISION.md` ask for.

## Context

- 0056 narrowed the category to "Bug fixing for AI-built apps" and kept the
  bug-only hero "Your AI wrote it. Mushi Mushi tells you why it broke."
- The product already does more than fix bugs, and the owner uses it that way
  on their own apps: the first-time user test, UX runs, code audits, known
  holes, the design system, repo clean-up and CI cost.
- The Journey optimizer (console `/journeys`, built in the same change) maps
  how people move through an app from real visits plus a crawl of the live
  site. It flags dead ends, loops, pages people leave from, orphan, deep and
  duplicate pages, each with a plain-English suggestion and a prompt for the
  coding agent. A bug-only category has no room for it.
- 0056's own data still holds: users mostly do not report bugs, they leave.
  A product that also shows where people get stuck answers that directly.

## Decision

1. **Category: "One place to improve AI-built apps."** Bug fixing is one
   pillar, not the category. Three pillars:
   1. **Fix what breaks.** Bug reports from the widget, the free Production
      Check, the live-site watch, Sentry and other monitors. Each bug gets a
      plain-English diagnosis and a fix the user's AI can apply.
   2. **Improve the journeys people take.** The Journey optimizer and the
      first-time user test.
   3. **Improve the code.** Known holes, code audits, the design system, repo
      clean-up and CI cost. Changes land as reviewed draft PRs. The design
      system and CI runner pages are operator-only in the console today, so
      public surfaces name known holes, code audits and repo clean-up until
      those pages open to every user.

   All three work inside the editor or agent the user already has (MCP, CLI,
   skills). That is how the product works, not a fourth pillar.
2. **New tagline ladder** in `MUSHI_TAGLINE_V2`, the same on every surface the
   consistency scripts check:
   - Hero: "Your AI built it. Mushi Mushi makes it better."
   - North star: "Your AI built it. Mushi Mushi makes it better: it finds what
     breaks, where people get stuck and what the code needs, then hands your
     editor the fix in plain English."
   - Promise (npm descriptions, one-liner): "Fix bugs, smooth user journeys
     and clean up the code".
   - Pitch (npm cards, MCP registry, docs JSON-LD): "One place to improve
     AI-built apps: fix bugs, smooth user journeys and clean up the code."
3. **The buyer is unchanged:** the solo or indie vibe coder who builds with
   Cursor, Claude Code, Lovable or Bolt and has real users.
4. **The tripwires are unchanged.** Standalone first; nothing to rip out; the
   surfaces never diverge.
5. **The "is this drift?" test** becomes: "Does this help a solo vibe-coder
   find and fix what is wrong with their app (a bug, a journey where people
   get stuck, or a code problem) faster, without leaving their editor?"

## What survives from 0056

- The free Production Check is the front door and the landing's first action,
  with its failed state ("we could not reach your site" is a failed check,
  never an empty pass) and its breakage-first rules.
- Public copy promises as free and keyless only what is free and keyless.
  Each pillar is named with what it needs. Today: the report widget, the
  diagnosis, the Production Check, the journey map from real visits and the
  known-holes scan (once GitHub is connected) need no key of the user's own.
  The site scan behind the Journey optimizer and the hourly site watch need a
  Firecrawl key. Code audits and the first-time user test need the user's own
  agent (`mushi work`).
- Lovable and Bolt are listed first wherever install paths are listed.
- "Mediator" is the inside view only, never a hero word.
- The retired "10 paid users" target stays retired, and so does the concierge
  play. The north star metric stays activated external projects per week.
- Operator-only pages (UX runs, design system, CI runners, full-stack audit
  in the console) stay off the public path until they are open to every user.

## Rejected

- **Keeping "Bug fixing for AI-built apps" and adding journeys as a feature.**
  The owner rejected this directly ("not only bug fixing").
- **"Growth analytics" or "product analytics" as the category.** The journey
  pillar ends in a fix the agent can apply, not a dashboard. Analytics is
  someone else's word and someone else's buyer.
- **A category line with "enhance" or "platform" in it.** Plain words test
  better with non-technical builders; "improve" and "one place" say the same.

## Consequences

- `MUSHI_TAGLINE_V2` (hero, north star, one-liner, promise, sub-hero, offer
  line, category, micro), `VISION.md` §1 and §2.1, the `AGENTS.md` positioning
  block, the README first screen, every package README hero, the npm
  descriptions, `server.json`, `glama.json`, `TRADEMARK.md`,
  `docs/marketing/VOICE.md` and the docs landing change together. The old
  hero is now a stale variant in `scripts/check-tagline-consistency.mjs`.
- Generated files follow on their next run: `llms.txt`, `llms-full.txt`,
  the Markdown mirrors, the MCP docs index and the OG card.
- The landing's locked tests (`apps/docs/lib/landing-cinematic.test.ts`,
  `apps/docs/lib/docs-meta.test.ts`) follow the brand ladder.
