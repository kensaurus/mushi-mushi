---
'@mushi-mushi/cli': patch
---

`mushi login` (and other commands that open the browser) no longer stop silently with exit code 0 right after the banner on Windows. The CLI waited for the browser opener to exit while letting Node forget it, so Node ended the process before the sign-in URL was shown; it now continues as soon as the opener starts.
