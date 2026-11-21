---
"@mushi-mushi/cli": minor
---

- **The code-read audit files fewer, truer reports** — it asks for 0 to 3 findings per screen, and none when nothing would matter to a real user. Every finding needs a severity, a confidence (under 0.6 is dropped) and what the user sees. When what a "missing" check looks for is in a shared component around the line, the finding is rooted at that component, so every screen it wraps is one report. Each finding carries its root, the shared component or route kind one fix lands in, so the server keeps one report per root cause (ADR 0065).
- **The audit lane rechecks its open findings once a day** — on the default branch, with no model. What no longer reproduces is closed with the commit it checked. When the app is at its open cap, the lane only rechecks.
- **`mushi work --recheck --dry-run --json` shows the pattern plan** — how the open findings would collapse into one report per pattern.
- **`mushi work --collapse-backlog [--apply]` collapses the findings filed before** — a dry run unless `--apply`; each group's other reports become duplicates of one, a report with a live PR stays open, and every changed row is tagged so the SQL it prints reverts it. With `--apply-cap` it then keeps only the best reports up to the app's open cap; the rest wait and come back as slots free.
