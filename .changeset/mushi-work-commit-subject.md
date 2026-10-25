---
'@mushi-mushi/cli': patch
---

`mushi work` keeps the commit subject (the PR title, MUSHI suffix included) within 72 characters, so repos whose commitlint enforces `subject-max-length` / `header-max-length` accept the commit instead of losing the agent's change.
