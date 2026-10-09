---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
"@mushi-mushi/mcp": patch
---

`denyUrls` / `allowUrls` now work for `captureException()`. They match the script URL of the frame that threw, read from the stack unless you pass `metadata.filename`. Before, `allowUrls` dropped every `captureException()` call that didn't pass a filename. A `/g` or `/y` RegExp filter now matches on every call, not every other one. On pagehide the SDK replays only a POST that is still in flight, not one already delivered. MCP `check_sdk_version` reads a package.json range such as `^1.27.0` as its version.
