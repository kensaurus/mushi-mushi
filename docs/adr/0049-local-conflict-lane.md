# 0049. Local conflict lane: a worker on the owner's machine resolves merge-queue conflicts

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit delegation. Date: 2026-10-27

Amends ADR [0032](0032-review-follow-ups-send-fix-first-prs-back-once.md)
(who may push to an agent PR's branch) and works under ADR
[0041](0041-merge-when-ready-queue.md)'s cap of 2 conflict agents per PR.

Related: ADR [0048](0048-local-workers.md) (local workers, the lease, pull-only
control), ADR [0044](0044-release-trains-batch-approved-fixes.md) (release
trains mark conflicted members `resolving`), ADR
[0030](0030-agent-pr-review-gate.md) (the Opus review of every new head),
`_shared/work-modes.ts`, `_shared/work-conflicts.ts`, `api/routes/work.ts`,
`merge-queue/worker.ts`, `packages/cli/src/worker/conflicts.ts`, migration
`20261027180000_worker_modes.sql`.

## Context

The merge queue sends a conflicted PR to a Cursor cloud agent, which needs
the organization's review follow-up key and model (ADR 0041). Without them
the row stays blocked with "Merge conflict. …". On 2026-10-26 fourteen
glot.it rows waited that way. A shell loop on the owner's WSL machine
(`conflict-loop.sh`) did the job instead for a day. It merged the default
branch into each conflicting fix PR in a scratch worktree, let a local Cursor
agent resolve only the conflicted files, refused when markers remained,
committed with hooks and pushed a plain merge commit. But it found PRs by
branch name, not by the queue. It did not count against the cap of 2. The
console could not see it. And it pushed whatever head it found.

## Decision

- **A lane mode `conflicts`** (`work_lanes.mode`, closed set, ADR 0048). The
  daemon reports each lane's clone as `owner/name` from its origin remote
  (a value, never a path). Such a lane claims only queue rows of that
  repository.
- **What it may claim:** a `fix_merge_queue` row of its app that waits for
  a conflict agent. Either the train marked it `resolving` and no agent took
  it, or it is `blocked` with a "Merge conflict" detail. Never:
  - a row a cloud agent or another lane holds;
  - a row at the cap: 2 conflict agents per PR, cloud and local together,
    in `conflict_agents`;
  - a row with no recorded head;
  - a row a merge-queue tick is checking;
  - a revert PR;
  - a row a local lane tried less than an hour ago.
- **The claim** is a `work_claims` row (`kind = 'conflict'`,
  `merge_queue_id`, one active per row). It takes the queue row with one
  compare-and-set on `conflict_agents`, the head, no agent and no local
  claim, and no tick holding it. That sets `local_claim_id` and counts the
  attempt. A merge-queue tick's own row lease compares `local_claim_id`
  too, so a cloud agent never starts on a row a lane holds.
- **On the machine** (`worker/conflicts.ts`):
  1. The clone's origin must be the repository. The PR must be open, not
     from a fork, on the recorded branch, and at the head Mushi saw.
  2. Merge the base into that head in a worktree of Mushi's cache,
     `--no-commit`. A clean merge needs no agent.
  3. The agent (credentials stripped, no remote it can reach) may edit only
     the files git stopped on.
  4. Refused when:
     - a conflict marker remains;
     - any other file changed, in the index or the worktree; files the
       install or the merge left loose before the agent ran do not count;
     - the merge is no longer in progress;
     - HEAD moved.
  5. Commit with the hooks. Check that the commit is a two-parent merge of
     exactly the head and the base. Read the remote branch right before a
     fast-forward-only push.
- **After the run** (`POST /v1/worker/claims/:id/done`):
  - A push moves the row to `waiting` with the new head, records a merge
    queue event and re-queues the Opus review of the new head. The push
    webhook does too; whichever comes first wins.
  - Anything else leaves the row `blocked` with a "Merge conflict: …"
    detail, so a later agent may take it.
  - The machine never counts against the PR (ADR 0048). An infra failure,
    a skip, a stop or a lost lease gives the cap slot back. An agent that
    ran and failed the checks keeps it.
  - A row that was removed or merged meanwhile stays where it is.
- **ADR 0032 amendment:** a local worker's conflict lane may push a merge
  commit to an agent PR's branch: the base merged in, only conflicted files
  changed. The push uses the machine's own git and `gh`, never a Mushi
  credential, as ADR 0032's local follow-ups do.

## Consequences

- An app without a Cursor key or follow-ups can still have its conflicts
  resolved, by the owner's machine and credits, with the same cap and the
  same review of the new head.
- The Workers tab shows conflict runs as "Merge conflict on owner/repo#n";
  `counts7d.merges` counts pushed merges.
- An older daemon refuses the `conflicts` mode and leaves the lane idle, and
  one that sends no `repo` is told to update. The CLI ships before the mode
  is used.

## Rejected

- **Pushing to a branch the lane did not claim, or found by name**
  (`conflict-loop.sh`). It did not count against the cap and raced the
  cloud agent.
- **A rebase or a force push.** It rewrites the reviewed history; a merge
  commit keeps every reviewed commit and is re-reviewed as a new head.
- **Letting the agent commit or touch any file.** A conflict agent that also
  "fixes" something else ships an unreviewed change inside a merge commit;
  the worker refuses the whole result instead.
