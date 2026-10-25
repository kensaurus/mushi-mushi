---
'@mushi-mushi/cli': patch
---

`mushi work` removes a worktree folder an earlier run left behind even when git no longer lists it as a worktree (a killed run), instead of failing `git worktree add` on that report every run.
