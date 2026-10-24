---
'@mushi-mushi/cli': patch
---

`mushi work` skips a report for 7 days after its local run ended without a pull request (`--report` still runs it), says "timed out after 30 min" instead of "exited 143", and tells the agent to fix the first of several named pages completely rather than run out of time on all of them.
