---
'@mushi-mushi/cli': patch
---

`mushi connect` uses the API key that `npx mushi-mushi` or `mushi login` already saved when you pass none, so the command the setup wizard prints works as it is. The wizard's last checklist names the console tab by its current label, "Test it".
