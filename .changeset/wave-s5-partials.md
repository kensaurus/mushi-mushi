---
'@mushi-mushi/verify': minor
---

Wave S5 — Playwright step interpreter now understands the full verify reproduction vocabulary.

`parseStep` / `executeStep` handle `click`, `navigate`, `type`/`fill`, `press`, `select`, `assertText`, and `waitFor` so automated repro runs can cover multi-field forms and assertion gates, not just click-through flows.
