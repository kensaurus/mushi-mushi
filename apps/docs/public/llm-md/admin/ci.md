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
