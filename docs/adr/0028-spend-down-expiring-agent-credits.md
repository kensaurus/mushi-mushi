# 0028. Spend-down mode: Mushi may spend an expiring Cursor key on its own, inside the auto-fix caps

Status: Accepted (owner-delegated, 2026-10-20) Date: 2026-10-20

Related: migration `20261020090056_byok_spend_down.sql`, `_shared/spend-down.ts`,
`_shared/spend-down-db.ts`, `spend-down-worker/`, `api/routes/byok-spend-down.ts`,
`apps/admin/src/components/settings/SpendDownSection.tsx`, MCP
`get_spend_down_status` / `set_byok_spend_down`, CLI `mushi keys spend-down`;
builds on [0023](0023-ai-keys-can-be-shared-by-every-app-in-an-organization.md)
and [0013](0013-cloud-coding-agents-run-through-edge-adapters.md).

## Context

On 2026-10-20 the owner had two Cursor accounts whose usage credits (Grok 4.7
xhigh) were about to expire unused, and asked that Mushi "do the role of
maximizing the usage of tokens and credits that are expiring". Spending them
meant someone dispatching fixes by hand, report by report, on every app, until
the date passed. Mushi already dispatches fixes on its own (auto-fix after
triage) inside per-app caps (`autofix_max_dispatches_per_day`,
`autofix_max_spend_usd`), and every fix opens a draft PR that a person merges.

Cursor publishes no API for remaining credit (Plan 021), so Mushi cannot know
how much is left.

## Decision

- A Cursor key in `byok_keys` can be set to **spend down**: a credit expiry
  date (`credits_expire_at`, separate from the credential's `expires_at`), a
  model, fixes per day (1-200, default 10) and how many days before expiry to
  start (1-90, default 14). Off by default; Cursor keys only; on requires a
  date (database check).
- The `spend-down-worker` (cron `8-58/10 * * * *`, every 10 minutes since 2026-10-20) dispatches, for each key in
  its window, the best open reports of the apps that key **already serves**,
  using ADR 0023's order without changing the resolver: a key serves an app
  only where `resolveCursorApiKey` would pick it first (own pool key by
  priority, then the legacy Integrations key, then shared keys by priority;
  a priority tie serves nothing), so a dispatch tagged with the key is billed
  to it. Apps with auto-fix off or no repo are skipped.
- Every dispatch is `trigger: 'automatic'`, so the app's auto-fix caps apply
  (checked by the worker and again by fix-worker), at most three cloud agents
  run per app, and a report dispatched in the last 7 days is not picked again.
  Ranking: severity × judge score × named component × 1.3 when the report
  already has Sentry or stack evidence, one per report group.
- The limit is a count of dispatches, not dollars, because no balance is
  readable. Nothing merges: each fix is a draft PR, as today.
- Turning it on for a shared key is an organization owner's or admin's call
  in the console (ADR 0023). An app's own key: its owner or admin, also from
  the CLI or MCP (`mcp:write`).

## Rejected

- **Pinning the spend-down key per dispatch.** It would let a shared key
  spend on an app that has its own key, which ADR 0023 forbids, and would
  need a resolver change. Serving only the apps that already use the key
  keeps one resolver.
- **A dollar floor** (`spend_floor_usd`, Plan spec §4). Without a balance
  API the "estimated remaining" would be a guess presented as a number.
- **Spending outside the auto-fix caps.** The caps are the owner's statement
  of how much Mushi may do alone; spend-down does not get its own exception.
  Raise the cap to spend faster.
- **UX runs and QA generation in the same worker.** The cloud UX run is a
  session-only route (ADR 0017's approval posture); QA generation runs on
  Anthropic/OpenAI keys, not Cursor. Left to a later decision (BL-087,
  BL-088).
- **Excluding every report with a failed attempt** (plan §4 step 2). A
  failure from a broken key or a Cursor outage says nothing about the report.
  Instead a report is skipped for 7 days after any dispatch, and for good
  once its latest attempt carries an agent verdict (`already_fixed`,
  `wrong_repo`, `not_actionable`, `needs_human`).
- **A model picker fed by Cursor's model list** for now: the model is a
  validated free-text spec (BL-090).

## Consequences

- A key with spend-down on starts fixes every 30 minutes in its window, up to
  its daily number; the console, `get_spend_down_status` and
  `mushi keys spend-down` show today's count, the apps it pays for and why the
  last tick skipped an app.
- Same day, the Cursor key resolver was brought back in line with ADR 0023:
  an app's legacy Integrations key now comes before a shared key
  (`resolveCursorApiKey`); before, a shared key moved such apps onto another
  account.

## Amendment (2026-10-21): stop-loss and scoreboard

Status: Accepted (owner-delegated, 2026-10-21)

### Context

Three days in, the live database showed what the spend bought: 258
spend-down runs, 154 opened a PR (60%), 64 ended with a no-PR agent verdict
(25%: already fixed, not actionable, needs a person, wrong repo), 40 failed
some other way (16%), none merged yet. The Opus reviews of those PRs (ADR
0030) said merge on 29%, fix_first on 49%, hold on 22%. The owner asked that
every token be traced, evaluated and proved, and that spending stop where it
does not produce mergeable work. The rule counted dispatches and nothing
else, so an app whose agent kept opening unmergeable PRs, or kept finding
nothing to do, was spent on at the same rate as a good one.

### Decision

- **Stop-loss per app** (`spendDownStopLoss` in `_shared/spend-down.ts`,
  read by the worker before it dispatches to an app). It reads the app's
  newest 20 Opus verdicts on spend-down PRs (`fix_reviews` of the attempts of
  `fix_dispatch_jobs` with `dispatch_metadata.source = 'spend_down'`, any
  key, from the newest 100 such runs) and its newest 20 finished spend-down
  runs, and pauses the app when:
  - fewer than 20% of the reviews are "merge" (baseline 29%);
  - more than 35% are "hold" (baseline 22%);
  - more than 50% of the finished runs ended with a no-PR agent verdict
    (baseline 25%).
  Each rule needs at least 8 samples (cold start: one or two bad runs are not
  a rate). Exactly 20%, 35% or 50% does not pause. The pause lifts on its own
  once newer samples bring the rates back; there is no manual override and no
  new setting. In-flight runs are not samples.
- A paused app is in the tick summary (`spend_down_last_summary`) with
  `paused: true`, its rates, and a plain-words reason, for example
  "Paused: 3 of the last 20 reviewed fixes were mergeable (15%)". Every pause
  and every resume (paused last tick, not now) writes one structured log line
  (`spend-down.paused` / `spend-down.resumed`) with the key, the app, the rates
  and the sample sizes.
- **Scoreboard**, computed on read from the existing tables, no new table or
  view and no new writes (`keyScoreboardRuns` + `spendDownScoreboard`): per
  key × app × model × UTC day, runs, PRs opened, no-PR verdicts by category,
  other failures, in-flight, Opus merge / fix_first / hold, merged, Opus review
  cost (`fix_reviews.cost_usd`), merge yield (merged / runs) and mergeable
  yield (merge verdicts / runs). `GET /v1/admin/byok/spend-down` and MCP
  `get_spend_down_status` return each key's last 7 days (totals and rows) and
  each app's live stop-loss state; the console shows one line per key
  ("Last 7 days: 258 runs → 154 PRs → 19 mergeable, 0 merged · Opus review
  $8.04") and each paused app with its reason.

### Rejected

- **A SQL view or materialized rollup.** It would be faster at scale but
  needs a migration applied before the API deploys. At ≤200 runs a day per
  key, reading 7 days of rows (2 pages, attempts and reviews in chunks of
  100 ids) is cheap enough; revisit with a view if a key ever runs far more.
- **Pausing the key instead of the app.** Yield differs by app (on
  2026-10-21 one app's runs were 65% no-PR while another's PRs were 67%
  mergeable); pausing the key would starve the apps that work.
- **Counting fix_first as a failure.** A fix_first PR is usually one
  follow-up from mergeable; the hold rate and the merge rate already bound
  the bad and the good ends.
- **Per-app thresholds as settings.** No evidence yet that apps need
  different bars; constants with a rationale are easier to reason about and
  change in review.

### Consequences

- On the 2026-10-21 data the rule would pause three of the seven apps
  (one under 20% mergeable, one over 35% held, one with 65% no-PR runs) and
  leave the rest running or in cold start.
- Each tick adds three reads per served app (its newest 100 spend-down runs,
  their attempts, their reviews).
