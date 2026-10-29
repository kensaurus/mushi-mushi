---
'@mushi-mushi/cli': patch
---

- **`mushi connect` uses your saved key**: when you pass no key, it uses the one `npx mushi-mushi` or `mushi login` already saved, so the command the setup wizard prints works as it is. The wizard's last checklist names the console tab by its current label, "Test it".
