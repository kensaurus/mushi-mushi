# 0042. Skill runs: apply a catalog skill to one part of an app, round by round, through the fix loop

Status: Accepted (owner, 2026-10-23) Date: 2026-10-23

Related: ADR [0028](0028-spend-down-expiring-agent-credits.md) (spend-down), ADR
[0030](0030-agent-pr-review-gate.md) (Opus PR review), ADR
[0032](0032-review-follow-ups-send-fix-first-prs-back-once.md) (review follow-ups), ADR
[0041](0041-merge-when-ready-queue.md) (merge when ready), ADR
[0039](0039-better-models-make-mushi-better.md) (better models), ADR
[0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) (local UX loop),
`_shared/skill-runs.ts`, `skill-runs/index.ts`, `api/routes/skill-runs.ts`.

## Context

On 2026-10-23 the owner asked which of the 148 synced skills (kensaurus/skills,
`agent_skills`) could improve the apps in an iterated pipeline, using expiring
Cursor credits. Two facts:

- The cloud mode of Skill Pipelines dispatches each step on the app's legacy
  single Cursor key (`project_settings.cursor_api_key_ref`), not on the pooled
  keys spend-down uses, and its pull requests are not fix attempts, so they skip
  the Opus review, the follow-ups and the merge queue. It had 9 runs, all aborted.
- Spend-down idles when an app has no open report, while static scans and a
  visual crawl that day showed plenty of improvement work that is not a bug.

## Decision

- **A skill run** is one skill, one app, one scope ("the /settings pages") and at
  most 5 rounds, started from /credits (Spend credits). Only skills whose result
  an agent can measure and that need no product decision are offered
  (`SKILL_RUN_SKILLS`: accessibility, responsive layouts, UI states, page UX,
  readability, forms, native feel, one design system, translations, SEO,
  performance, bundle size, error handling, dead code, unit tests, and since
  2026-10-27 the parked-work register, measured by its diff). Each names
  what to measure before and after; the numbers go in the PR.
- **Each round is a report** (`source = 'skill_run'`, filed `classified`, no
  model triage) whose description carries the task, the measurement and the
  skill's SKILL.md (capped at 12,000 characters, with a link to the rest).
  Spend-down sends it to the app's own pooled Cursor key with the key's model, so
  the key never leaves the vault and a better model makes every round better.
- **Its PR is a fix attempt**: Opus reviews it, follow-ups answer "fix first",
  and with "merge each round when ready" (default on) an Opus-approved round PR
  goes into the merge queue, whose own gates decide (merge verdict on the exact
  head, CI green, never past a hold).
- **The next round** is filed after a merge and names the merged rounds, so it
  builds on them. A run ends when the agent answers `Mushi verdict:
  already_fixed` or `not_actionable` (nothing left in scope) or after its last
  round; it stops on `needs_human`, `wrong_repo`, a dismissed round or a closed
  PR. At most 5 active runs per app. Worker `skill-runs`, every 10 minutes.

## Rejected

- **Fix Skill Pipelines' cloud mode instead.** It would need its own key
  resolution, review, follow-up and merge paths, which the fix loop already has.
  Skill Pipelines stay as the handoff (local agent) feature.
- **One open-ended run per app ("make it better").** Without a scope and a
  measurement the agent cannot tell when it is done and Opus cannot check it.
- **Plan skills (pricing, GTM, privacy, onboarding).** They need a person's
  decision; a loop would only produce holds.

## Amendment (2026-10-27): a skill run can run on a local worker lane

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit
delegation (console ops plan P3; ADR [0048](0048-local-workers.md) local workers).

### Context

A skill run's rounds went only to spend-down, on the app's pooled Cursor key in
the cloud. The owner's machines run local worker lanes on their own Cursor
credits, which could run the same rounds, but nothing could send a round there:
spend-down would race a lane for any classified report.

### Decision

- **"Run on"** on /credits: the cloud (as before) or one of the caller's own
  lanes for the app in `fix` or `skill` mode (`skill_runs.lane_id`;
  `POST /v1/admin/projects/:id/skill-runs` takes `laneId`, console only, and
  checks the lane is the caller's and serves the app).
- **Each round of a local run goes into that lane's queue** when it is filed
  (`work_queue.source = 'skill_run'`). If it cannot be queued the round is
  taken back and filed again next tick: a local run never falls through to a
  cloud agent.
- **Spend-down leaves any report waiting in a local lane's queue**
  (`queuedForLocalLanes`), not only a claimed one: a person (or a local skill
  run) chose that machine. A fix lane also leaves a report queued for another
  lane.
- **A lane mode `skill`** takes only skill-run rounds from its own queue and
  never a ranked bug report, so a machine can spend its credits on planned
  improvement work only. A `fix` lane takes queued rounds too.
- The round itself is unchanged: the same report, task, measurement and
  SKILL.md; the lane's agent runs it as `mushi work` runs a report, the PR gets
  the Opus review, follow-ups and the merge queue, and `skill-runs` files the
  next round after a merge (and waits while a lane holds the round, ADR 0048).

### Rejected

- **A separate local skill-run engine.** The fix loop already runs a round end
  to end; a second engine would need its own review and merge path.
- **Letting spend-down and the lane race for the round.** Two agents on one
  round doubles the cost and leaves two PRs for the review to sort out.
