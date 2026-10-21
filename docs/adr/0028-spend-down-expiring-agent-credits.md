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

Related: migration `20261021120000_spend_down_stop_loss.sql`,
`POST /v1/admin/byok/spend-down/projects/:projectId/resume`.

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

**Stop-loss per app** (`spendDownStopLoss` in `_shared/spend-down.ts`, read by
the worker before it dispatches to an app):

- **Samples.** The app's spend-down runs under any key (never manual or
  auto-fix dispatches) dispatched in the last 14 days and after its last
  Resume: the newest 40 Opus verdicts on their PRs (by review time) and the
  newest 40 finished runs. A run is in flight while its attempt is open (a
  draft PR attached early does not count as opened); `validation_rejected`
  (a notes-only PR) is another failure, not a PR.
- **Entry.** With at least 20 samples for the rule, the app pauses when the
  one-sided 95% Wilson bound (z = 1.645) says:
  - the merge rate's upper bound is under 20% (baseline 29%);
  - the hold rate's lower bound is over 35% (baseline 22%);
  - the no-PR-verdict share's lower bound is over 50% (baseline 25%).
  A rule needs 20 samples so 1-in-20 mergeable (bound 19.6%) pauses and
  2-in-20 (26.2%) does not.
- **Hysteresis.** A paused app resumes when, for every rule with 20+ samples,
  the point estimate clears 25% merge, 30% hold and 45% no-PR. So it resumes
  when newer runs recover, and when its old runs age out of the 14 days.
- **Probe.** A paused app still gets 1 spend-down dispatch per UTC day
  (`dispatch_metadata.spend_down_probe`), inside the key's limit and the
  app's auto-fix caps, so evidence keeps arriving. It resumes at once when its
  newest 2 reviewed probes since the pause both got "merge".
- **Resume.** An app's owner or admin can resume it in the console. This sets
  `project_settings.spend_down_stop_loss_reset_at`; samples before it are
  ignored, so the app is back in cold start. The reset is per app, not per key
  × app, because the samples are the app's runs under any key (an app is paid
  for by one key at a time, ADR 0023). It is console-only (`jwt-only`) because
  restarting spend is a deliberate decision.
- **Trace.** A paused app is in the tick summary (`spend_down_last_summary`)
  with `paused`, `pausedAt`, its rates and bounds, and a plain-words reason
  (e.g. "Paused: 1 of the last 20 reviewed fixes were mergeable (5%)"). Apps
  the tick did not reach (the key's limit ran out) are carried forward with
  `carried: true`. One structured log line (`spend-down.paused` /
  `spend-down.resumed`, with `resumedBy`) is written per change of state,
  never per tick.

**Scoreboard**, computed on read from the existing tables, with no new writes
(`keyScoreboardRuns` + `spendDownScoreboard`). Per key × app × model × UTC day
it counts:

- runs, in flight, PRs opened;
- no-PR verdicts by category, other failures;
- Opus merge / fix_first / hold, merged;
- the latest review cost per PR (`fix_reviews.cost_usd`; a re-run overwrites
  it, and usage rows are keyed by report, not attempt, so the sum is the
  latest review of each PR);
- merge yield (merged / runs) and mergeable yield (merge verdicts / runs).

`GET /v1/admin/byok/spend-down` and MCP `get_spend_down_status` show:

- each key's last 7 days. Totals are key-wide, like `dispatchedToday`; rows
  are only for the apps the caller can open.
- each app the caller can open, with its live stop-loss state.
- a count of the key's other apps, without their names.

A failed yield or scoreboard read gives `null` and a note, not a 500. The
console shows one line per key ("Last 7 days: 258 runs → 154 PRs → 19
mergeable, 0 merged · Opus review $8.04 (latest review per PR)"), and each
paused app with its reason, "probing 1/day" and Resume.

### Rejected

- **Fixed-rate thresholds on the newest 20 samples with an 8-sample cold
  start** (this amendment's first draft). A simulation at the baseline
  paused 53% of average apps within 20 runs and 97% within 200, and it paused
  glot.it at 23% merge, where half of all merge verdicts came from. A sliding
  20-sample window with the Wilson bound still paused 22.6% within 200 runs.
  The 40-sample window pauses 2.5% (glot-like 23% merge: 13%) and still
  pauses 98% of 5%-merge apps within 100 runs.
- **Samples without an age limit, and no probe.** Samples come only from
  spend-down dispatches, so a paused app would never get new evidence and
  would stay paused until the credits expired.
- **A SQL view or materialized rollup.** It would be faster at scale but
  needs a migration applied before the API deploys. At ≤200 runs a day per
  key, reading 7 days (pages of 1,000; attempts and reviews in chunks of 100
  ids), served by the new key/time index, is cheap; revisit if a key runs far
  more.
- **Pausing the key instead of the app.** Yield differs by app; pausing the
  key would starve the apps that work.
- **Counting fix_first as a failure.** A fix_first PR is usually one
  follow-up from mergeable; the merge and hold rules bound the two ends.
- **Per-app thresholds as settings.** No evidence yet that apps need
  different bars.

### Consequences

- On the 2026-10-21 data (14 days, newest 40), the rule pauses no app:
  - glot.it (9 of 40 merge, upper bound 34.9%) keeps running;
  - tsumagoi (19 of 40 runs without a PR, lower bound 35.1%) keeps running;
  - yen-yen (11 reviews) is still in cold start.
  The rule targets apps that are reliably bad, not unlucky.
- Migration `20261021120000_spend_down_stop_loss` adds the reset column and
  two indexes on `fix_dispatch_jobs`: one by key and time, for the scoreboard
  and today's count; one by app and time, for the samples. The app index was
  missing on the live project. Until the migration is applied, the code reads
  the reset as "never" and Resume answers 503 `MIGRATION_PENDING`.
- Each tick reads each served app's samples once (cached across keys).
