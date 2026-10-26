---
'@mushi-mushi/cli': patch
---

`mushi work` writes commit messages that commitlint's config-conventional accepts: body lines are wrapped at 100 characters and never start like a footer (`token:`), so a long agent summary no longer fails a repo's commit hook and loses the follow-up.
