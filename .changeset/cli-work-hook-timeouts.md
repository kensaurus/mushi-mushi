---
'@mushi-mushi/cli': patch
---

`mushi work` and the local worker no longer hang on a repo's git hooks: `git commit` and `git push` stop after 25 minutes (other git commands after 10) with a message that names the hook, and the report is retried. A command stopped for running too long now ends everything it started (a hook's type check or lint), not just itself.
