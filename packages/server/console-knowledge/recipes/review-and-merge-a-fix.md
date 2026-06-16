---
title: Review and merge a fix
routes:
  - /fixes
  - /repo
kind: recipe
---

# Review and merge a fix

Review AI-generated pull requests before merging to production.

## Steps

1. Open **Fixes** (`/fixes`) — lists draft PRs with status, branch, and summary.
2. Click a fix row to expand CI feedback and the linked report.
3. Open the **GitHub PR** link to review the diff in GitHub (or use the in-console merge preflight).
4. Use **Refresh CI** if checks are stale, then **Merge** when green.
5. Track shipped impact on **Releases** (`/releases`) and **Dashboard** (`/dashboard`).

## Tips

- **Repo** (`/repo`) shows all branches and PR activity in one timeline.
- Use `/draft-pr-summary` in Ask Mushi on a fix detail page for a PR description draft.
