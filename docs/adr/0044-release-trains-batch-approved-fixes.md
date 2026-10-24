# 0044. Release trains: batch an app's approved fix PRs into one merge

Status: Accepted Date: 2026-10-24

Related: ADR [0041](0041-merge-when-ready-queue.md) (merge queue, amended), ADR
[0030](0030-agent-pr-review-gate.md) (Opus PR review gate), ADR
[0035](0035-verified-fixes-merge-on-proof-not-on-a-verdict.md) (service merges, regression watch), ADR
[0038](0038-known-vulnerability-findings-are-bugs.md) (security advisories), `_shared/merge-train.ts`,
`_shared/gated-merge.ts` (`gatedTrainMerge`), `merge-queue/train.ts`.

## Context

On 2026-10-23 the merge queue (ADR 0041) merged about 33 agent PRs, one at
a time. Every merge was a push to an app's main branch, and every push ran
the app's CI, redeployed its site (tsumagoi 12 times, help-her-take-photo
14 times) and published an OTA update to its users (glot.it 4, lets-talk 5,
yen-yen 2). Each queued PR also got its own update-branch commit, its own
CI run and its own Opus re-review before it merged, which flooded the shared
CI machine and the owner's notifications. The owner asked for fixes to ship
in batches and for less CI.

GitHub's merge queue groups PRs this way, but needs organization-owned repos;
the apps live in personal repos (ADR 0041).

## Decision

- **Release trains are the default** (`project_settings.release_mode =
  'train'`; `'each'` keeps ADR 0041's one-PR-at-a-time merge). The
  `merge-queue` worker collects an app's approved PRs and, once per
  `train_interval_minutes` (default 360) or as soon as `train_max_members`
  (default 15) are ready, builds one train per repo: a `mushi/train/<UTC
  time>` branch from the base head, each member merged into it with GitHub's
  server-side merge API (a conflicting member waits for the next train), and
  one train PR listing the members. CI runs once on the train.
- **Who rides:** open PRs whose latest Opus verdict is `merge` on their
  current head and that have no hold. A stale verdict is re-queued for
  review first. Oldest first.
- **Express lane:** a fix for a `security_advisory` report or a critical
  bug skips the wait and merges alone, as in ADR 0041.
- **Green train:** `gatedTrainMerge` re-checks every member against the
  review gate as a service caller (Opus `merge` on the exact member head,
  repo in the project), then merges the train PR with a merge commit pinned
  to the train head. GitHub then marks each member PR merged; every member
  gets the normal finalize (report Fixed, reporter told) and the regression
  watch of ADR 0035. A member that lost its approval, or that a person took
  out of the queue, closes the train and the rest go again.
- **Red train:** bisect. The train PR is closed, its first half goes again
  as a new train (attempt + 1), the rest waits for a later one. A member
  that fails alone is held with the failing checks named, where the CI-repair
  follow-up (ADR 0032) can pick it up.
- **Train PR text** comes only from the members' titles, as plain text,
  with `[...]` markers stripped, so no member can put `[release:...]` or
  `[skip ci]` into the host's merge commit.
- The console shows each repo's train or when the next one leaves, and sets
  the mode and interval (`PUT /v1/admin/projects/:id/release-settings`,
  console only, non-viewers, audited).

## Rejected

- **A daily fixed release window** (for example 10:00 JST). An interval
  from the last train adapts to how busy an app is, and a full batch leaves
  at once.
- **Squash-merging every train.** It leaves the member PRs open and folds
  the members into one commit; it is used only where the repo requires a
  linear history.
- **One train across repos.** Each repo has its own CI and deploy; a red
  repo would hold back the others.
- **Merging members one by one after a green train.** Each merge is a push,
  a deploy and a release again, which is what this decision removes.

## Consequences

- A fix waits up to the interval before it ships, unless it is urgent.
- An app's CI runs once per train instead of once per PR plus once per
  branch update; a red train costs a few extra runs while it is bisected.
- A repo that keeps a linear history (a `required_linear_history` ruleset or
  branch protection rule, or merge commits turned off; mushi-mushi and yen-yen
  on 2026-10-24) gets a squash merge of the train instead. GitHub then leaves
  the member PRs open, so Mushi finalizes each member (report Fixed, reporter
  told, regression watch) and then closes its PR as shipped in the train.
