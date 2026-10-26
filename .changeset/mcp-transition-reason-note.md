---
'@mushi-mushi/mcp': patch
'@mushi-mushi/cli': patch
---

The `reason` of `transition_status` and the `note` of `reopen_report` and `mushi reports triage/resolve/reopen/dismiss --note` are kept as a team note on the report (the console's internal Triage note, never sent to the reporter). They were dropped before.
