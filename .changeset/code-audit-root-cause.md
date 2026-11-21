---
"@mushi-mushi/cli": minor
---

- **The code-read audit files fewer, truer reports** — it asks for 0 to 3 findings per screen, and none when nothing would matter to a real user. Every finding needs a severity, a confidence (under 0.6 is dropped) and what the user sees. A "missing" check now fails when a shared component around the line already has what is missing. Each finding also carries its root, the shared component or route kind one fix lands in, so the server keeps one report per root cause (ADR 0065).
- **The audit lane rechecks its open findings once a day** — on the default branch, with no model. What no longer reproduces is closed with the commit it checked. When the app is at its open cap, the lane only rechecks.
- **`mushi work --recheck --dry-run --json` shows the pattern plan** — how the open findings would collapse into one report per pattern.
