---
"@mushi-mushi/mcp": minor
---

Three reporter-loop tools, on both the npm (stdio) and hosted transports: `request_reporter_info` asks the person who filed a report a question and marks it "Waiting on you"; `list_reporter_outbox` lists pipeline updates held for review; `release_reporter_update` sends (optionally edited) or discards one held update. `transition_status` gains `closedReason` (duplicate, not_reproducible, wont_fix, working_as_intended, spam), which sets what the reporter is told when a report is dismissed, and `reporterMessage`, a note posted to the reporter verbatim.
