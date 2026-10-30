---
'@mushi-mushi/cli': patch
---

- **`mushi work` no longer loops on a half-made worktree**: a run killed inside `git worktree add` left git's record locked as "initializing" with no folder, and every later run of that report failed with "already used by worktree" within seconds. The worker now unlocks and prunes that record (the path is its own cache) before it adds the worktree again.
