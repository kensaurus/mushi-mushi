# 0019. SDK upgrade PRs get their lockfile from a host-side workflow

Status: Accepted (owner, 2026-10-03)            Date: 2026-10-03

Related: [0016](0016-mushi-as-the-app-recipe-control-plane.md) (least-privilege
GitHub App permissions; changes reach a host only as reviewed PRs).

## Context

`sdk-upgrade-worker` (a Deno edge function) opens **Create Upgrade PR** by
editing the `@mushi-mushi/*` version strings in each `package.json`. It never
touches the lockfile. On 2026-10-03 all six dogfood upgrade PRs failed their
host CI on lockfile drift: `npm ci` and `pnpm install --frozen-lockfile` reject
a manifest that no longer matches the lockfile, so every PR waited for a human
to run the package manager and push.

Two facts shape the fix:

- A push made with the GitHub App's installation token **does** trigger
  workflows in the host repo. Only pushes made with a workflow's own
  `GITHUB_TOKEN` are suppressed.
- Renovate and Dependabot both regenerate lockfiles by running the package
  manager CLI, not by editing the file.

## Decision

1. **The host owns one small workflow**, `.github/workflows/mushi-sdk-lockfile.yml`
   (template: `docs/templates/mushi-sdk-lockfile.yml`; docs page
   `apps/docs/content/admin/sdk-upgrade-lockfile.mdx`). It runs on pushes to
   `mushi/sdk-upgrade-**`, with `contents: write`, a 10-minute timeout,
   per-branch `cancel-in-progress`, and `if: github.actor != 'github-actions[bot]'`.
2. **The work is a public composite action**,
   `kensaurus/mushi-mushi/.github/actions/sdk-lockfile-refresh@master`: shell
   only, no dependencies. It finds the lockfile governing each `package.json`
   changed in the tip commit, picks the package manager from `packageManager`
   or the lockfile present, runs the lockfile-only install with
   `--ignore-scripts`, and commits and pushes with `GITHUB_TOKEN` only when the
   lockfile changed.
3. **Mushi detects the workflow and waits for it.** The runner reads the
   workflow file through the Contents API on the default branch. When it is
   there, the runner pushes the bump as one Git Data API commit (one push, so
   the action sees every changed manifest), sets the job to
   `status = 'awaiting_lockfile'` and does not open the PR. `sdk-release-sync`
   (every 5 minutes) opens the PR once a lockfile commit sits above the bump,
   or after 30 minutes with a "lockfile not refreshed" note, and moves the job
   to `completed` / `release_status = 'pr_opened'`. The PR opens after the
   lockfile commit, so the host's CI runs on the refreshed lockfile.
4. **Without the workflow, nothing changes** except one line in the PR body
   linking the docs.
5. `awaiting_lockfile` holds the project's one-upgrade-at-a-time slot. A job
   that cannot reach GitHub fails after the same 30 minutes, and one whose PR
   will not open fails after 60, so the slot never wedges.

## Rejected alternatives

- **Hand-edit the lockfile in the edge function.** Lockfiles are the package
  manager's output, not a format to patch: pnpm v9 keys carry peer-dependency
  suffixes that change with the resolved tree, and Dependabot's maintainers
  say the same about editing them by hand. A wrong edit fails later and less
  clearly than a missing one.
- **Run npm or pnpm inside Mushi.** The workers are Deno edge functions; they
  cannot spawn the package manager, and a separate build sandbox for this one
  step costs far more than a host workflow.
- **Have Mushi write the workflow into the host.** Creating or updating files
  under `.github/workflows` needs the GitHub App's `workflows` permission.
  ADR 0016 keeps the App least-privilege (`Contents` and `Pull requests`
  only), and a bot that can write CI can run code with the repo's secrets.
  The host adds the file once; Mushi only reads it.

## Consequences

- Hosts with the workflow get upgrade PRs that pass a frozen install. The PR
  appears up to about 5 minutes after the lockfile commit (the
  `sdk-release-sync` cadence), and at most 30 to 35 minutes after the bump.
- Migration `20261003193000_sdk_upgrade_awaiting_lockfile.sql` widens the
  `sdk_upgrade_jobs` status CHECK. It must be applied before the `api`,
  `sdk-upgrade-worker` and `sdk-release-sync` functions that write the value.
- `sdk-release-sync` was documented as a 5-minute cron but was never
  scheduled (no migration, no `cron.job` row on production on 2026-10-03).
  Migration `20261003193100_sdk_release_sync_cron.sql` schedules it; this
  decision depends on it. It also starts the CI/deploy chip sync for open
  upgrade PRs that the cron was always meant to run.
- The console shows **Refreshing lockfile…** for the parked job and offers the
  workflow as a copy block; the copy, the template and the docs page are kept
  identical by `apps/admin/src/lib/sdkLockfileHelper.test.ts`.
- **Known limit:** refreshing an already-open upgrade PR pushes to its branch;
  the workflow refreshes the lockfile, but GitHub starts no CI for a
  `GITHUB_TOKEN` push, so the PR's checks need one manual re-run.
- Yarn support in the action is untested until a yarn host exists.
- The action is referenced at `@master`; this repo has no action release tags,
  so hosts that want a fixed version pin a commit SHA.
