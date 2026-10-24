---
'@mushi-mushi/cli': patch
---

`mushi work` installs the worktree's dependencies from its lockfile (pnpm, npm or yarn) before the agent starts. The agent can then run the project's tests, and commit hooks that import a package no longer fail with ERR_MODULE_NOT_FOUND. A failed install is logged and the run goes on.
