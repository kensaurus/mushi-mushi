---
'@mushi-mushi/core': patch
'@mushi-mushi/web': patch
'@mushi-mushi/react': patch
'@mushi-mushi/node': patch
'@mushi-mushi/mcp': patch
---

Shorter READMEs with a diagram of how the package fits, a copy-paste quick start and a table of what is inside. Fixes three wrong examples: the Node handlers and `attachUnhandledHook` take `{ client }` (Hono's handler also takes `next`), and `useMushi()` has no `open`, `close` or `setUser`.
