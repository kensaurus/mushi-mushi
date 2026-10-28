# Pipeline

Source: https://kensaur.us/mushi-mushi/docs/admin/pipeline

---
title: Pipeline
description: The console Pipeline page shows every bug from report to deploy, where it is stuck and why, with one-click fixes.
---

# Pipeline

**Route:** `/pipeline` (sidebar: Pipeline, under Fixes)

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

Local lanes are read from the workers you registered (see [Workers](#workers) below), not guessed from past runs. An app with auto-fix on and no agent key is not red while one of its lanes is online and taking new reports.

## Stuck groups

Each group says its reason in plain words, for example "12 PRs: their own CI is red". Open it to see each PR with its report, how long it has waited, the failing checks, the Opus verdict and its findings, and the merge queue's last message. When a setting holds the group (review follow-ups off), the group links to it.

| Action | What it does |
| --- | --- |
| **Send to CI repair** | Sends the PR to an agent that makes its CI green without weakening tests: Mushi's cloud agent when review follow-ups can run (they need a Cursor key on your team), otherwise your local `mushi work --followups` lanes on their next run. Says why when neither can. |
| **Send to follow-up** | The same for an Opus "fix first": an agent fixes the review's findings on the PR's branch. |
| **Re-run CI** | Re-runs the failed CI jobs on the PR's latest commit. |
| **Re-run review** | Asks Opus to review the PR again. |
| **Update branch** | GitHub merges the base branch into the PR. |
| **New conflict agent** | Hands a conflicted PR back to the merge queue, at most 2 agents per PR. Conflict agents are cloud agents: without one, the PR needs a person to resolve the conflict on GitHub, and the page says so with the PR link. |
| **Mark ready** | Takes a draft out of draft so CI runs. |
| **Queue to merge** | Puts an approved, green PR in the merge queue. |
| **Remove from queue** / **Close PR** | Takes it out of the queue, or closes it without merging. The reason is kept as a team note on the report. |
| **Requeue** | Puts a report back at the front of the local lane that ran it, when that lane's machine stopped the run (not the code). Mushi does this once on its own; after that the report waits here for you. It never counts against the report. |

Every action asks first, works on one PR or the whole group, shows each PR's result, and then the page reads again.

## Release trains

One row per repository with the trains of the last 7 days: green merged, red failed, blue on the way. Click a square for that train's detail. The checks that failed the trains most often are listed under the row. **Run merge queue now** checks the queue at once and says whether a train left, and if not, when the next one may leave or why it waits.

## Intake and deploys

Each app shows the reports the API refused (HTTP 400) in the last 7 days, with the first failing field and its check (`fingerprintHash:invalid_string`) and the SDK package that sent them. They also form a red group in **Reported**. An app with none reads **0 rejected since** the day counting began; before anything was ever counted it reads **not recorded yet**, never 0. Each app also shows its last recorded deploy.

## Workers

The **Workers** tab shows your local workers: machines that run `mushi work --daemon` and fix reports with a coding agent on that machine. It replaces `lanectl status` and the queue text files. Set one up with [`mushi worker install`](/sdks/cli#mushi-worker).

| Part | What it shows |
| --- | --- |
| **Machines** | Each registered machine: online or offline, its last heartbeat, what it is doing now (working, idle, waiting for memory, for the GitHub quota, for the Cursor sign-in, or for a free agent space), its load, the Cursor account check and the `gh` sign-in as they last answered, which lane holds each agent space and in which stage, and its guards: how many agents may run at once, the free-memory floor and the GitHub API floor. The machine's owner changes the guards or revokes it. |
| **Lanes** | One app on one machine: its model, mode, how many it runs at once, paused or not, its stop date, and drain (finish what runs, take nothing new). An audit lane also has a second model that may only veto a finding. |
| **Queue** | Reports the lane takes first, in order. Move a report up or down, remove it, or paste report ids (one or many) into **Add reports by id**. A report already being fixed somewhere else waits in the queue until it is free. |
| **Recent runs** | The last 7 days: runs, PRs opened, no change, timeouts, errors, and failures of the machine (infra) kept apart from failures of the code. |

A lane's **mode** says what it does:

| Mode | What the lane does |
| --- | --- |
| Fix reports and follow-ups | Its queue first, then the worst open reports; a draft PR for each |
| Review follow-ups only | Fixes what Opus asked for on PRs a local agent opened |
| Resolve merge conflicts | Merges the base branch into this repository's PRs that wait in the merge queue for a conflict agent. The agent may change only the conflicted files; anything else is refused. It counts toward the 2 conflict agents a PR may have, cloud and local together |
| Audit the code, screen by screen | A model proposes bugs; the machine files only those its own check reproduces, at most 12 an hour per app, into a fix lane for the same app on that machine |
| Run skill runs | Only the rounds of skill runs started on Spend credits with **Run on** set to this lane |

A lane change reaches the machine at its next heartbeat, within a minute. The machine opens no port: it asks Mushi for its settings, and the settings are values (a model id, a number, a date), never a command or a path. Viewers can read this tab but cannot change it.

### When a worker stops doing useful work

Anything that stops a worker from fixing bugs is listed at the top of the tab, worst first, and never folded away. An **agent space** is one coding agent running at a time; each machine allows a set number at once (**Agents at once** in its limits). When every space is taken, other lanes wait.

| Problem | What you see | What fixes it |
| --- | --- | --- |
| Machine offline | No heartbeat for 3 minutes; how long, and how many queued reports wait | The command that shows the worker's service and its last log lines on that machine |
| Stuck run | A run has held an agent space for over 45 minutes: its stage (getting the repo ready, the coding agent, the repo's **commit hook**, its **pre-push hook**, opening the PR), how long it has been in that stage, and its last few log lines | **Stop this run**, open the report, or the command that finds it on the machine |
| Waiting for an agent space | Lanes waited over 15 minutes, with the runs that hold the spaces and in which stage | Stop the stuck runs, or let the machine run more at once |
| Cursor account | The account check said another account, signed out, not installed, or did not answer in time (with the load on the machine) | **Switch account** (the machine's owner signs it in as the right account from the console: it finishes its runs, then shows a Cursor sign-in link), **Re-check the account**, or the command to sign in on the machine |
| GitHub sign-in | `gh` is not signed in on the machine, so no branch can be pushed | `gh auth login` on the machine |
| Machine waiting | Low memory, the GitHub API quota or a sign-in has held the machine for over 5 minutes | The command that shows what uses the memory or the quota |
| Machine overloaded | Load of 2 or more per core: checks and git hooks time out | The command that lists what runs there |
| Git hooks failing | Two or more runs of a lane failed in the repo's own commit or pre-push check in 24 hours | **Pause this lane**, open the latest report or PR |
| Run outside the worker | A `mushi work` run that no worker claims has run for over 45 minutes: a script started it, so its stage cannot be seen or stopped here | Move that machine to `mushi worker install` |
| Credits idle | No agent has worked for 2 hours while Cursor credits expire within 7 days, with what blocks the work | Open Workers, or Spend credits |

The same problems show above the Pipeline tabs, as a count on the **Pipeline** item in the sidebar, in **Needs you** on Home (for that app), as "credits idle" on [Spend credits](/admin/credits), in `mushi worker status` and in the MCP tool `get_worker_status`.

**Stop this run** (the app's owner or an admin, or the machine's owner; asks first, and is recorded in the audit log) ends the run's claim at once, so the report is free again: the next lane or a cloud agent can take it (it is not put back in a queue). The machine stops the agent at its next heartbeat, within a minute, and commits or pushes nothing more. A git hook that is already running keeps its agent space until git's own time limit (25 minutes); the flag stays up as "a run that was stopped still holds an agent space" until it ends, with the command to end it on the machine. A review follow-up is not a claim: pause its lane and end it on the machine.

Log lines are cleaned on the machine and again by Mushi before they are stored: no keys, tokens or paths, e-mail addresses masked, and no lines a compiler quotes from your code. A machine whose Mushi CLI is older than these checks says so on its card instead of showing a problem.

### Send to my local worker

On a report's page and on a pipeline group, **Send to my local worker** puts the reports at the end of one of your lanes for that app. While a lane holds a report, no cloud agent is sent to it, and the lane does not take a report a cloud agent is already working on.

### Create a worker key

A worker key can only take reports for its lanes and record their fixes. It cannot merge, change settings or read keys. **Create a worker key** makes one for the apps you pick and shows it once; pass it to `mushi worker install --key-stdin` on the machine. `mushi worker install` can also make one with your CLI login. Revoking a machine here revokes its key, and the worker stops at its next heartbeat.
