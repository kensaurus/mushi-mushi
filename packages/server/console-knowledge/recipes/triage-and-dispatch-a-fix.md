---
title: Triage and dispatch a fix
routes:
  - /reports
  - /fixes
  - /reports/:id
kind: recipe
---

# Triage and dispatch a fix

Use this flow when a user reports a bug and you want Mushi to open a draft pull request.

## Steps

1. Open **Reports** (`/reports`) — the inbox of inbound bug reports from your app.
2. Filter by **status=new** or **severity=critical** to find urgent items (or use Cmd+K → "Open critical bugs").
3. Click a report to open **Report detail** (`/reports/:id`). Review the screenshot, console log, and classification.
4. Set **status** and **severity** in the triage bar if the auto-classification needs correction.
5. Click **Dispatch fix** to start the fix-worker agent. Watch the progress stream for branch + PR creation.
6. Open **Fixes** (`/fixes`) to review drafted PRs, CI status, and merge when ready.
7. Optionally open **Repo** (`/repo`) for a branch-level view across all auto-fix activity.

## Tips

- Use `@report:<id>` in Ask Mushi to ask questions about a specific report.
- Skill Pipelines (`/skills`) can attach a cursor-kenji workflow to a report for guided handoff.
