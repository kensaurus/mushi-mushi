---
'@mushi-mushi/cli': patch
---

On Windows, `mushi work` installs a worktree's dependencies by running the package manager's own script (npm-cli.js, pnpm through corepack, yarn.js) with the current Node, never through `cmd.exe`. When no script is found it skips the install and says so.
