---
"mushi-mushi": minor
---

feat(admin): Codebase Atlas (/explore) — force-directed graph of indexed source

New `/explore` route in the admin console visualises your indexed codebase as a
force-directed ReactFlow graph. Nodes are coloured by architectural layer
(UI, Lib, Backend, Test, Config, Other). Three view modes:

- **Graph** — interactive ReactFlow canvas with layer-filter pills
- **Layer Sankey** — horizontal lane diagram showing files per architectural tier
- **Search** — semantic search via the `match_codebase_files` embedding RPC

New server endpoints supporting the page:
- `GET /v1/admin/projects/:id/codebase/explore` — returns `{ nodes, edges, layers, total_files }`
- `POST /v1/admin/projects/:id/codebase/search` — semantic search returning top-k similar files

New semver utility (`semver.ts`) for build-time vs changelog version comparison
in the VersionBadge component, replacing ad-hoc string splits.
