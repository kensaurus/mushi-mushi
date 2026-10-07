# UX runs

Source: https://kensaur.us/mushi-mushi/docs/admin/ux-runs

---
title: UX runs
description: The UX runs page in the Mushi console shows each screen your coding agent worked on during a mushi ux run, on your machine or on GitHub Actions — improved, rolled back, moved by another fix, or could not load — with before and after screenshots.
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
mushi ux run --dev "pnpm dev --port {port}" --agent claude-code --sync
```

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

Mushi starts it with a `repository_dispatch` event through your GitHub connection,
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

## Where the changes are

Kept edits are commits on the branch shown above the screen list
(`mushi-ux/`). Nothing is merged for you: review the branch and open it as a
draft PR. Screenshots are kept for the project's retention window (30 days by default).

See also: [CLI reference](/sdks/cli#ux-pass-over-every-screen).
