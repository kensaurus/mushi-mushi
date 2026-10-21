---
'@mushi-mushi/mcp': patch
---

`get_spend_down_status` now describes the spend-down stop-loss and scoreboard (ADR 0028 amendment): each app the key pays for that the project can see carries its stop-loss state (paused when, over 14 days with 20+ samples, the 95% Wilson bound puts its Opus merge rate under 20%, hold rate over 35% or no-PR share over 50%; one probe fix a day while paused), and each key returns its last 7 days of runs, PRs, no-PR verdicts, Opus verdicts, merges and latest review cost per PR.
