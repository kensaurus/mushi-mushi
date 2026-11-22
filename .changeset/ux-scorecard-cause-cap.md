---
"@mushi-mushi/ux": patch
---

- **A scorecard run keeps its top 60 root causes** — causes that span pages or contradict come first, then the rest by rank, so a large app's run syncs and files instead of failing with "at most 60" (the first real run on Mushi's console grouped 235). `scorecard.json` on your machine still lists every cause.
- **A server-scored run keeps its screenshots** — `--score-via server` sends the screenshot names it uploaded with the final sync, so the console no longer loses them.
