# Migration guides

Source: https://kensaur.us/mushi-mushi/docs/migrations

---
title: Migration guides
description: Step-by-step guides for moving an app onto Mushi Mushi from Sentry, Instabug, Shake, LogRocket, BugHerd or Pendo, or between React, Vue and mobile runtimes.
---

# Migration guides

Long-form playbooks for moving an existing app onto Mushi Mushi, or between
Mushi-supported runtimes, without losing your project, your API key, or
your reports inbox. Every guide ships with an interactive checklist that
saves your progress in this browser.

## Don't see your migration?

We pick guides based on demand. If your stack isn't covered yet, open a
[migration request issue](https://github.com/kensaurus/mushi-mushi/issues/new?labels=migration-request)
with the source framework / vendor and a sentence about why you're moving.
The most-requested ones get written first.

  **Want a guide picked for you?** Run
  `npx mushi-mushi migrate` in your project root (or `mushi migrate` if you
  have `@mushi-mushi/cli` installed globally) and it points you at the most
  relevant guide based on what's in your `package.json`. The `mushi-mushi`
  launcher passes `migrate` and every other non-`init` command through to
  `@mushi-mushi/cli`.
