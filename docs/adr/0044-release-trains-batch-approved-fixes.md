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

## Amendment 2026-10-26: only a PR whose own CI is green rides

Status: Proposed (owner to accept)

In the five days to 2026-10-26, few fixes merged: glot.it had 179 red
trains, mushi-mushi 58, the-wanting-mind 37 and yen-yen 27. On glot.it, 37 of 40 queued PRs failed CI on their own heads.
Every train was bisected 8 → 4 → 2 → 1. The member that then failed alone
was held as `blocked`. But the train tick reads blocked rows too, so the
held member rode the next train, and the cycle started again. The red-base
check did not help either. glot.it's `gate` aggregator fails whenever a job
it needs fails, but it is skipped on main. So main's red npm audit was
blamed on the members.

- **Who rides** (narrows Decision): every rule above still applies. On top
  of them, the PR is not a draft and CI on its own head is green: nothing
  pending, nothing failed. A repo with no checks at all counts as green.
  A head with no runs, while the base branch has some, waits.
  - A PR that fails on its own code is held, with the failing checks named.
    The CI-repair follow-up (ADR 0032) picks it up. Once both rounds are
    used, the row says a person must fix it.
  - A PR whose failures are all the base branch's is not blamed. It waits
    for the base to pass. A failure counts as the base's when the same
    check fails on the base, or when it did not run there (an aggregator).
- **Drafts:** an approved draft is marked ready so its CI runs. Only one
  draft per repo per tick is marked, because each one starts a CI run.
- **No cycling:** a member does not ride again at the same head if it
  failed alone in a red train at that head, or if it rode 5 red trains at
  it within 7 days. One bisection of a full train puts an innocent member
  in at most 4 red trains. Both rules are read back from
  `release_trains.members`, and a new commit clears them. Trains that
  failed on a red base are not counted.
- **Conflicts:** a train app's `resolving` rows are worked on every tick,
  not only when the repo is otherwise idle. Before this, they were never
  worked on, because the train tick held the repo on every tick. At most 2
  conflict agents run per repo at a time. The rest show how many are ahead.
