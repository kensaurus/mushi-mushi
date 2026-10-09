# 0008. Keep the hosted MCP server hand-rolled; add the 2026-07-28 era in place

Status: Accepted            Date: 2026-09-12

## Context

`packages/server/supabase/functions/mcp/index.ts` re-implements the JSON-RPC
dispatch table on purpose (its header says so) to keep the SDK and zod out of
an edge-function bundle. It advertised only 2025-03-26 and 2024-11-05, never
validated `MCP-Protocol-Version`, still accepted JSON-RPC batches removed in
2025-06-18, and claimed a session echo it did not perform. The current
published revision is 2026-07-28: sessions and `initialize` are gone,
`server/discover` is mandatory, `resultType` is required on every result,
`Mcp-Method`/`Mcp-Name` headers are required, tasks moved to the
`io.modelcontextprotocol/tasks` extension, and MRTR (`input_required`) is
the confirmation primitive. The TypeScript SDK split into v2 packages
(`@modelcontextprotocol/server`, `/hono`, …) on 2026-07-27; v2 offers a
dual-era `createMcpHandler`, but its 2.0.0 release notes do not claim the tasks
extension, and it would be a fresh npm dependency inside a Deno bundle whose
size cap is 20 MB.

## Decision

The hosted server stays hand-rolled and becomes a dual-era server: the legacy
era (2024-11-05 through 2025-11-25) keeps `initialize`, starts validating the
version header, and rejects batches from 2025-06-18 on; the modern era
(2026-07-28) implements `server/discover`, per-request `_meta` negotiation,
`resultType`, `CacheableResult` on list results, header validation with the
renumbered error codes, 405 on GET/DELETE, the tasks extension over
`fix_dispatch_jobs`, and MRTR `input_required` as the voice confirmation gate.
The npm `packages/mcp` (stdio) moves to SDK v2 because it is a Node package
where the split packages are the supported line.

## Rejected alternatives

- **`@modelcontextprotocol/server@2` + `@modelcontextprotocol/hono@2` in the
  edge function** — dual-era for free, but a new dependency in a bundle-capped
  Deno function, unverified tasks-extension support, and a full rewrite of
  auth, feature groups and tool registration that work today. Revisit when the
  SDK ships tasks and a Deno-targeted build; supersede this ADR then.
- **Jump straight to 2026-07-28 and drop legacy clients** — Cursor, Claude
  Desktop and the CLI still negotiate 2025-xx; dropping them breaks every
  existing install.
- **Keep sampling/elicitation as server-initiated requests** — deprecated in
  2026-07-28 and impossible on a POST-only edge transport anyway.

## Consequences

Two code paths must stay green: the CI HTTP smoke keeps exercising the legacy
era, and a version-matrix test exercises the modern era. The agent card and
docs list the full ladder. When the SDK v2 line proves itself in Deno, the
hand-rolled handler can be replaced behind the same tests.
