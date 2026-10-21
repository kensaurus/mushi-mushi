---
'@mushi-mushi/mcp': minor
---

New read tool `get_ci_overview` (ADR 0033): where a project's tests run and why a fix waits to land. It returns the machines that send a runner heartbeat, the GitHub runners seen, the latest jobs with a verdict that tells a code failure from a stopped test machine (waiting for a runner, runner lost, queue expired), wait and run times, and advice with the evidence for each rule. Its result is wrapped as untrusted data, since repo, job and runner names come from the repos.
