# 0055. "Decide for me": Mushi queues approved fix PRs and closes held ones on its own

Status: Accepted 2026-10-30 by the owner ("do the judgment for me please - make
it fully automated please. i still have cursor clredits for grok and claude- use
them is fne."). Date: 2026-10-30. Amends [0030](0030-agent-pr-review-gate.md),
[0032](0032-review-follow-ups-send-fix-first-prs-back-once.md),
[0041](0041-merge-when-ready-queue.md) and
[0047](0047-agent-prs-run-ci-only-after-review-approves.md) for apps that turn
it on.

## Context

On 2026-10-30 the owner's eight apps held 607 open agent fix PRs for 584
reports. About 250 had an Opus "merge" verdict, many with green CI, but none
was in the merge queue: ADR 0041 waits for a person to queue each PR. 157 had a
"hold", which ADRs 0030, 0032 and 0047 leave for "a person decides". About 100
were "fix first" after their follow-ups. Sentry kept listing the bugs as open
because nothing merged. The person these ADRs wait for never came, and asked
Mushi to decide.

## Decision

- **A per-app switch, off by default** (`project_settings.auto_decide_enabled`,
  "Decide for me" on the Fixes page merge queue panel). Only an owner or admin
  of the app can turn it on (`PUT /v1/admin/projects/:id/release-settings`,
  `autoDecide`). Self-hosted installs keep today's behaviour until they opt in.
- **No new judge.** Opus (ADR 0030) stays the only model that judges code. The
  policy (`_shared/auto-decide.ts`) maps what the review already stored, and
  GitHub's live view of the PR, to one action:
  - closed or merged on GitHub → record it;
  - the report is closed, or another open PR of the report has a better
    verdict (merge > fix first > no verdict > hold, then newest) → close this
    one as superseded;
  - no finished review on the PR's current head → wait; a verdict on an older
    head → ask Opus again;
  - "merge" with CI not red → queue it (`fix_merge_queue`, `queued_by` null).
    Release trains (ADR 0044) and the gated merge then apply every gate they
    already apply: Opus "merge" on the exact head, own CI green, train CI green;
  - "merge" with red CI, or "fix first" → wait 48 hours for the CI-repair and
    follow-up agents (ADR 0032), longer while one is running, then close;
  - "hold" → close 6 hours after the review, so a person looking can step in.
- **Close means redo, capped.** A closed PR gets a comment with the reason, a
  link to the review and how to undo it (reopen, or turn the switch off). Its
  report goes from `fixing` back to `classified`, where the fix lanes pick it
  up (on the Cursor credits the owner offered). The new attempt's prompt
  already carries the earlier reviews and findings (`loadPriorAttemptsBlock`,
  the lane claim payload), so a held part is not repeated. A report that has
  had 3 pull requests is not redone: it goes to `triaged` and waits for a
  person, so no report burns credits in a loop.
- **Never against a person.** A PR the queue already knows, including one a
  person took out (`removed`), is left alone; the queue insert ignores
  duplicates.
- **Where it runs.** The `merge-queue` worker, before its tick, at most 30 PRs
  a tick, each re-read from GitHub at most every 20 minutes
  (`fix_attempts.auto_decide_checked_at`). A failure never stops the tick.
  `POST merge-queue { projectId, autoDecide: 'dry_run' }` lists the decisions
  for an app without acting, switch on or off.

## Consequences

- A hold no longer waits for a person on these apps. A hold that asked for a
  product decision (an ADR to accept, a visual change) is closed, and the next
  attempt is told what the review flagged, so the conservative choice (leave
  the flagged part out) is what ships.
- Reviews skipped for the AI budget (`llm_budget_exceeded`) stay undecided
  until the budget allows a review; the switch does not spend the Anthropic
  key beyond the reviews ADR 0030 already runs.
- Closing is reversible: reopening a PR on GitHub brings it back, and the
  queue leaves a row a person changed alone.

## Rejected

- **A second model as judge of holds.** It would spend credits to overrule
  Opus with a weaker read of the same diff.
- **Marking every approved draft ready at once.** One CI run per PR on the
  private repos; trains run CI once per batch.
- **Pushing hold findings onto local-agent branches.** ADR 0032 limits
  follow-ups to branches a cloud agent created; a fresh attempt with the
  findings reaches the same result without writing to a branch Mushi did not
  create.
