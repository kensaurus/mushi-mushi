---
'@mushi-mushi/cli': patch
---

`mushi work` redoes a report whose earlier pull request was closed without merging: it works on the next free branch name (`…-2`) instead of skipping the report because the old branch is still on origin. An open or merged pull request still skips it.
