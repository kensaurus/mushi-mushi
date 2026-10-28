# UX runs

Source: https://kensaur.us/mushi-mushi/docs/admin/ux-runs

---
title: UX runs
description: Each screen your coding agent worked on in a mushi ux run, with its plan, every attempt, before and after screenshots, and what was kept.
---

# UX runs

**Route:** `/ux-runs`

> **Scenario:** You let your coding agent work through every page, tab and dialog of
> your app overnight and want to see, screen by screen, what it changed and whether
> anything got worse.

`mushi ux run` runs on your machine. It maps your running app, gives one screen at a
time to the agent you choose (Claude Code, Cursor, Codex) in a separate git branch, and
keeps an edit only when accessibility, layout and console measurements did not get
worse. With `--sync` it mirrors the run here as it goes.

```bash
mushi ux ui      # pick the agent, a model from your account, a skill and the pages, then start
# or straight from the terminal:
mushi ux run --dev "pnpm dev --port {port}" --agent claude-code --sync
```

A synced run shows here as it goes: its phase (installing, mapping, working on
"Home, attempt 2"), a progress bar by outcome, and the screen the agent is on.
While an attempt runs you see its step count, the file it last read or edited,
the files changed so far, and the time used out of its time box. A running
run checks in every 30 seconds; when it stops, the page says how long it has
been quiet and how to resume it.

Each screen keeps every attempt's screenshot at phone and desktop width; pick
one to compare it with the baseline. **What the agent did in attempt N** lists
the files that attempt read and edited. The agent's own words and the commands
it ran stay on the machine that ran it. A run only syncs to the project its
app reports to: if your login is for another project, `--sync` says so and
stops.

  Exploring your app never sends a write request: every request that is not a read is
  blocked, forms are not submitted, and buttons such as Delete or Pay are never clicked.

## Run in the cloud

No machine to leave running? **Run in the cloud** starts the same pass on your repo's
GitHub Actions, with a [Cursor Cloud](https://cursor.com/docs/cloud-agent/api/endpoints)
agent making the edits. It appears on this page like a local run and ends with one
draft PR. You need, in the app's front end repo:

1. [`.github/workflows/mushi-ux.yml`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/templates/mushi-ux.yml)
   on the default branch, with `dev-command` set to how your app starts.
2. Secrets `CURSOR_API_KEY` and `MUSHI_API_KEY` (a key with `mcp:write`), the variable
   `MUSHI_PROJECT_ID`, and optionally `ANTHROPIC_API_KEY` for the review.
3. **Settings → Actions → General → Allow GitHub Actions to create pull requests**, or
   the run ends with a compare link instead of a draft PR.

Pick the model from your Cursor account's list (with its settings, such as
effort and context; this needs a Cursor key under Settings → AI keys) and,
optionally, a skill from the synced skills catalog. Mushi starts it with a
`repository_dispatch` event through your GitHub connection,
at most three times an hour per app. When it cannot (no workflow, no connection,
GitHub refused), the card shows the `gh workflow run` command to start it yourself.

  A cloud run sees your app signed out: screens behind sign-in show as **Could not
  load**. Each attempt is a commit Cursor pushes to `mushi-ux/`; if your CI runs
  on every push, add `branches-ignore: ['mushi-ux/**']` to it.

---

## What you see

| Status | Meaning | What to do |
|--------|---------|------------|
| **Moved by another fix** | A change kept on another screen (often a shared component or token) changed this one. | Check it first. |
| **Rolled back** | Every attempt made a measured problem worse, so it was undone. | File it as a bug, or run again with a different model. |
| **Could not load** | The screen did not render for capture. | Run `mushi ux login` for signed-in screens, or allow the reads your app makes with POST (`--allow`). |
| **Improved** | An edit was kept. | Review it on the run's branch. |
| **No change needed** | The agent made no edit, or nothing visible changed. | Nothing. |

Select a screen to see a before/after slider, the changed pixels, the problems still
measured, each attempt with its commit, and the optional review by a second model.
The review is advisory: it never keeps or reverts anything.

## File as bug

**File as bug** adds the screen to your normal bug queue (source `ux_loop`) with the
measurements and the review's notes. It makes no AI call.

## Audit signed-in screens

`mushi-ux audit` finds UI bugs on the screens behind your sign-in and files them as
reports, without editing code. It reuses a browser profile you are already signed in
with, so it never asks you to sign in again:

```bash
mushi-ux audit --url https://example.com/admin \
  --profile-dir ~/.playwright-cli-profiles/example --file --dry-run
```

It maps the screens under that URL read-only, captures each on desktop and phone, and
files what it measures: serious accessibility rules, a page that scrolls sideways,
console errors, and content that jumps while loading. Add `--review claude-code` for a
model to point out concrete visual defects on whole pages. `--file` files at most 15
reports a run and skips one still open or filed in the last 14 days; `--dry-run` lists
them instead.

## Fresh eyes

A fresh-eyes run tests the path a stranger takes: a model that has never seen your app
tries one goal from your landing page, such as "get my first bug explained", reading only
what is on screen. Code decides everything else:

- **Time to first value**: how long the app made the visitor wait, plus the time to read
  each new screen, until the goal check passes (a URL, visible text, a selector or an API
  that answers with data). The model's own thinking time is never counted.
- **Where it stalled**: a sign-in it cannot pass, a captcha (never solved), a dead end, an
  error, or a step that needs something outside the app (an inbox, an API key, a
  terminal, another account).
- **What gets filed**: measured problems once a replay of the steps without the model
  shows them again; opinions such as "confusing" only when two sessions agree. Reports
  come in as source `fresh_eyes`, at most 15 a run.

```bash
mushi ux fresh-eyes --url https://your-app.com --goal "get my first report" --dry-run
# with a test account for your app, mirrored here and filed:
MUSHI_FRESH_EYES_EMAIL=… MUSHI_FRESH_EYES_PASSWORD=… \
  mushi ux fresh-eyes --url https://your-app.com --goal "get my first report" --sync --file
```

The run is signed out in a clean browser. It may only write to your app's own origins
(`--app-host` adds its API); payments, "Continue with Google/GitHub/Apple", public sign-up
forms and anything labelled delete or revoke are refused. Without an account it stops at
your sign-up page and says so; `--dry-run` never writes at all.

The **Fresh eyes** tab shows each run: time to first value, steps, how many sessions
reached the goal, the trend over runs, and every step with its screenshot and wait. Once
an app has a finished run, Home shows a **First-time setup** light with the minutes and
steps. Runs start on your computer, where the browser and the Cursor CLI run; the tab's
**Run now** gives the exact command.

## Where the changes are

Kept edits are commits on the branch shown above the screen list
(`mushi-ux/`). Nothing is merged for you: review the branch and open it as a
draft PR. Screenshots are kept for the project's retention window (30 days by default).

See also: [CLI reference](/sdks/cli#ux-pass-over-every-screen).
