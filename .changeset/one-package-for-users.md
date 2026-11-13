---
"mushi-mushi": minor
"@mushi-mushi/cli": minor
"@mushi-mushi/mcp": patch
---

`mushi-mushi` is now the one package you install. `npm install mushi-mushi`, then import from `mushi-mushi` (the browser SDK) or `mushi-mushi/react`, `mushi-mushi/vue`, `mushi-mushi/svelte`, `mushi-mushi/angular` and `mushi-mushi/node`. `npx mushi-mushi` still runs the setup wizard, and the wizard now installs `mushi-mushi` and writes imports from it (React Native and Capacitor still get their own package). `mushi upgrade` and `mushi doctor` recognise `mushi-mushi` next to the `@mushi-mushi/*` names. Already on `@mushi-mushi/react`, `@mushi-mushi/web` or another scoped SDK? Nothing changes: it keeps working and keeps getting updates.

The MCP server's built-in docs search (`search_mushi_docs`) now answers install questions with `mushi-mushi`.
