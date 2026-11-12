---
'@mushi-mushi/cli': patch
---

`mushi work` counts a git hook in which Node itself crashed (a V8 fatal error, "Native stack trace", heap out of memory) as a failure of the machine, not of the fix, so the report starts no 7-day retry cooldown.
