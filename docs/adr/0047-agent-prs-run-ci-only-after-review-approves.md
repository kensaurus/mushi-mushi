# 0047. Mushi's own PRs run the host's CI only after the review approves them

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit delegation ("decide for me please"). Date: 2026-10-27

Related: ADR [0030](0030-agent-pr-review-gate.md) (Opus PR review gate), ADR
[0044](0044-release-trains-batch-approved-fixes.md) (release trains; its
2026-10-26 amendment readies approved drafts), ADR
[0035](0035-verified-fixes-merge-on-proof-not-on-a-verdict.md) (the
`mushi-verify` workflow), `fix-worker/`, `agent-pr-review/`,
`_shared/verify-workflow.ts`, `docs/templates/mushi-verify.yml`.

## Context

Every pull request a host repo runs CI on costs Actions minutes, and most
host repos are private, so the owner pays per minute. In October 2026,
glot.it opened 388 PRs (343 by agents), merged 54 and closed 189 without
merging. Each of those 189 still paid for a full CI run.

The local fix lanes were already cheap. `mushi work` opens drafts, the host
repos skip CI on drafts, and the merge queue readies an approved draft once
per repo per tick (ADR 0044 amendment). Cloud-agent PRs are readied by
`agent-pr-review` after its verdict.

Two Mushi paths still paid for CI before anyone had approved the change:

- **fix-worker** opened its PR and readied it at once whenever the model's own
  self-check passed (`markReady: fixReviewPassed(fix)`). CI ran before any
  independent review. Nothing queued an Opus review for these PRs at all; only
  cloud-agent PRs were reviewed automatically.
- **The `mushi-verify` workflow** Mushi hands to host repos triggered on
  `opened`, `synchronize` and `reopened`. That included drafts, release-train
  branches (`mushi/train/*`), whose members were each proven on their own PR,
  and revert PRs (`mushi/revert-*`), which put back code that was already on
  the default branch. glot.it ran it 339 times in October.

## Decision

- **fix-worker always opens a draft PR** and queues the Opus review
  (`enqueueFixReview`) as soon as the attempt is recorded.
- **`agent-pr-review` readies a fix-worker PR** (agents `claude_code`,
  `rest_fix_worker`, `llm`) only when all of these hold:
  - the verdict is `merge`;
  - the model's own check passed (`fix_attempts.review_passed` is not
    false), so a flagged fix stays a draft for a person, as before;
  - the reviewed commit is still the PR's head. The worker reads the PR
    again just before readying it. A push during the review re-queued it,
    and the next review decides about the new head.

  It records the fix event "Marked ready after review; CI runs now". A
  `fix_first` or `hold` verdict leaves the PR a draft.
- **No review possible.** When the review is skipped because review is off,
  the project has no Anthropic key of its own, or its AI budget is used up,
  and the PR has no verdict on record yet, the model's self-check alone
  decides, as it did before this ADR. The event reads "Marked ready without
  an Opus review; CI runs now". A PR is never stranded as a draft because a
  project cannot pay for a review, and a recorded `hold` is never undone.
- **Cloud-agent PRs are unchanged.** They are still readied on `merge` or
  `fix_first`, now with the same current-head check.
- **The `mushi-verify` template:**
  - adds `ready_for_review` to its triggers;
  - runs its job only when `github.event.pull_request.draft == false`;
  - skips head branches starting with `mushi/train/` or `mushi/revert-`.

  The template and its generator (`_shared/verify-workflow.ts`) stay byte
  for byte equal.
- **Workflow fixes Mushi proposes** (the CI cost "Open fix PR") are also
  opened as drafts for a person to review.

## Consequences

- An agent PR nobody approves runs no host CI. The first CI run is on a
  commit Opus already said to merge.
- Projects with an Anthropic key now pay for one Opus review per fix-worker
  PR (worst case about $0.30 a try, ADR 0030). That is spent on a review the
  merge gate needs anyway before any Mushi merge.
- A fix-worker PR shows as a draft on GitHub for the length of one review
  tick (every 10 minutes) before it is readied.
- The merge queue still readies an approved draft itself (ADR 0044
  amendment), and the console merge still re-readies one
  (`mergeGithubPullRequest`). Either way, a draft that the review missed
  still reaches CI once someone queues or merges it.
- Hosts must update their copy of `mushi-verify.yml` to get the skips. The
  copy Mushi serves (`mushi verify workflow`, the console's PR button) has
  them.

## Rejected

- **Ready on the model's own check (the old behaviour).** The model grading
  its own fix is not independent, and CI ran on PRs that were then closed.
- **Ready on `fix_first` for fix-worker PRs.** Its findings mean the code
  will change, so CI on that head is spent on a commit nobody will merge.
- **Leave drafts stranded when no review can run.** That would make fix-worker
  unusable for projects without an Anthropic key, for a saving the project
  never asked for.
- **Path filters on the verify workflow instead of branch skips.** A release
  train carries real code changes, so a path filter would still run it.
