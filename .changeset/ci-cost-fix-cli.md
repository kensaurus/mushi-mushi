---
'@mushi-mushi/cli': minor
---

`mushi runner fix --repo <owner/repo> --workflow <path> --kind <kind>` opens a draft pull request that applies one CI cost fix to a workflow: cancel superseded runs, skip drafts, run a schedule weekly, or skip docs-only changes. `mushi runner fix-status` shows the fix and, after the merge, the billed minutes a day it saved.
