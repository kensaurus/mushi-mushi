---
'@mushi-mushi/mcp': patch
---

The server icon URL now resolves. `MUSHI_ICON_PNG_URL` — advertised to every MCP client through `serverInfo.icons` and recommended in the README — pointed at `/mushi-mushi/integrations/mushi-mark-512.png`, which nothing served (live 404). The mark now ships with the docs site and the URL points at it, so clients that fetch the icon get the red 虫 stamp instead of nothing.
