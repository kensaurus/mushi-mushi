---
'@mushi-mushi/mcp': patch
---

Refactor the MCP server entry point into a testable `createMushiServer` factory (`server.ts`) plus a thin `index.ts` stdio bridge, and formalise tool/resource/prompt metadata in `catalog.ts`. The catalog is mirrored into the admin UI and guarded by `scripts/check-mcp-catalog-sync.mjs` to prevent drift.

Public changes:
- New `bin` entry `mushi-mcp` so MCP clients can launch the server without pointing at `dist/index.js` directly.
- New `test:smoke`, `test:localhost`, and `demo` scripts; integration test suite (`__tests__/server.integration.test.ts`) exercises the real MCP protocol via `InMemoryTransport` with a stubbed `fetch`.
- README rewritten around the "MCP for beginners" admin page, with 2025-10 spec alignment, tool-annotation semantics (`readOnly` / `destructive` / `openWorld`), scope model (`mcp:read` / `mcp:write`), and a testing matrix.

No breaking changes for consumers. Existing `MUSHI_API_ENDPOINT` / `MUSHI_API_KEY` / `MUSHI_PROJECT_ID` env vars and the stdio transport contract are unchanged.
