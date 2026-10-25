---
'@mushi-mushi/cli': patch
---

`mushi work` tries the worktree install twice, and when a commit hook fails only because a package is not installed (`ERR_MODULE_NOT_FOUND`), it installs and commits again instead of losing the agent's change.
