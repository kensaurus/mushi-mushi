---
'@mushi-mushi/ux': patch
'@mushi-mushi/mcp-ci': patch
---

The `mushi-ux` and `mushi-mcp-ci` downloads no longer include source maps, like `@mushi-mushi/cli` and `@mushi-mushi/mcp`. That is about 1 MB less for every `npx @mushi-mushi/ux` and every CI job that runs the Action. The mcp-ci npm page also describes what the Action does for a pull request.
