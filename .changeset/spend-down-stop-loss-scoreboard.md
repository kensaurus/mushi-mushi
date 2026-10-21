---
'@mushi-mushi/mcp': patch
---

`get_spend_down_status` now describes the spend-down stop-loss and scoreboard (ADR 0028 amendment): each app the key pays for carries its stop-loss state (paused while its last 20 Opus-reviewed spend-down fixes are under 20% mergeable or over 35% held, or over half its last 20 runs ended without a PR), and each key returns its last 7 days of runs, PRs, no-PR verdicts, Opus verdicts, merges and review cost.
