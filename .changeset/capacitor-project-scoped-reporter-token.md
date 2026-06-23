---
"@mushi-mushi/capacitor": patch
---

Use the project-scoped reporter token (`getReporterToken(projectId)`) for submit, My Reports, comments, replies, and reopen so multi-project Capacitor hosts on the same origin no longer share a single anonymous reporter identity. Adds an explicit config guard on the reporter-inbox methods.
