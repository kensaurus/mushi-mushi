---
'@mushi-mushi/cli': patch
---

`mushi work` no longer stops with "The Cursor CLI is not signed in" when `cursor-agent status` is only slow or unclear, as happened with several `mushi work` lanes on one machine. The sign-in check now waits up to 90 s, asks a second time when the first answer is not "signed in", and stops only on a clear "not logged in". A timeout or unclear answer prints a warning and the run continues. A missing `cursor-agent` now says it is not installed instead of "not signed in".
