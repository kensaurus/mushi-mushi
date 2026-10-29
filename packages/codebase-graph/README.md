# @mushi-mushi/codebase-graph

> **Your AI wrote it. Mushi tells you why it broke.**

Internal package, not published to npm. It builds the file and symbol graph
behind the Mushi Mushi console's codebase explorer (`/explore`), from files
the server has already indexed.

## Attribution

Graph schema and analysis concepts are inspired by [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) (`@understand-anything/core`, **MIT License**). This package implements a compatible JSON graph shape for Mushi's server-side analyze worker without vendoring the full UA tree-sitter pipeline (see `packages/server/supabase/functions/_shared/codebase-graph-build.ts` for the Deno runtime mirror).

## Exports

- `buildGraphFromIndex`: file + symbol nodes, import edges, layer grouping
- `fingerprintFile`, `classifyFingerprintDelta`, `classifyBatchUpdate`: incremental SKIP/PARTIAL/FULL classification
- `mergeGraphUpdate`: apply a partial rebuild to an existing graph
- `extractRelativeImports`: relative import scanning
- Shared TypeScript types for the admin UI

The Deno mirror in `_shared/codebase-graph-build.ts` runs in the edge
functions; unit tests under `packages/server/src/__tests__/` keep the two in
step.
