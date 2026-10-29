# 0054. Setup and health checks are one registry; a failing root cause pauses what depends on it and shows once

Status: Proposed. Date: 2026-10-29. The owner approved Phase 0 and Phase 1 of
[`docs/plan-simplicity-2026-10.md`](../plan-simplicity-2026-10.md) on
2026-10-29; this record is for the owner to accept.

Related: ADR [0029](0029-site-watch-files-a-page-only-after-a-second-failure.md) (confirm before
filing), ADR [0030](0030-agent-pr-review-gate.md) (the Opus review gate), ADR
[0033](0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md) (infra failures are not
code failures), ADR [0035](0035-verified-fixes-merge-on-proof-not-on-a-verdict.md)
(verified merge), ADR [0041](0041-merge-when-ready-queue.md) (the merge queue),
ADR [0047](0047-agent-prs-run-ci-only-after-review-approves.md) (agent PRs run
CI only after the review approves), ADR [0048](0048-local-workers.md) (local
workers and their lease), `_shared/health-checks.ts`, `_shared/health-gate.ts`,
`api/routes/health-checks.ts`.

## Context

On 2026-10-29 every app's pipeline sat stuck for about a day. The organization's
review follow-up Cursor key had been deleted, so Mushi Mushi turned follow-ups
off (`organizations.review_followup_off_reason`). The console showed dozens of
per-PR rows ("no agent is making them") on each app instead of the one cause.
All four pilot apps had the same three setup gaps (plan §1c), and at least 57
of the top 79 failed fix runs in 30 days repeated an environment fault: each
fix failed again until someone noticed.

Mushi Mushi already had more than 60 setup and health checks, under five names
on five surfaces (setup gaps, SDK health, SDK diagnostics, the server doctor,
the CLI doctor), so no one surface could say "this is the cause, fix it once".

## Decision

1. **One registry.** `_shared/health-checks.ts` gives every check one id and one
   shape: status (`ok`, `problem`, `unknown`), a plain-English title and
   detail, its fix (`auto`, `one_click` with a console page or server action,
   or `guided` steps), the automations it `blocks` (`autofix`, `followups`,
   `train`, `reporter_updates`, `reports`, `review`, `triage`, `lane`), its
   part, and how many items wait on it when counted. Its first members are the
   existing checkers, adapted and never re-implemented: setup gaps, SDK health,
   the SDK diagnostics launcher verdict and the server doctor narrowed to one
   app. `GET /v1/admin/health-checks` serves it (api-ext; `adminOrApiKey`
   mcp:read, members only, a project key only its own app). `mushi doctor`
   (as warnings that do not change whether it passes) and MCP
   `diagnose_setup` read that list. Home's "Fix these first" reads the same
   registry from the stored setup-gaps answer only, so Home never waits on
   GitHub or the live site; SDK and report-button rows join Home in Phase 2.
   `GET /v1/admin/setup-gaps` stays as it is and shares its reader.
2. **A cause shows once.** Home lists at most three root causes, worst and most
   waited-on first. A critical problem is always one; a lesser one only while
   something is counted as waiting on it; "no GitHub repo connected" never is
   (a repo is optional, standalone first, and the setup checklist asks for
   it). A stuck /pipeline group carries the check that explains it
   (`rootCause`) only when that check is a problem for the app of every item in
   it, and Home leaves those groups out of Needs you.
3. **Stop the line, rolled out in two units.** Unit A (read-only) ships the
   registry. Unit B adds the gate: before `fix-worker` starts an automatic
   dispatch, `review-followup` dispatches a follow-up, `merge-queue` runs a
   train tick, gives a PR its turn or starts a conflict agent, and
   `spend-down-worker` dispatches for an app, each asks whether a check that
   blocks that automation is a problem. The switch is
   `mushi_runtime_config.health_gate_mode`: `off` (the default, also for a
   missing row, a failed read or any other value; nothing is read beyond the
   switch), `observe` (record "would pause" in `health_gate_shadow` and run
   exactly as before), `enforce` (withhold and record why). Enforce is turned
   on only after a day of shadow data with no false pauses.
4. **The gate can only withhold.** It never starts, merges, readies or retries
   anything, and it sits in front of the existing gates, never around them: an
   Opus `hold`, the head-pinned merge verdict (`gatedMergePullRequest`,
   `gatedTrainMerge`), the verified-merge gates and the draft → ready rule
   (ADRs 0030, 0035, 0041, 0047) apply exactly as before. Withheld work is left
   where it was (a follow-up row stays queued, a merge-queue row keeps its
   state, spend-down skips the app this tick, an automatic fix-worker job is
   skipped like a held report), so it resumes on its own once the check passes.
5. **Every doubt runs as today.** An `unknown` check never pauses. A stored
   answer older than one hour reads as `unknown`. A failed read of the switch or
   of the checks is `off` / `unknown`. This is the opposite of ADR 0048's lease,
   where an unreadable lease counts as held: the lease protects work a person's
   machine is doing, while this gate only saves wasted runs, so a doubt must not
   stop the line.

The gate reads the stored setup-gaps answer (`setup_gap_results`) and the
review follow-up key live (two small reads). It never probes GitHub or reads
SDK health from a dispatcher.

## Consequences

- One cause, one row, one fix. For example, the 2026-10-29 outage on glot.it
  reads as one "Review follow-up key" row with the PRs that wait on it (24
  `fix_first` PRs in plan §1c) and one "Pick a Cursor key" button.
- With the gate off nothing in the dispatchers changes. In observe mode their
  decisions are the same as off (tests compare the calls, writes and summaries).
- Before `enforce` is trusted, Phase 2 must add a refresher so a stored answer
  stays under an hour old without console visits; until then a stale answer is
  `unknown` and pauses nothing.
- Spend-down dispatches through `fix-worker`, so observe mode counts the same
  pause in both. The shadow table is keyed per automation, so the counts stay
  separable.
- `autofix_agent_key` counts only Cursor keys with spend-down on. An automatic
  dispatch on another agent may be counted as "would pause"; the shadow day is
  where that shows before enforce is on.

## Relations

- **0029** (confirm before filing) is the same rule applied to pausing: one
  stored, fresh problem is needed, and `unknown` is never evidence.
- **0033** (infra failures are not code failures): a root cause here is
  environment, not code; pausing it stops the repeated infra failures 0033
  already refuses to blame on the code.
- **0047** (CI only after review approves): unchanged; the gate never readies a
  draft and never runs CI.
- **0048** (local workers): local lanes are not gated in Phase 1 (`lane` is a
  reserved block); their lease rule is unchanged.

## Rejected

- Running the live checks (GitHub probes, SDK health) inside each dispatcher:
  too slow and too many GitHub calls per tick.
- Failing closed on an unreadable check: it would turn a slow database into a
  stopped pipeline.
- Turning enforce on with the registry: the owner asked for observe-only first,
  behind a switch that defaults to off.
