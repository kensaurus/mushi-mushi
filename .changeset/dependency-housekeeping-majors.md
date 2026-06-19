---
"@mushi-mushi/inventory-schema": minor
"@mushi-mushi/cli": patch
"@mushi-mushi/mcp-ci": patch
"@mushi-mushi/react-native": patch
---

Dependency housekeeping — runtime major-version bumps.

- **inventory-schema**: migrate to **Zod 4** (`zod@^4.4.3`), aligning with `@mushi-mushi/mcp` and `@mushi-mushi/agents`, which were already on v4. The public API is unchanged; the validation-issue path formatter now handles Zod 4's widened `PropertyKey[]` issue paths.
- **cli**: bump `commander` to **v15** (ESM-only; the CLI is already pure ESM, so the change is transparent to consumers).
- **mcp-ci**: bump `@actions/core` to **v3** (ESM-only, Node 24-ready; bundled via tsup).
- **react-native**: build and test against **react-native 0.86**. `StyleSheet.absoluteFillObject` was dropped from RN 0.86's TypeScript types, so the backdrop style now inlines the equivalent absolute-fill literal — runtime behavior is identical and it compiles against all supported `react-native >= 0.72`.
