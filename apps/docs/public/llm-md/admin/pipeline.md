# Pipeline

Source: https://kensaur.us/mushi-mushi/docs/admin/pipeline

---
title: Pipeline
description: The console Pipeline page shows every bug from report to deploy, where it is stuck and why, with one-click fixes.
---

# Pipeline

**Route:** `/pipeline`

Every bug moves from a report to a fix PR, an Opus review, CI, a release train, a merge and a deploy. This page shows how many items are in each step now, which are stuck, and why. **This app** follows the app you have open. **All apps** reads every project you can see.

## Stages

| Stage | What is in it |
| --- | --- |
| **Reported** | Reports not triaged yet. Stuck after an hour, or when triage failed. |
| **Triaged** | Triaged reports with no fix started. Stuck after 3 days. |
| **Fix PR** | Agents writing a fix, agents that failed without a PR, and drafts whose CI never ran. |
| **Reviewed** | PRs waiting for the Opus review, and PRs Opus held or sent back ("fix first"). |
| **CI** | PRs whose own CI is red, never ran, is still running, or stopped on the test machine. |
| **Release train** | Approved, green PRs in the merge queue, on a train, held, or waiting on a conflict agent. |
| **Merged** | Fixes merged in the last 7 days. |
| **Deployed** | Merged fixes that a deploy recorded after the merge. |

Each stage shows its count, how many are stuck, and how long the oldest item has been in it. The time is counted from when the item entered the stage, not from the last time a worker touched it. Click a stage to see only its groups.

A PR whose own CI is red counts under **CI**, even when it is in the merge queue. A red PR in a release train only makes the train fail. A test machine stop is not a code failure, and a skipped check is not a pass.

## Stuck groups

Each group says its reason in plain words, for example "12 PRs: their own CI is red". Open it to see each PR with its report, how long it has waited, the failing checks, the Opus verdict and its findings, and the merge queue's last message. When a setting holds the group (review follow-ups off), the group links to it.

| Action | What it does |
| --- | --- |
| **Send to CI repair** | Queues one CI-repair agent per PR, under the review follow-up limits. Says why when it cannot. |
| **Re-run CI** | Re-runs the failed CI jobs on the PR's latest commit. |
| **Re-run review** | Asks Opus to review the PR again. |
| **Update branch** | GitHub merges the base branch into the PR. |
| **New conflict agent** | Hands a conflicted PR back to the merge queue, at most 2 agents per PR. |
| **Mark ready** | Takes a draft out of draft so CI runs. |
| **Queue to merge** | Puts an approved, green PR in the merge queue. |
| **Remove from queue** / **Close PR** | Takes it out of the queue, or closes it without merging. The reason is kept as a team note on the report. |

Every action asks first, works on one PR or the whole group, shows each PR's result, and then the page reads again.

## Release trains

One row per repository with the trains of the last 7 days: green merged, red failed, blue on the way. Click a square for that train's detail. The checks that failed the trains most often are listed under the row. **Run merge queue now** checks the queue at once and says whether a train left, and if not, when the next one may leave or why it waits.

## Intake and deploys

Reports rejected at intake read **not recorded yet** until rejections are logged; it is never shown as 0. Each app shows its last recorded deploy.
