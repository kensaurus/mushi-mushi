---
"@mushi-mushi/cli": patch
---

`mushi work` strips terminal colour codes from a git hook's output before it stores the failure, so the report page shows the hook's words instead of raw escape codes.
