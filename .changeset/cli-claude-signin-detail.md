---
"@mushi-mushi/cli": patch
---

- **A Claude Code worker's account check reads properly** — `claude auth status` answers in JSON, so the console showed `checked 2 min ago: "{"`. It now reads "logged in (claude.ai)" or "logged out", and never includes the account's e-mail.
