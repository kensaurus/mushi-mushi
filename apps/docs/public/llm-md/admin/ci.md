# CI runners

Source: https://kensaur.us/mushi-mushi/docs/admin/ci

---
title: CI runners
description: The console CI runners page shows where tests run, how long they wait for a machine, and whether a red check was your code or the test machine.
---

# CI runners

**Route:** `/ci`

Every fix Mushi opens is tested by your CI before it can merge. This page shows the machines that run those tests, the jobs waiting for one, and why a fix takes as long as it does to land. **This app** follows the app you have open. **All apps** reads every project you can see.

The page reloads every 30 seconds while the tab is visible, and **Refresh** does the same. Each reload asks GitHub for queued and running jobs. The server does that live read at most once a minute per app.

A collector also runs every 10 minutes. It reads GitHub Actions runs updated in the last 2 hours, on every branch of each app's repositories, classifies each job, and deletes job rows and samples older than 30 days.

## Test machine or your code

A lost runner, a job still waiting for a runner, and a queue that expired are the test machine. They are never a code failure. The page labels them **Test machine stopped**. **Tests failed** means a step failed while a machine was running your code.

Re-run a job the test machine stopped. Open the fix for a job whose tests failed. The line at the top says what needs you: a job has been waiting a long time for a machine, most failures are the test machine, some jobs failed on the code, or every finished job passed.

## Queue and wait

**Queue** is every job, from waiting for a machine to finished.

| Column | Meaning |
| --- | --- |
| **Waiting** | Waiting for a free test machine. A long column means too few machines. |
| **Running** | On a test machine now. |
| **Finished** | Finished in the last 2 hours. Filter to **Tests failed**, **Test machine stopped**, or **Passed**. |

Above the queue: how many are waiting now, how many are running, the typical wait for a machine, and the typical run time. The wait also names the slow tail, the 1 job in 20 that waits longer. A bar splits the jobs from the last 7 days into passed, tests failed, test machine stopped, and cancelled, skipped or still going.

**Timeline** is one row per test machine. Gaps are idle time. Striped bars are jobs waiting for a machine.

## Runner map

**Runner map** is your machines, the runners on them, the repositories they serve, and the jobs waiting or running now. Click a card for its health and recent jobs.

Runners that live for a single job, named as a label plus a number of seconds, are folded into that label. With **Administration: read** on the GitHub token, Mushi reads the repository runner list, including idle and offline runners. Without it, the page says it only sees runners through jobs. Without **Actions: read**, it cannot see the jobs at all.

## What would make fixes land sooner

**Speed it up** lists changes that would land your fixes sooner, each with the evidence and a copy-ready fix.

**Slow jobs** is the jobs and steps that take the longest.

**Stopped by the test machine** lists jobs that never finished testing. Re-run them.

## Your real bill

The rest of the cost section estimates money from job times. **Your real bill**, at the top of it, shows what GitHub actually charged, read from GitHub's billing:

- this month's net charge so far, in large type;
- the gross price beside it, because public repos and your plan's included minutes are free and show up as a discount;
- the net per repository over the last 30 days, and the net per day;
- the change against the 30 days before, shown only when Mushi holds the whole earlier period;
- how much of your paid GitHub-hosted minutes ran on Mushi's own agent branches. This share is estimated from the jobs Mushi recorded.

Mushi reads the bill once a day for each GitHub account or organization your repositories belong to. It uses only the GitHub token saved in the project's settings, never the GitHub App. The token needs billing access:

| Account | Fine-grained token permission |
| --- | --- |
| Personal account | **Plan: read** |
| Organization | **Administration: read** (owners and billing managers) |

If the token can't read the bill, the card says so and shows how to connect one. Instead of a token, you can upload the bill from a machine where `gh` is signed in as the paying account:

```bash
mushi runner bill --push
```

`mushi runner bill` without `--push` prints the same bill in the terminal. Your token stays on your machine.

### Cost advice that reads your workflows

Each item of **Cost advice** gives its evidence and a saving per month. The saving is the billed minutes Mushi recorded over the window, at GitHub's list price. It is zero for public repos and self-hosted runners, which GitHub doesn't charge for. An item marked **one-click fix** can open a pull request that makes the change.

| Advice | When it appears | One-click fix |
| --- | --- | --- |
| Scheduled workflow runs too often | A `schedule` runs more often than weekly, and its runs billed minutes | Yes: weekly |
| Documentation-only pull requests run CI | A pull request workflow has no `paths` or `paths-ignore` filter, and pull requests that changed only docs ran it | Yes: ignore docs paths |
| Checks run again after the merge | Jobs that ran on the pull request ran again on the push to `main` | No: use a merge queue or release trains |
| The same check runs twice | Two jobs on the same event run the same command | No |
| Every package builds on each pull request | A turbo or nx monorepo runs all tasks on pull requests, without `--affected` or `--filter` | No. The minutes at stake are shown, but not priced. |
| Pull requests nobody merged | Minutes billed to pull requests closed without merging | No |
| macOS on pull requests | GitHub-hosted macOS jobs on pull requests, at about ten times the Linux price | No |
| Old runs keep going | A push or pull request workflow doesn't cancel the run it replaces | Yes, when it has no concurrency group yet |
| Draft pull requests run the full CI | A pull request workflow doesn't skip drafts | Yes: skip drafts |

Advice that needs data Mushi doesn't have yet stays hidden. It never guesses.
## Fix it in one PR

Some advice is one edit to one workflow file. Those cards have an **Open fix PR** button for each workflow they found:

| Fix | What changes in the workflow |
| --- | --- |
| Cancel superseded runs | A `concurrency` group. A new push to a pull request cancels the run it replaces. Pushes, manual and scheduled runs always finish. Mushi refuses on a workflow that deploys or releases. |
| Skip drafts | `ready_for_review` is added to the `pull_request` types, and every job skips draft pull requests. A job whose check your branch requires keeps running and fails at a first step named "Draft PRs run no CI": a skipped required check reads as passing, and a draft must never merge untested. |
| Run the schedule weekly | A schedule that runs more than once a week runs once a week, at the same hour. Mushi refuses on a workflow that deploys or releases, because some daily schedules roll out releases on purpose. |
| Skip docs-only changes | `paths-ignore` for Markdown files, `docs/`, the license and issue templates on `pull_request` and `push`. Mushi refuses when the workflow produces a required check, or a job looks like one: a skipped workflow never reports, so the pull request could not merge. It also refuses when a trigger already lists `paths`. |

Mushi reads which checks your default branch requires (branch protection and rulesets). When it cannot, it refuses the draft and docs fixes rather than guess.

Mushi asks you to confirm first. It then edits only that file, keeps your comments, and opens a **draft** pull request titled `ci: …`. Nothing changes until you review it, mark it ready and merge it. The card shows the job's progress and the link. If the workflow already has the fix, it says so and opens nothing.

After the merge, the card shows the saving Mushi measured. That is the workflow's billed minutes per day after the merge, against the 14 days before. Like every number on this page, it is estimated from job times.

Writing a workflow file needs the GitHub App's **Workflows: Read and write** permission, or a token with the `workflow` scope. Without it, the card says so. You can still copy the fix and commit it yourself.

From the terminal, run `mushi runner fix --repo <owner/repo> --workflow .github/workflows/ci.yml --kind skip_drafts`, and follow it with `mushi runner fix-status`. In your editor, use the MCP tool `open_ci_cost_fix`.

## When nothing has reported in

The page stays empty until GitHub reports a job for this app's repositories, or a machine that runs your tests reports in. On that machine, run:

```bash
mushi runner key
mushi runner hooks install --dir <runner dir>
```

Host health arrives through `mushi runner heartbeat` and the job hooks, as `POST /v1/ingest/runner` with a `runner:write` key only. The setup steps are in [CI runners](/operating/ci-runners).

## Related pages

- [Checks](/admin/checks) — CI runners as one of the automatic checks
- [Fixes](/admin/fixes) — the pull request a job was testing
