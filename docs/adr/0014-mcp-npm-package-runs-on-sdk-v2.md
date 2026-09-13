# ADR 0014 — The published MCP package runs on SDK v2; the hosted server stays hand-rolled

- **Status:** accepted
- **Date:** 2026-09-12
- **Plan:** [017 — Dead Code / MCP attunement / voice loop](../execplans/dead-code-voice-agent-loop.md), Workstream B
- **Related:** [ADR 0008 — keep the hosted MCP server hand-rolled](./0008-keep-the-hosted-mcp-server-hand-rolled.md)

## Context

Two MCP servers ship from this repository and they had been treated as one
decision:

- `packages/mcp` — the published npm package and `mushi-mcp` stdio binary that
  Cursor and Claude Desktop spawn locally. Node, bundled with tsup.
- `supabase/functions/mcp` — the hosted HTTP server. Deno, subject to the
  20 MB edge-function bundle cap.

Both spoke `2025-03-26`. The `2026-07-28` revision changes the handshake
(`server/discover` replaces `initialize`, no `Mcp-Session-Id`), puts
`resultType` on every result, adds `ttlMs` / `cacheScope` to list results, adds
`Mcp-Method` / `Mcp-Name` headers, and defines error codes `-32020`–`-32022`.
Clients will straddle both eras for a long time, so whatever we do has to serve
legacy and modern callers from the same process.

ADR 0008 already decided the hosted side: hand-rolled, because the Deno bundle
cap and the edge runtime make a large SDK dependency a poor trade. That ADR was
read as covering the npm package too. It should not have been — the two have
different constraints, and the npm package has none of the hosted one's.

## Decision

**Split the decision.** The hosted server stays hand-rolled per ADR 0008. The
npm package moves to the Model Context Protocol TypeScript SDK v2
(`@modelcontextprotocol/server` + `@modelcontextprotocol/core`).

The migration ran through `npx @modelcontextprotocol/codemod@latest v1-to-v2`:
122 changes across 7 files, every `inputSchema` / `outputSchema` wrapped in
`z.object()` (101 sites), `server.resource()` → `registerResource()`,
`server.prompt()` → `registerPrompt()`, and tool handlers moved from
`(args, extra)` to `(args, ctx)`.

`src/index.ts` uses `serveStdio()` from `@modelcontextprotocol/server/stdio`
rather than hand-wiring a transport. This is load-bearing, not cosmetic: the
hand-wired transport answered `server/discover` with `-32601`, so the binary
served only legacy clients. `serveStdio` is what makes the dual era work.

## Why not hand-roll this one too, for symmetry

Symmetry is not a reason; the constraints differ.

- **The bundle cap does not apply.** It is an npm package, not an edge
  function. The argument that decided ADR 0008 is simply absent here.
- **Dual-era support is the entire feature.** Hand-rolling `server/discover`,
  the `_meta` envelope, `resultType`, and the cache fields means reimplementing
  the spec and then tracking it forever. The SDK does it with `legacy: 'serve'`.
- **73 tools, 8 resources, 4 prompts.** The schema surface is large enough that
  the codemod is cheaper and more accurate than a hand migration.

## Consequences

**One observable behaviour change.** Calling a tool that is not registered — a
write tool on an `mcp:read` key, or a tool outside `MUSHI_FEATURES` — now
returns JSON-RPC `-32602 "Tool <name> not found"` instead of an `isError` tool
result. Agents see a client-side error rather than error text in content.
Neither form costs an API round-trip. Shipped as a minor with a changeset.

**Legacy clients are unaffected.** Cursor, Claude Desktop and any v1 SDK client
still negotiate `2025-03-26` exactly as before.

**The server instance is created lazily** on the client's first message rather
than at process start. Startup logs and the missing-API-key diagnostic still
happen before any client message.

**Tests and smoke scripts stay on the v1 client.**
`@modelcontextprotocol/client@2` is not in the pnpm store, and four scripts
under `packages/mcp/scripts/` import the v1 `Client`. `@modelcontextprotocol/sdk`
therefore moved from `dependencies` to `devDependencies` at `^1.29.0`. The
tests drive a v2 `McpServer` with a v1 `Client` over v1 `InMemoryTransport`,
which is structurally compatible. Finishing the split means adding
`@modelcontextprotocol/client@2` as a devDependency and switching five test
files and four scripts.

**Not done:** the version-negotiation matrix test (legacy / auto / pinned
`2026-07-28`) against the hosted server. It needs the v2 client package.

## Evidence

`packages/mcp` typecheck, lint, build, and 120 tests across 7 files all pass.
`pnpm test:smoke` reports 73 tools / 8 resources / 4 prompts matching the
catalog and exits cleanly on stdin EOF. An era probe against `dist/index.js`
confirms both handshakes: a legacy `initialize` at `2025-03-26` is served, and
`server/discover` returns `{resultType: "complete", supportedVersions:
["2026-07-28"], ttlMs: 0, cacheScope: "private"}` with `resultType` on
`tools/list` and `tools/call`.
