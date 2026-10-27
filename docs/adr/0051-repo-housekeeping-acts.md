# 0051. Repo clean-up: Mushi deletes only branches it made and closes only its own fix PRs, item by item, through an approved list

Status: Accepted 2026-10-27 by team-lead (Claude) under the owner's explicit delegation. Date: 2026-10-27

Amends: ADR [0037](0037-ci-placement-cost-and-repo-variable-writes.md) (the
only GitHub writes a connector action could make were two runner variables;
this adds four repo clean-up acts on the same request → approve → execute
path).

Related: ADR [0017](0017-strike-the-plan-019-020-sequencing-gate.md) (nothing runs without
a person), ADR [0027](0027-console-nav-follows-the-vibe-coding-cycle.md) (no new top-level
section), ADR [0030](0030-agent-pr-review-gate.md) (the Opus review whose
"hold" makes a PR a candidate), ADR [0044](0044-release-trains-batch-approved-fixes.md)
(train members are never closed), ADR [0048](0048-local-workers.md)
(`prune_own`), `_shared/repo-housekeeping.ts` (rules),
`_shared/repo-housekeeping-run.ts` (executor),
`_shared/repo-housekeeping-github.ts`, `_shared/fix-close.ts`,
`api/routes/repo-housekeeping.ts`, migration
`20261027183000_repo_housekeeping_items.sql`, console ops plan 2026-10-27 §2.5
and P4.

## Context

On 2026-10-27 the owner deleted 1,037 merged or closed PR branches across
seven app repos and 279 in mushi-mushi by hand, turned on GitHub's
"Automatically delete head branches" in eight repos and closed superseded
agent PRs, with shell scripts that picked branches by name. Almost all of
those branches and PRs were Mushi's own: fix attempts, release trains, UX
runs, SDK upgrades and CI cost fixes. The owner asked that this be done from
the console, simply and repeatably.

Deleting a branch is the most dangerous write Mushi would make to a repo: a
branch that still had unmerged work, that an open PR uses as its head or base,
or that someone pushed to a second ago, is lost or closes other work.

## Decision

1. **Only what Mushi recorded.** A branch is a candidate only when a Mushi row
   recorded it (`fix_attempts.branch`/`branch_name`, `release_trains.branch`,
   `ux_runs.branch`, `sdk_upgrade_jobs.branch`, `ci_cost_fix_jobs.branch`),
   never because of its name. Its recorded pull request (same repo, same head
   branch, forks excluded) is merged or closed, and the branch still points at
   that PR's last commit. A PR is a candidate only when it is an open PR of a
   Mushi fix attempt and it is superseded (a newer attempt for the same report
   has an open or merged PR), held (the latest Opus review said hold about its
   current head) or stale (no new commit for 7–90 days, default 14; the commit
   date, not the push date). Never a PR riding a release train, never anything
   a running Mushi row may still push to.
2. **Four acts, one path.** `delete_branches`, `close_prs`,
   `restore_branches` and `set_delete_branch_on_merge` are legacy-backed
   GitHub `connector_actions`, like the runner variables. The server builds
   the list from a fresh preview (never from the client), each item with its
   reason and commit; the request stores that list and its hash; an owner or
   admin approves it in a console session (hash-matched, one hour, single
   use); execution runs once. An API key, the CLI and MCP can read and ask,
   never approve or run.
3. **Every item is checked again when it runs**, on fresh GitHub reads, and is
   refused when it is the default branch, a protected branch, the head or the
   base of any open PR (deleting a base closes that PR), has a running Mushi
   row, or no longer points at the approved commit. A PR is refused when its
   head moved, it merged or closed, or it rides a train.
4. **The delete is checked by GitHub where it can be.** Mushi deletes with
   GraphQL `updateRefs` and `beforeOid` = the approved commit, so GitHub
   refuses a branch that moved. Where that mutation is unavailable to the
   token, Mushi reads the branch again just before a REST `DELETE` and records
   `method = 'reread'`; the console states the race that remains (a push in
   that second is lost; Restore brings back the approved commit).
5. **Restore is part of delete.** Before deleting, Mushi writes the branch and
   its commit to `repo_housekeeping_items` (RLS on, service role only); if it
   cannot, it does not delete. Restore recreates the branch at that commit,
   through its own approval, and never overwrites a branch that exists again.
6. **Closing a fix PR is the pipeline close.** `close_prs` runs the same
   helper as /pipeline's `close` (`_shared/fix-close.ts`): GitHub closes the
   PR, the merge queue drops it, the fix records "closed unmerged", and the
   reason becomes a team note on the report.
7. **The one repo setting.** Mushi may turn on "Automatically delete head
   branches" (`delete_branch_on_merge`), never off, when the token can.
8. **Caps.** ≤ 50 items per action; ≤ 5 clean-ups an hour per app, counted
   when asked (an atomic claim) and when run (checked before the approval is
   used); restores are not counted. Each item writes one audit entry naming the
   person who ran it. The preview and the run stop under a GitHub API floor
   (300 calls left).
9. **The project's stored token, not the App.** Clean-up uses the project's
   (or its organization's) stored GitHub token, as ADR 0037's legacy path does;
   never the GitHub App installation or the platform token. It needs Contents
   and Pull requests read and write; the setting needs Administration write.
10. **Where it runs.** The routes live in `api-ext` (`api` is at the 5 MB
    deploy limit) under `/v1/admin/projects/:id/repo-cleanup`, with their own
    approve, reject and execute routes that call the shared connector-action
    approve and execute with the executor injected. The org-wide
    connector-action routes in `api` neither list, request nor run clean-ups
    (they answer `USE_REPO_CLEANUP` before claiming the approval), so the
    executor stays out of `api`. The console shows it as a "Clean up" tab on
    /repo, which is itself the opt-in "Pull requests" Lab (the Advanced mode
    the plan named was removed on 2026-10-20). `mushi repo cleanup
    show|request|restore` is the CLI.

## Consequences

- Branches people made by hand are never touched, even when merged; the
  owner's one-off scripts stay the tool for those, or GitHub's own setting
  from now on.
- A fine-grained token without Contents write sees the list and a plain
  refusal at run time; one without Administration write cannot turn the
  setting on, and the console says so before asking.
- The local worker's `prune_own` setting (ADR 0048) still only covers the
  worker's own clones and worktrees; the daemon does not act on it yet
  (BACKLOG BL-138).

## Rejected

- **Choosing branches by name** (`mushi/*`, `cursor/*`): the scripts did, and a
  person's branch named like an agent's would go too.
- **Approve and execute on the org connector-action routes**: they run in
  `api`, which would carry the executor over its deploy limit, and their list
  cannot show the per-item results and Restore.
- **Deleting without a recorded commit, or REST `DELETE` alone**: GitHub's
  REST delete cannot be told which commit the branch must still point at.
- **Turning settings off, or any other repo setting** (branch protection,
  merge methods): not housekeeping, and not undoable the same way.
- **Closing PRs Mushi did not open, or train PRs**: they have no report for the
  reason, and a train closes its members itself (ADR 0044).
