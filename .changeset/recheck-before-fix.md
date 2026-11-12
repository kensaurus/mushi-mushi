---
'@mushi-mushi/cli': minor
---

`mushi work` spends no agent run on a report that is already gone. A code-audit report's own check runs again on the base branch before any install or agent: if it no longer reproduces, the report is closed as fixed with a team note. An `already_fixed` verdict that names a commit on the base branch closes the report too, so it is not tried again. `mushi work --recheck` clears a backlog of such reports in one sweep, with no agent and no tokens (`--dry-run` counts them). The local worker ends such claims as `gone`.
