---
'@mushi-mushi/mcp-ci': patch
---

Lock the Next.js App Router walker with regression tests.

`walkNextAppRouter` had a 70-line route-derivation pipeline (route
groups `(marketing)`, parallel slots `@auth`, private `_internal`,
dynamic `[id]`, catch-all `[...slug]`) but zero tests — a future regex
tweak would silently leak phantom routes into Gate 3.

Round 8 adds vitest + 18 specs across `walkNextAppRouter`,
`parseOpenApiFile`, and `discoverRoutes` — covering each segment-filter
rule, dynamic-segment conversion, multi-method extraction, the
`function GETSomething` substring guard, and the OpenAPI dedup path.

No runtime behaviour change.
