---
"@mushi-mushi/cli": patch
---

`mushi work --daemon`: lanes now take turns for agent spaces. Each tick asks the lane served longest ago first, so the first lanes in worker.json can no longer take every freed space while the rest wait.
