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
| **Reported** | Reports not triaged yet (stuck after an hour, or when triage failed), and reports the API refused at intake. |
| **Triaged** | Triaged reports with no fix started. Stuck after 3 days. |
| **Fix PR** | Apps whose auto-fix cannot dispatch, agents writing a fix, agents that failed without a PR, and drafts whose CI never ran. |
| **Reviewed** | PRs waiting for the Opus review, and PRs Opus held or sent back ("fix first"). |
| **CI** | PRs whose own CI is red, never ran, is still running, or stopped on the test machine. |
| **Release train** | Approved, green PRs in the merge queue, on a train, held, or waiting on a conflict agent. |
| **Merged** | Fixes merged in the last 7 days. |
| **Deployed** | Merged fixes that a deploy recorded after the merge. |

Each stage shows its count, how many are stuck, and how long the oldest item has been in it. The time is counted from when the item entered the stage, not from the last time a worker touched it. Click a stage to see only its groups.

A PR whose own CI is red counts under **CI**, even when it is in the merge queue. A red PR in a release train only makes the train fail. A test machine stop is not a code failure, and a skipped check is not a pass.

## Who opens fixes

One row per app: who opened fixes in the last 7 days (the server, your local `mushi work` lanes, both, or nobody), the server's agent keys, dispatches in 24 hours and last dispatch, and the local lanes' runs, how many are running and the last run. The **Fix PR** stage counts apps by who opened a fix in the last 24 hours.

The server opens fixes on its own only through spend-down, with an active Cursor key that has spend-down on. When an app has auto-fix on but no such key, or its key dispatched nothing in 48 hours, the app is red here and in a stuck group in **Fix PR** that links to the switch on the Spend credits page.

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

Each app shows the reports the API refused (HTTP 400) in the last 7 days, with the first failing field and its check (`fingerprintHash:invalid_string`) and the SDK package that sent them. They also form a red group in **Reported**. An app with none reads **0 rejected since** the day counting began; before anything was ever counted it reads **not recorded yet**, never 0. Each app also shows its last recorded deploy.
