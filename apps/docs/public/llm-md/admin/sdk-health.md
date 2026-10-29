# SDK health

Source: https://kensaur.us/mushi-mushi/docs/admin/sdk-health

---
title: 'SDK health'
description: SDK health in Mushi Mushi lists what stops your app's reports arriving, like a missing install, missing CI keys, an outdated SDK or a blocking CSP, with fixes.
---

# SDK health

**SDK health** is a section of the [Connect](/admin/connect) page
(`/connect#connect-sdk-health`), not a page of its own. Mushi Mushi checks the active
app's repo, keys, CI and live site, and lists the problems that stop bug reports from
arriving, each with a fix. It catches "I installed the SDK two weeks ago and forgot to
ship the deploy".

## What it checks

| Problem | Severity | Fix offered |
| --- | --- | --- |
| No GitHub repo is connected | error (warn once the SDK has checked in) | none: connect a repo |
| The SDK isn't in your app yet | error | **File install task** for your fix agent |
| GitHub Actions is missing the Mushi keys | error (warn once seen) | **Write CI secrets** to the repo |
| This app has no working SDK key | error | **Write CI secrets** (mints a key and writes it) |
| The SDK has never checked in | error | none |
| An SDK update is out | warn | **Open upgrade PR**, or a link to the upgrade PR already open with its CI state |
| Your site's security policy blocks Mushi | error | **File CSP task** |
| Cold: no check-in for N days | warn (after 7 days) | none |

A check that could not run (no live site address known, the SDK versions could not be
read, …) is listed under the problems as a note. The section never says "No SDK problems
found" while a check could not run.

**Fix all** runs every pending fix in order: CI secrets first, then the install task,
then the upgrade PR, then the CSP task. Writing secrets to GitHub and **Fix all** ask
you to confirm first. **Check again** re-runs the checks.

## Heartbeat freshness

The same freshness scale is used wherever the console shows the SDK heartbeat (the
project switcher, the Connect snapshot and the key list):

- **Healthy**: last check-in under 1 hour ago
- **Stale**: up to 7 days
- **Cold**: more than 7 days
- **Never**: no check-in yet

## Where it lives

- **Connect page**: the **SDK health** section.
- **Setup checklist**: the "Install the SDK in your app" step's **Fix** button opens the same panel.
- **Project switcher**: each app shows a one-line heartbeat that links to SDK health.

## API

```bash
GET  /v1/admin/projects/:id/sdk-health
POST /v1/admin/projects/:id/sdk-health/tasks
```

## Related

- [SDK reference → Overview](/sdks): every published SDK with its
  current latest version.
- [SDK upgrade lockfile helper](/admin/sdk-upgrade-lockfile): make upgrade PRs pass a
  frozen-lockfile install.
- [Concepts → Architecture](/concepts/architecture): where the
  heartbeat data flows in the gateway.
