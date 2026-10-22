---
'@mushi-mushi/cli': minor
'@mushi-mushi/mcp': minor
---

File a report by hand. `mushi reports file --title --description [--severity] [--component] [--project]` and the new MCP write tool `file_report` add a free-form report to an app's queue, for a bug you found yourself or a backlog item you want an agent to fix. The report goes through the same triage as a user report, so it gets a diagnosis and can then be sent to `mushi fix` or `dispatch_fix`. Severity and component are hints that triage may refine. It needs a key with the `mcp:write` scope; each app takes at most 30 filed reports an hour, and viewers cannot file.
