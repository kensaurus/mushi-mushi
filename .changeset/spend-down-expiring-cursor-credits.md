---
"@mushi-mushi/mcp": minor
"@mushi-mushi/cli": minor
---

Spend down expiring Cursor credits on open bugs. A Cursor key can be given the date its credits expire, a model and a number of fixes per day; from a chosen number of days before that date, Mushi sends the best open reports of the apps that key already pays for to Cursor on its own, inside each app's auto-fix limits, and every fix opens a draft pull request. New MCP tools `get_spend_down_status` and `set_byok_spend_down`, and the CLI command `mushi keys spend-down`.
