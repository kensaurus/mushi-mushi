---
'@mushi-mushi/mcp': minor
---

New write tool `request_ci_placement_change` (ADR 0037): ask to change where one repository's CI runs by setting or removing one runner variable (`LINUX_RUNNER` or `RUNNER_<WORKFLOW>`) its workflows read. Mushi builds the change from a fresh preview: the jobs that move and the ones that stay, the target runners, the cost change, and the variable's current value, which must still match when the change runs. Your organization's CI policy is checked now and again at execution. The tool only creates a request: a team owner or admin approves and runs it in the console within an hour, and Mushi never changes runner labels or registrations.
