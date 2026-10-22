---
'@mushi-mushi/mcp': patch
---

`get_spend_down_status` now also returns `reviewFollowups` (ADR 0032): the last 7 days of review follow-ups, where a pull request the Opus review marked "fix first" is sent back to a new Cursor agent once with the review's findings. It counts follow-ups sent, finished, pushed and with no change, the Opus verdict on each pushed commit, and the fix-first → merge conversion rate, over the apps you can access.
