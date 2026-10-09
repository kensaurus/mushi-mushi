---
"@mushi-mushi/web": patch
---

`denyUrls` and `allowUrls` now apply to unhandled promise rejections too. A rejection has no `filename` the way an error event does, so these filters used to let every rejection through. The SDK now reads the script URL from the innermost stack frame of the rejected `Error`.
