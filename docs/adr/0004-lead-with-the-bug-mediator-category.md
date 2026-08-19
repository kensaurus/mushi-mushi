# 0004. Lead with "the bug mediator for AI-built apps"

Status: Accepted            Date: 2026-08-19

## Context

Mushi's category line was "the comprehension layer for AI-built apps", and
`VISION.md` §1.7 carried an explicit tripwire: *we will not lead with the
integration-hub story* — that material was quarantined to `docs/operators/`.
The intent was sound: leading with plumbing implies the reader must already own
a monitoring stack.

Two things broke the framing. First, the repo answered "replace Sentry or run
alongside?" three different ways depending on the page — `sentry-alternative.mdx`
said replace, `docs/marketing/snippets.md` said "companion, not a replacement"
in six places, `VISION.md` said standalone-first. Any one is defensible;
holding all three made the question unanswerable, and it was the single most
common question from customers. Second, "comprehension layer" gave no account
of the eleven adapters, thirteen plugins and six coding-agent adapters already
built — the product had outgrown its own description.

## Decision

The category is **"the bug mediator for AI-built apps"**: one queue between
users, monitoring (Sentry/Crashlytics/Rollbar), trackers (Linear/Jira/GitHub),
chat (Slack/Discord/Teams), and coding agents. One canonical answer to "why not
just Sentry?" lives in `VISION.md` §1.6 and is reused verbatim everywhere.
Tripwire #2 becomes *we will not make you rip anything out*.

## Rejected alternatives

- **Keep "comprehension layer", quarantine integrations** — the prior state.
  Rejected: it hid the differentiator and left the Sentry question unanswered.
- **Lead as a Sentry alternative** — pricing-led ($15 vs $66+), strong hook.
  Rejected: makes replacement the premise, which is false for most teams and
  invites a feature-parity argument against a mature product.
- **"Integration hub" / "synthesis layer"** — the drift `VISION.md` originally
  warned against, and still rejected: it presumes the reader already runs a
  monitoring stack, so it fails the standalone-first buyer.
- **Leave the three contradictory answers, pick per page** — rejected: the
  inconsistency was the actual problem, not any individual answer.

## Consequences

`packages/brand` is the single source for the category string; the front door
now leads with the mediator, and enterprise plumbing (SSO, region routing,
Helm) still stays operator-only. `scripts/check-positioning-consistency.mjs`
enforces the north star, category, buyer, and the three tripwires across
`VISION.md`, `AGENTS.md`, `README.md` and `package.json` — changing the story
means changing the guard in the same commit, deliberately. The v2 hero sentence
is deliberately untouched, so no package README needed to change.
