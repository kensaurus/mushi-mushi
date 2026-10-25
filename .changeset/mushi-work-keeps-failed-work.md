---
'@mushi-mushi/cli': patch
---

`mushi work` keeps going when one report fails. If a commit hook, push or `gh pr create` fails after the agent made a change, the change is kept in its worktree, the fix is marked failed with the reason, and the error shows the end of the command's output, where the failure is. The command still exits 1 when any report failed.
