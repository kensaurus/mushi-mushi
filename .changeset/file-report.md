---
'@mushi-mushi/cli': minor
'@mushi-mushi/mcp': minor
---

File a report by hand. `mushi reports file --title --description [--severity] [--component] [--project]` and the new MCP write tool `file_report` add a free-form report to an app's queue, for a bug you found yourself or a backlog item you want an agent to fix. The report goes through the same triage as a user report, so it gets a diagnosis and can then be sent to `mushi fix` or `dispatch_fix`. Severity and component are hints that triage may refine. It needs a key with the `mcp:write` scope; each app takes at most 30 filed reports an hour, and viewers cannot file.

`mushi design dispatch-findings [--max-files N]` sends the latest design scan's findings to an agent, one report per file and a few files per call, skipping token-definition files (the console's "Send findings to agent").
