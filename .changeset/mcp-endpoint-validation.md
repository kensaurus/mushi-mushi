---
'@mushi-mushi/mcp': patch
---

A configured `MUSHI_API_ENDPOINT` that is not an http(s) URL now starts the server in setup mode with a clear error, instead of failing on every tool call. Your key is never sent to that endpoint or to the default one.
