# 0041. Merge when ready: a server-side merge queue for approved fix PRs

Status: Accepted Date: 2026-10-23

Related: ADR [0030](0030-agent-pr-review-gate.md) (Opus PR review gate), ADR
[0032](0032-review-follow-ups-send-fix-first-prs-back-once.md) (review follow-ups), ADR
[0035](0035-verified-fixes-merge-on-proof-not-on-a-verdict.md) (verified fixes, service merges), ADR
[0033](0033-ci-runners-are-visible-and-infra-failures-are-not-code-failures.md) (CI jobs), `_shared/merge-queue.ts`,
`merge-queue/worker.ts`, `api/routes/merge-queue.ts`.

## Context

On 2026-10-23, 79 cloud-agent PRs across 8 apps had an Opus "merge"
verdict. Merging them from the console's bulk "Merge N" merged 1 of 4 in
one app: the repos require branches to be up to date, so each merge left
the other PRs behind their base ("Required status check is expected"), and
two agent PRs that touched the same file conflicted. The console said
"3 could not merge (check CI / branch protection)" and named no PR. By
hand, each PR is update branch, wait for CI, merge, one at a time per
repo, and a conflict needs someone to merge the base into the branch.

GitHub's own merge queue needs an organization-owned repo with rulesets
configured for it and a `merge_group` trigger in every workflow; most of the
apps Mushi serves are personal repos with neither.

## Decision

- **"Merge when ready" is the default bulk merge** on `/fixes`. The person
  queues PRs (`POST /v1/admin/merge-queue`, console only, non-viewers);
  "Merge now" stays as the alternative and lists each PR that did not merge
  with GitHub's reason and a "Merge them when ready" button.
- **The `merge-queue` worker** (cron every 5 minutes, and right after a
  queue) works on one PR per repo at a time, so a repo has at most one
  queued PR in CI. For that PR (`_shared/merge-queue.ts`): a conflict →
  resolve; behind → GitHub "update branch"; GitHub still computing or CI
  running → wait; CI failed or branch protection → blocked; draft → mark
  ready; clean → merge.
- **It merges as a service caller through the review gate** (ADR 0030,
  0035): only with an Opus "merge" verdict on the exact head and pinned to
  that head. An updated branch has a new head, so the queue waits for the
  re-review of it (requested on the push; the queue asks again if none is
  queued). A hold or fix-first blocks the row; a person decides in the
  console. Then the same finalize as every merge (report Fixed, reporter
  told).
- **A conflict goes to a Cursor agent** on the PR's branch, with the
  organization's review follow-up key and model, only while follow-ups are
  on (ADR 0032), at most 2 runs per PR, given up after 90 minutes without a
  push. The prompt asks it to merge the base, keep both sides, run the
  checks and push, or to answer `Mushi verdict: needs_human` when the
  conflict needs a product decision. Its push is reviewed like any other.
- **Blocked rows say why** (`fix_merge_queue.detail`) and are looked at
  again on every tick, but only in a repo where nothing else is moving, so a
  re-check never puts a second PR into CI. A person can take a row out.

## Rejected

- **GitHub's merge queue.** Needs organization repos and `merge_group`
  workflows Mushi does not own.
- **Merging on the verdict of an older commit.** The update-branch commit
  only merges the base, but a conflict agent's commit is new code; one rule
  for both (re-review the head) is simpler than telling them apart.
- **Running every queued PR's CI at once.** Each merge makes the others
  stale again, and it breaks the one-PR-in-CI-per-repo agreement the CI
  runners rely on.
