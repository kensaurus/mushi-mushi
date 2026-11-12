---
'@mushi-mushi/cli': patch
---

`mushi work` counts a git hook whose tool crashed (a segmentation fault, `SIGSEGV`, core dumped, exit 139) as a failure of the machine, not of the fix, so the report starts no 7-day retry cooldown.
