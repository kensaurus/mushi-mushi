# @mushi-mushi/codebase-graph

> **Your AI wrote it. Mushi tells you why it broke.**

Symbol graph builder for the codebase explorer.


Node-side helpers for building Understand-Anything–shaped knowledge graphs from indexed codebase files.

## Attribution

Graph schema and analysis concepts are inspired by [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (`@understand-anything/core`, **MIT License**). This package implements a compatible JSON graph shape for Mushi's server-side analyze worker without vendoring the full UA tree-sitter pipeline (see `packages/server/supabase/functions/_shared/codebase-graph-build.ts` for the Deno runtime mirror).

## Exports

- `buildGraphFromIndex` — file + symbol nodes, import edges, layer grouping
- `fingerprintFile` / `mergeGraphUpdate` — incremental SKIP/PARTIAL/FULL classification
- Shared TypeScript types for admin UI consumption

Used by `codebase-analyze-worker` and unit tests under `packages/server/src/__tests__/`.
