---
"@mushi-mushi/cli": patch
---

- **The worker's heartbeat names its coding agent** — `mushi work --daemon` now sends which agent its lanes run (`cursor` or `claude`). The console uses it to show a Claude Code worker's account. Before, it read "Cursor account: not checked yet" and offered a Cursor account switch that does nothing for Claude Code.
