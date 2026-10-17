---
"@mushi-mushi/cli": patch
"@mushi-mushi/mcp": patch
"@mushi-mushi/react-native": patch
---

Internal cleanup with no change to what these packages export or do. Helpers that only the package's own tests called were removed together with those tests (`withAbort`, `formatError` and `formatUpgradeHint` in the CLI, `shouldWrap` in the MCP server), and helpers exported only for tests now carry an `@internal` doc tag. In React Native, one module-internal constant is now exported on its declaration instead of from a trailing export list. None of these is reachable from a package entry point.
