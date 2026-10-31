---
"@mushi-mushi/cli": patch
---

The local worker now backs off when its runs keep failing on the machine or the agent account (a spent Cursor plan, a model the plan lacks): the first failure still retries at once, then the lane waits 1, 2, 4 … 30 minutes before it claims again, instead of claiming and failing every few seconds.
