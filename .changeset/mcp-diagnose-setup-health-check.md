---
'@mushi-mushi/mcp': patch
---

- **`diagnose_setup` names the root cause first**: in full mode it reads the app's Health check and returns its "Fix these first" list as `health`; when the connection, ingest and dispatch checks pass, `nextAction` is the first root cause and its fix.
