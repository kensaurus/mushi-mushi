---
"@mushi-mushi/mcp": patch
---

`npx @mushi-mushi/mcp --help` now prints how to set it up and the env vars it reads, then exits, instead of starting the server and waiting. `--version` prints the version.

With an SDK key (report:write), setup mode now gives one command to fix it: `npx mushi-mushi login --project-id <id>`, then restart the server (and, if the key came from `MUSHI_API_KEY` in the server's env block, remove it there so the saved key is used).
